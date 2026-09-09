import { invoke } from "@tauri-apps/api/core";
import type { OfficeLayout } from "../office/catalog";
import { buildDefaultOfficeLayout } from "../office/defaultLayout";
import { isThreeBayOffice } from "../office/threeBayLayout";
import {
  getDefaultReviewerId,
  loadEmployees,
  removeEmployee,
  saveEmployeesBatch,
  setDefaultReviewerId,
  type Employee,
} from "./employees";
import { loadOfficeLayout, saveOfficeLayout } from "./officeLayout";
import { readDeskCount, writeDeskCount } from "./officeSettings";
import {
  loadEmployeeWorkApiSource,
  loadOpsBrains,
  saveEmployeeWorkApiSource,
  saveOpsBrains,
  type GlobalEmployeeApiSource,
  type OpsBrains,
} from "./opsBrains";

export const OFFICE_USER_DEFAULT_KEY = "office_user_default";
export const OFFICE_LAYOUT_DEFAULT_REV_KEY = "office_layout_default_rev";
export const OFFICE_LAYOUT_DEFAULT_REV = 2;

export interface OfficeUserSnapshot {
  version: 1;
  savedAt: number;
  deskCount: number;
  layout: OfficeLayout;
  employees: Employee[];
  opsBrains: OpsBrains;
  defaultReviewerId: string | null;
  employeeWorkApiSource: GlobalEmployeeApiSource;
}

export interface OfficeSnapshotMeta {
  savedAt: number;
  employeeCount: number;
  deskCount: number;
}

function cloneLayout(layout: OfficeLayout): OfficeLayout {
  return JSON.parse(JSON.stringify(layout)) as OfficeLayout;
}

function cloneEmployees(employees: Employee[]): Employee[] {
  return JSON.parse(JSON.stringify(employees)) as Employee[];
}

async function readLayoutRev(): Promise<number> {
  try {
    const raw = await invoke<string | null>("xu_get_setting", {
      key: OFFICE_LAYOUT_DEFAULT_REV_KEY,
    });
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

async function writeLayoutRev(rev: number): Promise<void> {
  await invoke("xu_set_setting", {
    key: OFFICE_LAYOUT_DEFAULT_REV_KEY,
    value: String(rev),
  });
}

async function readSavedLayoutRaw(): Promise<OfficeLayout | null> {
  try {
    const raw = await invoke<string | null>("xu_get_office_layout");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfficeLayout;
    if (parsed?.version === 1 && Array.isArray(parsed.props)) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/** 一次性：大开间 → 三开间；并同步更新已有快照里的布局。 */
export async function migrateToThreeBayDefault(): Promise<boolean> {
  if ((await readLayoutRev()) >= OFFICE_LAYOUT_DEFAULT_REV) return false;

  const saved = await readSavedLayoutRaw();
  if (saved?.meta?.projectId) {
    await writeLayoutRev(OFFICE_LAYOUT_DEFAULT_REV);
    return false;
  }
  if (isThreeBayOffice(saved)) {
    await writeLayoutRev(OFFICE_LAYOUT_DEFAULT_REV);
    return false;
  }

  const employees = await loadEmployees();
  const headcount = Math.max(
    readDeskCount(),
    employees.length || readDeskCount(),
    1,
  );
  writeDeskCount(headcount);
  const layout = buildDefaultOfficeLayout(headcount);
  await saveOfficeLayout(layout);

  try {
    const snapRaw = await invoke<string | null>("xu_get_setting", {
      key: OFFICE_USER_DEFAULT_KEY,
    });
    if (snapRaw?.trim()) {
      const snap = JSON.parse(snapRaw) as OfficeUserSnapshot;
      if (snap?.version === 1) {
        snap.layout = cloneLayout(layout);
        snap.deskCount = headcount;
        snap.savedAt = Date.now();
        await invoke("xu_set_setting", {
          key: OFFICE_USER_DEFAULT_KEY,
          value: JSON.stringify(snap),
        });
      }
    }
  } catch {
    /* soft */
  }

  await writeLayoutRev(OFFICE_LAYOUT_DEFAULT_REV);
  window.dispatchEvent(
    new CustomEvent("xu-office-settings", { detail: { deskCount: headcount } }),
  );
  window.dispatchEvent(new CustomEvent("xu-office-layout-changed", { detail: layout }));
  return true;
}

export async function hasOfficeUserDefault(): Promise<boolean> {
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: OFFICE_USER_DEFAULT_KEY });
    return Boolean(raw?.trim());
  } catch {
    return false;
  }
}

export async function getOfficeUserDefaultMeta(): Promise<OfficeSnapshotMeta | null> {
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: OFFICE_USER_DEFAULT_KEY });
    if (!raw) return null;
    const snap = JSON.parse(raw) as OfficeUserSnapshot;
    if (snap?.version !== 1) return null;
    return {
      savedAt: snap.savedAt,
      employeeCount: snap.employees?.length ?? 0,
      deskCount: snap.deskCount,
    };
  } catch {
    return null;
  }
}

/** Capture current office (layout + roster + desk count + brains) as user default. */
export async function saveOfficeUserDefault(): Promise<OfficeSnapshotMeta> {
  const [layout, employees, opsBrains, defaultReviewerId, employeeWorkApiSource] =
    await Promise.all([
      loadOfficeLayout(),
      loadEmployees(),
      loadOpsBrains(),
      getDefaultReviewerId(),
      loadEmployeeWorkApiSource(),
    ]);
  const snapshot: OfficeUserSnapshot = {
    version: 1,
    savedAt: Date.now(),
    deskCount: readDeskCount(),
    layout: cloneLayout(layout),
    employees: cloneEmployees(employees),
    opsBrains,
    defaultReviewerId,
    employeeWorkApiSource,
  };
  await invoke("xu_set_setting", {
    key: OFFICE_USER_DEFAULT_KEY,
    value: JSON.stringify(snapshot),
  });
  return {
    savedAt: snapshot.savedAt,
    employeeCount: employees.length,
    deskCount: snapshot.deskCount,
  };
}

/** Restore office from user default snapshot. */
export async function restoreOfficeUserDefault(): Promise<OfficeLayout> {
  const raw = await invoke<string | null>("xu_get_setting", { key: OFFICE_USER_DEFAULT_KEY });
  if (!raw?.trim()) {
    throw new Error("尚未保存办公室默认设置，请先在设置中「保存当前为默认」。");
  }
  const snap = JSON.parse(raw) as OfficeUserSnapshot;
  if (snap?.version !== 1 || !snap.layout || !Array.isArray(snap.employees)) {
    throw new Error("办公室默认设置已损坏，请重新保存。");
  }

  writeDeskCount(snap.deskCount);

  const current = await loadEmployees();
  const keepIds = new Set(snap.employees.map((e) => e.id));
  for (const emp of current) {
    if (!keepIds.has(emp.id)) {
      await removeEmployee(emp.id);
    }
  }
  await saveEmployeesBatch(snap.employees);

  if (snap.opsBrains) {
    await saveOpsBrains(snap.opsBrains);
  }
  if (snap.employeeWorkApiSource) {
    await saveEmployeeWorkApiSource(snap.employeeWorkApiSource);
  }
  if (snap.defaultReviewerId !== undefined) {
    await setDefaultReviewerId(snap.defaultReviewerId);
  }

  await saveOfficeLayout(snap.layout);
  window.dispatchEvent(
    new CustomEvent("xu-office-settings", { detail: { deskCount: snap.deskCount } }),
  );
  window.dispatchEvent(new CustomEvent("xu-employees-changed"));
  return snap.layout;
}

/** 启动时：迁移为三开间 + 若无快照则保存当前为默认。 */
export async function ensureInitialOfficeDefault(): Promise<boolean> {
  await migrateToThreeBayDefault();
  if (await hasOfficeUserDefault()) return false;
  await saveOfficeUserDefault();
  return true;
}

export function formatSnapshotTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ms);
  }
}
