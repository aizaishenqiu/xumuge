/** Appearance catalogs for AI employees (3D mesh driven). */

export type HairStyleId =
  | "short"
  | "side"
  | "spiky"
  | "undercut"
  | "long"
  | "bob"
  | "pony"
  | "bun"
  | "wavy"
  | "fringe";

export type OutfitId =
  | "casual"
  | "formal"
  | "hoodie"
  | "tech"
  | "dress"
  | "suit"
  | "vest"
  | "navy_suit"
  | "biz_casual"
  | "beige_blazer"
  | "black_suit"
  | "skirt_suit";

export type OutfitSilhouette =
  | "default"
  | "hoodie"
  | "dress"
  | "suit"
  | "vest"
  | "blazer"
  | "rolled"
  | "skirt";

export interface HairStyleOption {
  id: HairStyleId;
  name: string;
  genders: Array<"male" | "female" | "any">;
}

export interface OutfitOption {
  id: OutfitId;
  name: string;
  /** Shirt / inner top hex */
  top: string;
  /** Pants / skirt / bottom hex */
  bottom: string;
  /** Outer layer (vest / blazer) when silhouette needs it */
  outer?: string;
  genders: Array<"male" | "female" | "any">;
  silhouette?: OutfitSilhouette;
  glasses?: "round" | "thin" | "none";
  /** Tie / accent color */
  accent?: string;
  /** Shoe color override */
  shoes?: string;
}

export const HAIR_STYLES: HairStyleOption[] = [
  { id: "short", name: "短发", genders: ["male", "any"] },
  { id: "side", name: "侧分", genders: ["male", "any"] },
  { id: "spiky", name: "碎盖", genders: ["male", "any"] },
  { id: "undercut", name: "油头", genders: ["male", "any"] },
  { id: "long", name: "长直", genders: ["female", "any"] },
  { id: "bob", name: "波波头", genders: ["female", "any"] },
  { id: "fringe", name: "刘海短发", genders: ["female", "any"] },
  { id: "pony", name: "马尾", genders: ["female", "any"] },
  { id: "bun", name: "丸子头", genders: ["female", "any"] },
  { id: "wavy", name: "微卷", genders: ["female", "any"] },
];

export const OUTFITS: OutfitOption[] = [
  {
    id: "casual",
    name: "休闲",
    top: "#3d6b8c",
    bottom: "#2a323c",
    genders: ["any"],
    silhouette: "default",
  },
  {
    id: "formal",
    name: "白衬衫正装",
    top: "#f0f2f5",
    bottom: "#1e293b",
    genders: ["any"],
    silhouette: "suit",
    accent: "#334155",
  },
  {
    id: "hoodie",
    name: "卫衣",
    top: "#64748b",
    bottom: "#334155",
    genders: ["any"],
    silhouette: "hoodie",
  },
  {
    id: "tech",
    name: "极客黑",
    top: "#111827",
    bottom: "#1f2937",
    genders: ["any"],
    silhouette: "default",
  },
  {
    id: "dress",
    name: "裙装",
    top: "#b85c6e",
    bottom: "#7a3544",
    genders: ["female", "any"],
    silhouette: "dress",
    shoes: "#1a1a1c",
  },
  {
    id: "suit",
    name: "藏青西装",
    top: "#1e3a5f",
    bottom: "#0f172a",
    genders: ["male", "any"],
    silhouette: "suit",
    accent: "#8b1e2d",
  },
  {
    id: "vest",
    name: "黑马甲领带",
    top: "#f5f5f7",
    bottom: "#111827",
    outer: "#0f172a",
    genders: ["male", "any"],
    silhouette: "vest",
    accent: "#111827",
  },
  {
    id: "navy_suit",
    name: "藏青西装裙",
    top: "#f8fafc",
    bottom: "#1e3a5f",
    outer: "#1e3a5f",
    genders: ["female", "any"],
    silhouette: "skirt",
    glasses: "round",
    shoes: "#0f172a",
  },
  {
    id: "biz_casual",
    name: "商务休闲",
    top: "#7ba3c4",
    bottom: "#6b7280",
    genders: ["any"],
    silhouette: "rolled",
    glasses: "round",
    shoes: "#f1f5f9",
  },
  {
    id: "beige_blazer",
    name: "米色西装",
    top: "#f8fafc",
    bottom: "#8b7355",
    outer: "#c4a574",
    genders: ["female", "any"],
    silhouette: "blazer",
    shoes: "#f8fafc",
  },
  {
    id: "black_suit",
    name: "黑色正装",
    top: "#f8fafc",
    bottom: "#0f172a",
    outer: "#0f172a",
    genders: ["male", "any"],
    silhouette: "blazer",
    accent: "#1e293b",
  },
  {
    id: "skirt_suit",
    name: "千鸟格裙装",
    top: "#111827",
    bottom: "#e8e8e8",
    outer: "#1a1a1c",
    genders: ["female", "any"],
    silhouette: "skirt",
    shoes: "#7f1d1d",
  },
];

export function hairStylesFor(gender: "male" | "female"): HairStyleOption[] {
  return HAIR_STYLES.filter((h) => h.genders.includes(gender) || h.genders.includes("any"));
}

export function outfitsFor(gender: "male" | "female"): OutfitOption[] {
  return OUTFITS.filter((o) => o.genders.includes(gender) || o.genders.includes("any"));
}

export function getOutfit(id: string | undefined | null): OutfitOption {
  return OUTFITS.find((o) => o.id === id) ?? OUTFITS[0];
}

export function getHairStyle(id: string | undefined | null): HairStyleOption {
  return HAIR_STYLES.find((h) => h.id === id) ?? HAIR_STYLES[0];
}
