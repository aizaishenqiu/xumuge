/**
 * @file officeDeskDecor.ts 工位皮肤与小摆件（轻量装扮）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo localStorage-kv
 */

export type DeskSkinId = "default" | "tech_dark" | "warm_wood" | "minimal_white";
export type DeskPropId = "plant_small" | "mug" | "figurine" | "lamp_mini";

export type DeskDecor = {
  skinId: DeskSkinId;
  props: DeskPropId[];
};

export const DESK_SKIN_OPTIONS: { id: DeskSkinId; label: string; desk: number; leg: number }[] = [
  { id: "default", label: "默认灰蓝", desk: 0x6a7b90, leg: 0x2a3340 },
  { id: "tech_dark", label: "科技深色", desk: 0x1e2838, leg: 0x0a0e14 },
  { id: "warm_wood", label: "暖木色", desk: 0x8b6914, leg: 0x4a3520 },
  { id: "minimal_white", label: "极简白", desk: 0xe8ecef, leg: 0xb0b8c0 },
];

export const DESK_PROP_OPTIONS: { id: DeskPropId; label: string }[] = [
  { id: "plant_small", label: "小绿植" },
  { id: "mug", label: "马克杯" },
  { id: "figurine", label: "手办" },
  { id: "lamp_mini", label: "小台灯" },
];

const DECOR_PREFIX = "xu.office.deskDecor.";
const MAX_PROPS = 2;

export const DEFAULT_DESK_DECOR: DeskDecor = { skinId: "default", props: [] };

function decorKey(deskIndex: number): string {
  return `${DECOR_PREFIX}${deskIndex}`;
}

function normalizeDecor(raw: Partial<DeskDecor> | null | undefined): DeskDecor {
  const skinIds = DESK_SKIN_OPTIONS.map((s) => s.id);
  const propIds = DESK_PROP_OPTIONS.map((p) => p.id);
  const skinId = skinIds.includes(raw?.skinId as DeskSkinId)
    ? (raw!.skinId as DeskSkinId)
    : "default";
  const props = Array.isArray(raw?.props)
    ? raw!.props.filter((p): p is DeskPropId => propIds.includes(p as DeskPropId)).slice(0, MAX_PROPS)
    : [];
  return { skinId, props };
}

/** 读取单桌装扮 */
export function readDeskDecor(deskIndex: number): DeskDecor {
  try {
    const raw = localStorage.getItem(decorKey(deskIndex));
    if (!raw) return { ...DEFAULT_DESK_DECOR };
    return normalizeDecor(JSON.parse(raw) as Partial<DeskDecor>);
  } catch {
    return { ...DEFAULT_DESK_DECOR };
  }
}

/** 写入单桌装扮并广播 */
export function writeDeskDecor(deskIndex: number, decor: Partial<DeskDecor>): DeskDecor {
  const next = normalizeDecor({ ...readDeskDecor(deskIndex), ...decor });
  try {
    localStorage.setItem(decorKey(deskIndex), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent("xu-office-desk-decor", { detail: { deskIndex, decor: next } }),
  );
  return next;
}

/** 皮肤色板 */
export function skinColors(skinId: DeskSkinId): { desk: number; leg: number } {
  const found = DESK_SKIN_OPTIONS.find((s) => s.id === skinId);
  return found ?? DESK_SKIN_OPTIONS[0];
}
