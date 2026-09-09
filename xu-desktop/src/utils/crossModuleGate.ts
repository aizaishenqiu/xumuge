/** Cross-module alignment gate: meet first, then code. */

import { mkdirRecursive, readTextFile, writeTextUnderWorkspace } from "./fsBridge";
import { appendFouMessage, dispatchEmployeeTask, updateEmployee, type Employee } from "../employee";
import { beginEscalationForNeedConfirm } from "./escalationChain";
import { listIdleNonBoss, pickIdleByWaves } from "./idleSurge";
import type { XuProject } from "./projects";

export type CrossModuleStatus = "pending" | "agreed" | "boss_ok";

export interface CrossModuleGate {
  status: CrossModuleStatus;
  modules: string[];
  caller: string;
  callee: string;
  openPoints: string[];
  employeeIds: string[];
  updatedAt: number;
}

export const CROSS_MODULE_REL = ".xu/cross-module.json";

export function emptyCrossModuleGate(): CrossModuleGate {
  return {
    status: "pending",
    modules: [],
    caller: "",
    callee: "",
    openPoints: [],
    employeeIds: [],
    updatedAt: 0,
  };
}

export function isCrossModuleCleared(gate: CrossModuleGate | null | undefined): boolean {
  if (!gate || !gate.updatedAt) return true;
  return gate.status === "agreed" || gate.status === "boss_ok";
}

export function parseCrossModuleGate(raw: string): CrossModuleGate {
  try {
    const o = JSON.parse(raw) as Partial<CrossModuleGate>;
    const status: CrossModuleStatus =
      o.status === "agreed" || o.status === "boss_ok" || o.status === "pending" ? o.status : "pending";
    return {
      status,
      modules: Array.isArray(o.modules) ? o.modules.map(String).filter(Boolean).slice(0, 12) : [],
      caller: String(o.caller || "").trim(),
      callee: String(o.callee || "").trim(),
      openPoints: Array.isArray(o.openPoints)
        ? o.openPoints.map(String).filter(Boolean).slice(0, 20)
        : [],
      employeeIds: Array.isArray(o.employeeIds)
        ? o.employeeIds.map(String).filter(Boolean).slice(0, 20)
        : [],
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
    };
  } catch {
    return emptyCrossModuleGate();
  }
}

export async function readCrossModuleGate(workspace: string): Promise<CrossModuleGate> {
  const ws = workspace.trim();
  if (!ws) return emptyCrossModuleGate();
  try {
    const abs = `${ws.replace(/[\\/]+$/, "")}/.xu/cross-module.json`;
    return parseCrossModuleGate(await readTextFile(abs));
  } catch {
    return emptyCrossModuleGate();
  }
}

export async function writeCrossModuleGate(
  workspace: string,
  gate: CrossModuleGate,
): Promise<void> {
  const ws = workspace.trim();
  if (!ws) return;
  await mkdirRecursive(ws, ".xu");
  const next = { ...gate, updatedAt: Date.now() };
  await writeTextUnderWorkspace(ws, CROSS_MODULE_REL, JSON.stringify(next, null, 2));
}

export async function isCrossModuleBlocking(workspace: string): Promise<boolean> {
  const gate = await readCrossModuleGate(workspace);
  return Boolean(gate.updatedAt) && gate.status === "pending";
}

export function crossModuleDevRule(): string {
  return [
    "【跨模块铁律】涉及两个以上模块/端（frontend / backend / 桌面等）或跨人接口时：",
    "1. 先输出 XU_CROSS_MODULE: 模块、调用方、被调方、待对齐点",
    "2. 同时输出 XU_NEED_CONFIRM: 跨模块待对齐（办公室开会）",
    "3. 禁止先写跨模块实现。对齐后把 `.xu/cross-module.json` 的 status 写成 agreed，或等 Boss「确认跨模块 / 开写」。",
  ].join("\n");
}

export function parseCrossModuleMarker(text: string): {
  modules: string[];
  caller: string;
  callee: string;
  openPoints: string[];
} | null {
  const t = text || "";
  const idx = t.search(/XU_CROSS_MODULE[:：]/i);
  if (idx < 0) return null;
  const rest = t.slice(idx).split(/\n/).slice(1, 16);
  const openPoints: string[] = [];
  let modules: string[] = [];
  let caller = "";
  let callee = "";
  for (const line of rest) {
    const s = line.trim();
    if (!s) {
      if (openPoints.length) break;
      continue;
    }
    if (/^XU_(PHASE|TASKS|NEED_CONFIRM)/i.test(s)) break;
    const cleaned = s.replace(/^[-*•\d.、)）]+\s*/, "");
    const kv = cleaned.match(/^(模块|调用方|被调方|待对齐)\s*[:：]\s*(.+)$/);
    if (kv) {
      const key = kv[1];
      const val = kv[2].trim();
      if (key === "模块") modules = val.split(/[,，、/\s]+/).filter(Boolean);
      else if (key === "调用方") caller = val;
      else if (key === "被调方") callee = val;
      else openPoints.push(val);
      continue;
    }
    openPoints.push(cleaned);
  }
  return { modules, caller, callee, openPoints };
}

export async function beginCrossModuleMeeting(opts: {
  project: XuProject;
  roster: Employee[];
  reporterId?: string;
  parsed: NonNullable<ReturnType<typeof parseCrossModuleMarker>>;
}): Promise<CrossModuleGate> {
  const root = (opts.project.generatePath || "").trim();
  const idle = listIdleNonBoss(opts.roster).filter((e) => e.id !== opts.reporterId);
  const related = [
    ...pickIdleByWaves(idle, ["dev", "planning"], opts.project.type || "software"),
    ...idle.filter((e) => /接口|api|前端|后端|桌面/i.test(`${e.role} ${e.agentRoleId || ""}`)),
  ];
  const seen = new Set<string>();
  const peers: Employee[] = [];
  for (const e of related) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    peers.push(e);
    if (peers.length >= 6) break;
  }
  const employeeIds = [opts.reporterId, ...peers.map((e) => e.id)].filter(Boolean) as string[];
  const gate: CrossModuleGate = {
    status: "pending",
    modules: opts.parsed.modules,
    caller: opts.parsed.caller,
    callee: opts.parsed.callee,
    openPoints: opts.parsed.openPoints,
    employeeIds,
    updatedAt: Date.now(),
  };
  if (root) await writeCrossModuleGate(root, gate);
  for (const emp of peers) {
    try {
      await updateEmployee(emp.id, { status: "meeting" });
      beginEscalationForNeedConfirm(emp.id, opts.roster, {
        confirmText: [
          opts.parsed.modules.join("、"),
          opts.parsed.openPoints.join("；"),
          "跨模块对齐",
        ].join(" "),
        isCrossModule: true,
      });
      await dispatchEmployeeTask(emp, {
        task: [
          "【跨模块对齐会】",
          `项目：${opts.project.name}`,
          `模块：${opts.parsed.modules.join("、") || "未标明"}`,
          `调用方：${opts.parsed.caller || "—"}`,
          `被调方：${opts.parsed.callee || "—"}`,
          opts.parsed.openPoints.length
            ? `待对齐：\n${opts.parsed.openPoints.map((p) => `- ${p}`).join("\n")}`
            : "",
          "请短会对齐接口。对齐后 write_file `.xu/cross-module.json`，status=agreed。",
          "对不上请 XU_NEED_CONFIRM 上报经理/老板。禁止先写跨模块实现。",
        ]
          .filter(Boolean)
          .join("\n"),
        projectId: opts.project.id,
        qaMode: true,
        workspaceRoot: emp.workspaceRoot || root,
      });
    } catch (e) {
      console.warn("[xu] cross-module meeting", emp.name, e);
    }
  }
  try {
    await appendFouMessage({
      sessionTag: "office-floor",
      role: "system",
      content: [
        "⏸ 跨模块调用需先开会。相关同事已拉进会议室。",
        peers.length ? `与会：${peers.map((e) => e.name).join("、")}` : "",
        "对齐后写 `.xu/cross-module.json` status=agreed，或 Boss 回复「确认跨模块」/「开写」。",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch {
    /* ignore */
  }
  return gate;
}

export async function confirmCrossModule(
  workspace: string,
  how: "agreed" | "boss_ok",
  roster: Employee[],
): Promise<void> {
  const prev = await readCrossModuleGate(workspace);
  await writeCrossModuleGate(workspace, { ...prev, status: how });
  for (const id of prev.employeeIds) {
    const emp = roster.find((e) => e.id === id);
    if (emp?.status === "meeting") {
      try {
        await updateEmployee(id, { status: "idle" });
      } catch {
        /* ignore */
      }
    }
  }
}

export async function onCrossModuleDetected(opts: {
  employeeId: string;
  output: string;
  projectId?: string | null;
}): Promise<void> {
  const parsed = parseCrossModuleMarker(opts.output);
  if (!parsed) return;
  const { loadProjects } = await import("./projects");
  const { readEmployees } = await import("./employees");
  const projects = await loadProjects();
  const project =
    (opts.projectId && projects.find((p) => p.id === opts.projectId)) ||
    projects.find((p) => p.type === "software" && (p.generatePath || "").trim());
  if (!project) return;
  const existing = await readCrossModuleGate(project.generatePath || "");
  if (existing.updatedAt && existing.status !== "pending") return;
  await beginCrossModuleMeeting({
    project,
    roster: readEmployees(),
    reporterId: opts.employeeId,
    parsed,
  });
}
