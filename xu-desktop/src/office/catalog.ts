/** Office furniture catalog kinds for builder + scene factory. */

export type PropKind =
  | "desk"
  | "desk_duo"
  | "desk_l"
  | "desk_bench"
  | "desk_corner"
  | "desk_standing"
  | "desk_compact"
  | "desk_arc"
  | "desk_exec"
  | "desk_exec_l"
  | "desk_exec_arc"
  | "chair_exec"
  | "cabinet"
  | "printer"
  | "plant"
  | "plant_large"
  | "tree"
  | "bush"
  | "flower"
  | "flower_pot"
  | "cooler"
  | "coffee"
  | "sofa"
  | "sofa_large"
  | "sofa_loveseat"
  | "sofa_corner"
  | "coffee_table"
  | "coffee_table_round"
  | "coffee_table_glass"
  | "rug"
  | "door"
  | "door_glass"
  | "door_double"
  | "door_double_glass"
  | "reception_desk"
  | "reception_glass"
  | "reception_split"
  | "reception_arch"
  | "reception_minimal"
  | "reception_marble"
  | "window"
  | "window_wide"
  | "banner"
  | "whiteboard"
  | "shelf"
  | "water_dispenser"
  | "floor_lamp"
  | "partition"
  | "wall"
  | "opening"
  | "room_finance"
  | "room_sales"
  | "room_tech"
  | "room_procure"
  | "room_code";

export interface CatalogItem {
  kind: PropKind;
  name: string;
  /** Short emoji / glyph for panel */
  icon: string;
  category: CatalogCategoryId;
}

export type CatalogCategoryId =
  | "rooms"
  | "workstations"
  | "furniture"
  | "plants"
  | "appliances"
  | "structure"
  | "decor";

export interface CatalogCategory {
  id: CatalogCategoryId;
  name: string;
  icon: string;
}

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  { id: "rooms", name: "办公室", icon: "building-line" },
  { id: "workstations", name: "工位", icon: "computer-line" },
  { id: "furniture", name: "家具", icon: "home-smile-line" },
  { id: "plants", name: "花草", icon: "leaf-line" },
  { id: "appliances", name: "电器", icon: "plug-line" },
  { id: "structure", name: "墙体门窗", icon: "door-open-line" },
  { id: "decor", name: "装饰", icon: "palette-line" },
];

export const OFFICE_CATALOG: CatalogItem[] = [
  { kind: "room_finance", name: "财务办公室", icon: "💰", category: "rooms" },
  { kind: "room_sales", name: "销售办公室", icon: "🤝", category: "rooms" },
  { kind: "room_tech", name: "技术办公室", icon: "💻", category: "rooms" },
  { kind: "room_procure", name: "采购办公室", icon: "🛒", category: "rooms" },
  { kind: "room_code", name: "代码办公室", icon: "⌨️", category: "rooms" },
  { kind: "desk", name: "单人工位", icon: "🖥️", category: "workstations" },
  { kind: "desk_duo", name: "双人工位", icon: "🖥️", category: "workstations" },
  { kind: "desk_l", name: "L型工位", icon: "🖥️", category: "workstations" },
  { kind: "desk_bench", name: "对坐工位", icon: "🖥️", category: "workstations" },
  { kind: "desk_corner", name: "转角工位", icon: "🖥️", category: "workstations" },
  { kind: "desk_standing", name: "升降站立桌", icon: "🖥️", category: "workstations" },
  { kind: "desk_compact", name: "紧凑工位", icon: "🖥️", category: "workstations" },
  { kind: "desk_arc", name: "弧形工位", icon: "◐", category: "workstations" },
  { kind: "desk_exec", name: "大班台", icon: "🪑", category: "workstations" },
  { kind: "desk_exec_l", name: "L型大班台", icon: "🪑", category: "workstations" },
  { kind: "desk_exec_arc", name: "弧形大班台", icon: "🪑", category: "workstations" },
  { kind: "chair_exec", name: "老板椅", icon: "💺", category: "workstations" },
  { kind: "cabinet", name: "落地柜", icon: "🗄️", category: "furniture" },
  { kind: "sofa", name: "三人沙发", icon: "🛋️", category: "furniture" },
  { kind: "sofa_large", name: "大沙发", icon: "🛋️", category: "furniture" },
  { kind: "sofa_loveseat", name: "双人沙发", icon: "🛋️", category: "furniture" },
  { kind: "sofa_corner", name: "转角沙发", icon: "🛋️", category: "furniture" },
  { kind: "coffee_table", name: "方茶几", icon: "🪵", category: "furniture" },
  { kind: "coffee_table_round", name: "圆茶几", icon: "🪵", category: "furniture" },
  { kind: "coffee_table_glass", name: "玻璃茶几", icon: "🪵", category: "furniture" },
  { kind: "rug", name: "地毯", icon: "🟫", category: "furniture" },
  { kind: "shelf", name: "书架", icon: "📚", category: "furniture" },
  { kind: "partition", name: "隔断", icon: "🧱", category: "furniture" },
  { kind: "plant", name: "绿植", icon: "🪴", category: "plants" },
  { kind: "plant_large", name: "大型绿植", icon: "🌳", category: "plants" },
  { kind: "tree", name: "室内树", icon: "🌲", category: "plants" },
  { kind: "bush", name: "灌木", icon: "🌿", category: "plants" },
  { kind: "flower", name: "花丛", icon: "🌸", category: "plants" },
  { kind: "flower_pot", name: "盆栽花", icon: "🌺", category: "plants" },
  { kind: "printer", name: "打印机", icon: "🖨️", category: "appliances" },
  { kind: "cooler", name: "饮水机", icon: "💧", category: "appliances" },
  { kind: "coffee", name: "咖啡机", icon: "☕", category: "appliances" },
  { kind: "water_dispenser", name: "立式饮水", icon: "🧴", category: "appliances" },
  { kind: "floor_lamp", name: "落地灯", icon: "💡", category: "appliances" },
  { kind: "wall", name: "画墙", icon: "🧱", category: "structure" },
  { kind: "opening", name: "自定义切墙", icon: "⬜", category: "structure" },
  { kind: "door", name: "木门", icon: "🚪", category: "structure" },
  { kind: "door_glass", name: "玻璃门", icon: "🪟", category: "structure" },
  { kind: "door_double", name: "双开门", icon: "🚪", category: "structure" },
  { kind: "door_double_glass", name: "双开玻璃门", icon: "🪟", category: "structure" },
  { kind: "reception_desk", name: "前台·经典", icon: "🛎️", category: "furniture" },
  { kind: "reception_glass", name: "前台·玻璃", icon: "🛎️", category: "furniture" },
  { kind: "reception_split", name: "前台·黑白分体", icon: "🛎️", category: "furniture" },
  { kind: "reception_arch", name: "前台·拱形点缀", icon: "🛎️", category: "furniture" },
  { kind: "reception_minimal", name: "前台·极简", icon: "🛎️", category: "furniture" },
  { kind: "reception_marble", name: "前台·大理石", icon: "🛎️", category: "furniture" },
  { kind: "window", name: "窗户", icon: "🪟", category: "structure" },
  { kind: "window_wide", name: "落地窗", icon: "🪟", category: "structure" },
  { kind: "banner", name: "墙标语", icon: "🪧", category: "decor" },
  { kind: "whiteboard", name: "白板", icon: "⬜", category: "decor" },
];

export function catalogByCategory(category: CatalogCategoryId): CatalogItem[] {
  return OFFICE_CATALOG.filter((c) => c.category === category);
}

/** Preset swatches for free recolor (酷家乐式). */
export const PROP_COLOR_PRESETS = [
  "#2a6b5a",
  "#0f766e",
  "#1d4ed8",
  "#7c3aed",
  "#b45309",
  "#b91c1c",
  "#334155",
  "#78716c",
  "#f5f5f4",
  "#1c1917",
  "#c4a574",
  "#4f8f45",
] as const;

export interface OfficeProp {
  id: string;
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Uniform visual scale (default 1). */
  scale?: number;
  /** Non-uniform stretch (酷家乐式宽/高/深), default 1. */
  sx?: number;
  sy?: number;
  sz?: number;
  /** Mirror on local X. */
  flipX?: boolean;
  /** Mirror on local Z. */
  flipZ?: boolean;
  /** Free recolor hex, e.g. #2a6b5a */
  color?: string;
  meta?: {
    /** Which floor room this desk belongs to */
    roomId?: string;
    deskIndex?: number;
    /** Second seat on desk_duo */
    deskIndex2?: number;
    /** Linked seats for arc / multi benches: deskIndex .. deskIndex+seatCount-1 */
    seatCount?: number;
    lit?: boolean;
    text?: string;
    wall?: boolean;
    roomLabel?: string;
    /** Room / wall height in world units */
    height?: number;
    /** Wall segment length */
    length?: number;
    /** Custom wall-cut half-width (world units); overrides kind default × scale × sx */
    cutHalf?: number;
    /** Custom cut bottom Y */
    cutY0?: number;
    /** Custom cut top Y */
    cutY1?: number;
  };
}

export interface OfficeLayout {
  version: 1;
  props: OfficeProp[];
  /** Dynamic offices: open plaza + perimeter rooms. */
  rooms?: Array<{
    id: string;
    name: string;
    weight?: number;
    kind?: string;
    allowedDivisions?: string[];
    zone?: "open" | "perimeter";
  }>;
  meta?: {
    floorWidth?: number;
    floorDepth?: number;
    ringDepth?: number;
    layoutMode?: "surround" | "open_hall" | "blank";
    /** Bump to force one-time shell rebuild for users */
    shellRev?: number;
    /** Bump after spreading overlapping desk props */
    deskHealRev?: number;
    /** When true, loadOfficeLayout must not syncDeskCount (project-generated seating) */
    lockSeats?: boolean;
    /** Project id that owns this seating plan */
    projectId?: string;
  };
}

export function newPropId(kind: string): string {
  return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function clampPropScale(scale: number): number {
  return Math.min(3, Math.max(0.35, Math.round(scale * 20) / 20));
}

export function isDeskKind(kind: PropKind | string): boolean {
  return (
    kind === "desk" ||
    kind === "desk_duo" ||
    kind === "desk_l" ||
    kind === "desk_bench" ||
    kind === "desk_corner" ||
    kind === "desk_standing" ||
    kind === "desk_compact" ||
    kind === "desk_arc" ||
    kind === "desk_exec" ||
    kind === "desk_exec_l" ||
    kind === "desk_exec_arc"
  );
}

export function isRoomKind(kind: PropKind | string): boolean {
  return (
    kind === "room_finance" ||
    kind === "room_sales" ||
    kind === "room_tech" ||
    kind === "room_procure" ||
    kind === "room_code"
  );
}

/** Place against walls (doors/windows/openings/banners). */
export function isWallMountKind(kind: PropKind | string): boolean {
  return (
    kind === "door" ||
    kind === "door_glass" ||
    kind === "door_double" ||
    kind === "door_double_glass" ||
    kind === "window" ||
    kind === "window_wide" ||
    kind === "opening" ||
    kind === "banner"
  );
}

/** Kinds that cut a hole through solid walls. */
export function isWallCutKind(kind: PropKind | string): boolean {
  return (
    kind === "opening" ||
    kind === "door" ||
    kind === "door_glass" ||
    kind === "door_double" ||
    kind === "door_double_glass" ||
    kind === "window" ||
    kind === "window_wide"
  );
}

/** Half-span along wall + vertical opening range (world units). */
export function wallCutSpan(
  kind: PropKind | string,
  scale = 1,
): { half: number; y0: number; y1: number } {
  const s = scale;
  switch (kind) {
    case "opening":
      return { half: 0.56 * s, y0: 0, y1: 2.1 };
    case "door":
    case "door_glass":
      return { half: 0.55 * s, y0: 0, y1: 2.05 };
    case "door_double":
    case "door_double_glass":
      return { half: 0.95 * s, y0: 0, y1: 2.05 };
    case "window":
      return { half: 0.72 * s, y0: 0.85, y1: 2.0 };
    case "window_wide":
      return { half: 1.28 * s, y0: 0.35, y1: 2.15 };
    default:
      return { half: 0.5 * s, y0: 0, y1: 2.0 };
  }
}

/**
 * Cut size for a placed prop: kind defaults × uniform scale × sx/sy,
 * with optional meta.cutHalf / cutY0 / cutY1 absolute overrides.
 */
export function wallCutSpanForProp(p: {
  kind: PropKind | string;
  scale?: number;
  sx?: number;
  sy?: number;
  meta?: { cutHalf?: number; cutY0?: number; cutY1?: number };
}): { half: number; y0: number; y1: number } {
  const base = wallCutSpan(p.kind, p.scale ?? 1);
  const sx = p.sx ?? 1;
  const sy = p.sy ?? 1;
  let half = base.half * sx;
  let y0 = base.y0;
  let y1 = base.y0 + (base.y1 - base.y0) * sy;
  if (p.meta?.cutHalf != null && Number.isFinite(p.meta.cutHalf)) {
    half = Math.max(0.15, p.meta.cutHalf);
  }
  if (p.meta?.cutY0 != null && Number.isFinite(p.meta.cutY0)) {
    y0 = Math.max(0, p.meta.cutY0);
  }
  if (p.meta?.cutY1 != null && Number.isFinite(p.meta.cutY1)) {
    y1 = Math.max(y0 + 0.2, p.meta.cutY1);
  }
  return { half, y0, y1 };
}

export const ROOM_DEFAULT_LABEL: Record<string, string> = {
  room_finance: "财务部",
  room_sales: "销售部",
  room_tech: "技术部",
  room_procure: "采购部",
  room_code: "代码部",
};

export const ROOM_ACCENT: Record<string, number> = {
  room_finance: 0x0f766e,
  room_sales: 0x1d4ed8,
  room_tech: 0x7c3aed,
  room_procure: 0xb45309,
  room_code: 0x334155,
};

/** How many seats a desk kind contributes when meta seats are missing. */
export function seatCapacityOfKind(kind: PropKind | string): number {
  if (kind === "desk_duo" || kind === "desk_bench") return 2;
  if (kind === "desk_arc") return 2;
  return 1;
}

/** Seat numbers claimed by a single desk prop. */
export function seatIndicesOnProp(p: OfficeProp): number[] {
  const out: number[] = [];
  const capacity = seatCapacityOfKind(p.kind);
  // Prefer explicit multi-seat span from deskIndex + seatCount
  const seatCount = p.meta?.seatCount ?? (capacity > 1 ? capacity : undefined);
  if (p.meta?.deskIndex != null && seatCount != null && seatCount > 1) {
    const n = Math.max(1, Math.min(12, seatCount));
    for (let i = 0; i < n; i++) out.push(p.meta.deskIndex + i);
    return out;
  }
  if (p.meta?.deskIndex != null) out.push(p.meta.deskIndex);
  if (p.meta?.deskIndex2 != null) out.push(p.meta.deskIndex2);
  // bench/duo/arc missing meta: still expose capacity seats from deskIndex
  if (out.length === 1 && capacity > 1 && p.meta?.deskIndex != null) {
    for (let i = 1; i < capacity; i++) out.push(p.meta.deskIndex + i);
  }
  return out;
}

/** Total seat capacity across all desk-kind props. */
export function countLayoutSeats(props: OfficeProp[]): number {
  let n = 0;
  for (const p of props) {
    if (!isDeskKind(p.kind)) continue;
    const seats = seatIndicesOnProp(p);
    n += seats.length > 0 ? seats.length : seatCapacityOfKind(p.kind);
  }
  return n;
}

/** Highest used desk seat index + 1 */
export function nextDeskSeatIndex(props: OfficeProp[]): number {
  let max = -1;
  for (const p of props) {
    for (const s of seatIndicesOnProp(p)) max = Math.max(max, s);
    if (p.meta?.deskIndex != null) max = Math.max(max, p.meta.deskIndex);
    if (p.meta?.deskIndex2 != null) max = Math.max(max, p.meta.deskIndex2);
  }
  return max + 1;
}

export type SeatMode = "fixed" | "ask";

export interface CatalogVariant {
  kind: PropKind;
  name: string;
  seatMode: SeatMode;
  defaultSeats: number;
  /** Preview / finish palette id */
  styleId?: string;
  /** Applied as prop.color when placed */
  color?: string;
}

export interface CatalogFamily {
  id: string;
  name: string;
  category: CatalogCategoryId;
  icon: string;
  variants: CatalogVariant[];
}

/** Left-rail families; right pane shows variants. */
export const CATALOG_FAMILIES: CatalogFamily[] = [
  {
    id: "desk_single",
    name: "直线工位",
    category: "workstations",
    icon: "computer-line",
    variants: [
      { kind: "desk", name: "单人·橡木", seatMode: "ask", defaultSeats: 1, styleId: "oak", color: "#d4a574" },
      { kind: "desk", name: "单人·胡桃", seatMode: "ask", defaultSeats: 1, styleId: "walnut", color: "#6f4e37" },
      { kind: "desk", name: "单人·白色", seatMode: "ask", defaultSeats: 1, styleId: "white", color: "#f1f5f9" },
      { kind: "desk_compact", name: "紧凑·橡木", seatMode: "ask", defaultSeats: 1, styleId: "oak", color: "#d4a574" },
      { kind: "desk_compact", name: "紧凑·石板灰", seatMode: "ask", defaultSeats: 1, styleId: "slate", color: "#64748b" },
      { kind: "desk_standing", name: "升降·白", seatMode: "ask", defaultSeats: 1, styleId: "white", color: "#e2e8f0" },
      { kind: "desk_standing", name: "升降·深色", seatMode: "ask", defaultSeats: 1, styleId: "slate", color: "#334155" },
    ],
  },
  {
    id: "desk_multi",
    name: "连体工位",
    category: "workstations",
    icon: "layout-grid-line",
    variants: [
      { kind: "desk_duo", name: "双人·橡木", seatMode: "ask", defaultSeats: 2, styleId: "oak", color: "#d4a574" },
      { kind: "desk_duo", name: "双人·青绿", seatMode: "ask", defaultSeats: 2, styleId: "teal", color: "#2c7a7b" },
      { kind: "desk_bench", name: "对坐·胡桃", seatMode: "ask", defaultSeats: 2, styleId: "walnut", color: "#6f4e37" },
      { kind: "desk_bench", name: "对坐·白", seatMode: "ask", defaultSeats: 2, styleId: "white", color: "#f8fafc" },
      { kind: "desk_l", name: "L 型·橡木", seatMode: "ask", defaultSeats: 1, styleId: "oak", color: "#c9a87c" },
      { kind: "desk_l", name: "L 型·海军蓝", seatMode: "ask", defaultSeats: 1, styleId: "navy", color: "#1e3a5f" },
      { kind: "desk_corner", name: "转角·石板", seatMode: "ask", defaultSeats: 1, styleId: "slate", color: "#475569" },
    ],
  },
  {
    id: "desk_arc",
    name: "弧形工位",
    category: "workstations",
    icon: "circle-line",
    variants: [
      { kind: "desk_arc", name: "弧形单人·橡木", seatMode: "ask", defaultSeats: 1, styleId: "oak", color: "#d4a574" },
      { kind: "desk_arc", name: "弧形双人·胡桃", seatMode: "ask", defaultSeats: 2, styleId: "walnut", color: "#6f4e37" },
      { kind: "desk_arc", name: "弧形四人·白", seatMode: "ask", defaultSeats: 4, styleId: "white", color: "#e2e8f0" },
      { kind: "desk_arc", name: "弧形·青绿", seatMode: "ask", defaultSeats: 2, styleId: "teal", color: "#319795" },
    ],
  },
  {
    id: "desk_exec",
    name: "大班台",
    category: "workstations",
    icon: "layout-masonry-line",
    variants: [
      { kind: "desk_exec", name: "直台·胡桃", seatMode: "fixed", defaultSeats: 0, styleId: "walnut", color: "#6f4e37" },
      { kind: "desk_exec", name: "直台·橡木", seatMode: "fixed", defaultSeats: 0, styleId: "oak", color: "#b8956c" },
      { kind: "desk_exec_l", name: "L 型·深色", seatMode: "fixed", defaultSeats: 0, styleId: "walnut", color: "#4a3728" },
      { kind: "desk_exec_l", name: "L 型·海军", seatMode: "fixed", defaultSeats: 0, styleId: "navy", color: "#1e3a5f" },
      { kind: "desk_exec_arc", name: "弧形·金橡", seatMode: "fixed", defaultSeats: 0, styleId: "oak", color: "#a67c52" },
    ],
  },
  {
    id: "chair_exec",
    name: "老板椅",
    category: "workstations",
    icon: "seat-line",
    variants: [
      { kind: "chair_exec", name: "黑皮", seatMode: "fixed", defaultSeats: 0, styleId: "slate", color: "#1e293b" },
      { kind: "chair_exec", name: "棕皮", seatMode: "fixed", defaultSeats: 0, styleId: "walnut", color: "#5c4033" },
      { kind: "chair_exec", name: "墨绿", seatMode: "fixed", defaultSeats: 0, styleId: "teal", color: "#234e52" },
    ],
  },
  {
    id: "sofa",
    name: "沙发",
    category: "furniture",
    icon: "home-smile-line",
    variants: [
      { kind: "sofa", name: "三人·墨绿", seatMode: "fixed", defaultSeats: 0, styleId: "teal", color: "#2c7a7b" },
      { kind: "sofa", name: "三人·海军", seatMode: "fixed", defaultSeats: 0, styleId: "navy", color: "#2c5282" },
      { kind: "sofa_large", name: "长沙发·灰", seatMode: "fixed", defaultSeats: 0, styleId: "slate", color: "#64748b" },
      { kind: "sofa_loveseat", name: "双人·米白", seatMode: "fixed", defaultSeats: 0, styleId: "white", color: "#e2e8f0" },
      { kind: "sofa_loveseat", name: "双人·棕", seatMode: "fixed", defaultSeats: 0, styleId: "walnut", color: "#5c4033" },
      { kind: "sofa_corner", name: "转角·石板", seatMode: "fixed", defaultSeats: 0, styleId: "slate", color: "#475569" },
      { kind: "sofa_corner", name: "转角·青绿", seatMode: "fixed", defaultSeats: 0, styleId: "teal", color: "#319795" },
    ],
  },
  {
    id: "table",
    name: "茶几",
    category: "furniture",
    icon: "layout-grid-line",
    variants: [
      { kind: "coffee_table", name: "方形·橡木", seatMode: "fixed", defaultSeats: 0, styleId: "oak", color: "#d4a574" },
      { kind: "coffee_table", name: "方形·胡桃", seatMode: "fixed", defaultSeats: 0, styleId: "walnut", color: "#6f4e37" },
      { kind: "coffee_table_round", name: "圆·白", seatMode: "fixed", defaultSeats: 0, styleId: "white", color: "#f8fafc" },
      { kind: "coffee_table_round", name: "圆·深色", seatMode: "fixed", defaultSeats: 0, styleId: "slate", color: "#475569" },
      { kind: "coffee_table_glass", name: "玻璃茶几", seatMode: "fixed", defaultSeats: 0, styleId: "default", color: "#a8d4e8" },
    ],
  },
  {
    id: "door",
    name: "门",
    category: "structure",
    icon: "door-open-line",
    variants: [
      { kind: "door", name: "单开门·木色", seatMode: "fixed", defaultSeats: 0, styleId: "oak", color: "#a16207" },
      { kind: "door", name: "单开门·白", seatMode: "fixed", defaultSeats: 0, styleId: "white", color: "#f1f5f9" },
      { kind: "door_glass", name: "玻璃门", seatMode: "fixed", defaultSeats: 0, styleId: "default", color: "#7dd3fc" },
      { kind: "door_double", name: "双开门·木", seatMode: "fixed", defaultSeats: 0, styleId: "walnut", color: "#92400e" },
      { kind: "door_double_glass", name: "双开玻璃门", seatMode: "fixed", defaultSeats: 0, styleId: "glass", color: "#64748b" },
      { kind: "opening", name: "自定义切墙", seatMode: "fixed", defaultSeats: 0, styleId: "default" },
    ],
  },
  {
    id: "reception",
    name: "前台",
    category: "furniture",
    icon: "customer-service-line",
    variants: [
      { kind: "reception_desk", name: "经典回字形", seatMode: "fixed", defaultSeats: 0, styleId: "default" },
      { kind: "reception_glass", name: "烟玻抬层", seatMode: "fixed", defaultSeats: 0, styleId: "glass" },
      { kind: "reception_split", name: "黑白分体", seatMode: "fixed", defaultSeats: 0, styleId: "slate" },
      { kind: "reception_arch", name: "拱底蓝条", seatMode: "fixed", defaultSeats: 0, styleId: "navy" },
      { kind: "reception_minimal", name: "极简白灰", seatMode: "fixed", defaultSeats: 0, styleId: "white" },
      { kind: "reception_marble", name: "大理石木饰", seatMode: "fixed", defaultSeats: 0, styleId: "oak" },
    ],
  },
  {
    id: "window",
    name: "窗",
    category: "structure",
    icon: "window-line",
    variants: [
      { kind: "window", name: "普通窗", seatMode: "fixed", defaultSeats: 0, styleId: "default" },
      { kind: "window_wide", name: "落地宽窗", seatMode: "fixed", defaultSeats: 0, styleId: "default" },
      { kind: "window_wide", name: "宽窗·蓝玻璃感", seatMode: "fixed", defaultSeats: 0, styleId: "navy", color: "#93c5fd" },
    ],
  },
  {
    id: "plant",
    name: "绿植",
    category: "plants",
    icon: "leaf-line",
    variants: [
      { kind: "plant", name: "盆栽", seatMode: "fixed", defaultSeats: 0, styleId: "teal" },
      { kind: "plant_large", name: "大型绿植", seatMode: "fixed", defaultSeats: 0, styleId: "teal" },
      { kind: "tree", name: "室内树", seatMode: "fixed", defaultSeats: 0, styleId: "teal" },
      { kind: "bush", name: "灌木", seatMode: "fixed", defaultSeats: 0, styleId: "teal" },
      { kind: "flower", name: "花卉", seatMode: "fixed", defaultSeats: 0, styleId: "default" },
      { kind: "flower_pot", name: "花盆", seatMode: "fixed", defaultSeats: 0, styleId: "oak" },
    ],
  },
  {
    id: "rooms",
    name: "办公室",
    category: "rooms",
    icon: "building-line",
    variants: [
      { kind: "room_finance", name: "财务办公室", seatMode: "fixed", defaultSeats: 0, styleId: "teal" },
      { kind: "room_sales", name: "销售办公室", seatMode: "fixed", defaultSeats: 0, styleId: "navy" },
      { kind: "room_tech", name: "技术办公室", seatMode: "fixed", defaultSeats: 0, styleId: "slate" },
      { kind: "room_procure", name: "采购办公室", seatMode: "fixed", defaultSeats: 0, styleId: "oak" },
      { kind: "room_code", name: "代码办公室", seatMode: "fixed", defaultSeats: 0, styleId: "walnut" },
    ],
  },
];

/** Singleton families for remaining catalog items not in CATALOG_FAMILIES. */
export function familiesForCategory(category: CatalogCategoryId): CatalogFamily[] {
  const listed = CATALOG_FAMILIES.filter((f) => f.category === category);
  const covered = new Set(listed.flatMap((f) => f.variants.map((v) => v.kind)));
  const extras: CatalogFamily[] = [];
  for (const item of OFFICE_CATALOG.filter((c) => c.category === category)) {
    if (covered.has(item.kind)) continue;
    extras.push({
      id: `solo_${item.kind}`,
      name: item.name,
      category,
      icon: "box-3-line",
      variants: [
        { kind: item.kind, name: `${item.name}·默认`, seatMode: "fixed", defaultSeats: 0, styleId: "default" },
        {
          kind: item.kind,
          name: `${item.name}·橡木感`,
          seatMode: "fixed",
          defaultSeats: 0,
          styleId: "oak",
          color: "#d4a574",
        },
        {
          kind: item.kind,
          name: `${item.name}·石板灰`,
          seatMode: "fixed",
          defaultSeats: 0,
          styleId: "slate",
          color: "#64748b",
        },
        {
          kind: item.kind,
          name: `${item.name}·青绿`,
          seatMode: "fixed",
          defaultSeats: 0,
          styleId: "teal",
          color: "#2c7a7b",
        },
      ],
    });
  }
  return [...listed, ...extras];
}
