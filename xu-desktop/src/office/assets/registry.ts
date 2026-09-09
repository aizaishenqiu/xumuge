/** Office GLTF registry — only CC0 / CC BY / Mixamo (no SA / NC / Editorial / paid). */

import type { PropKind } from "../catalog";

export type AssetLicense = "CC0" | "CC-BY" | "Mixamo";

export interface GltfAssetDef {
  id: string;
  /** URL under Vite public/ */
  url: string;
  license: AssetLicense;
  source: string;
  /** Uniform scale after load */
  scale?: number;
  /** Y lift so feet/base sit on floor */
  y?: number;
  /** Extra yaw in radians */
  yaw?: number;
}

/** Prop kind → preferred Poly Haven (or Sketchfab) asset */
export const PROP_ASSET_MAP: Partial<Record<PropKind, GltfAssetDef>> = {
  desk: {
    id: "metal_office_desk",
    url: "/office-assets/polyhaven/metal_office_desk/metal_office_desk_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/metal_office_desk",
    scale: 0.62,
    y: 0,
  },
  desk_compact: {
    id: "metal_office_desk",
    url: "/office-assets/polyhaven/metal_office_desk/metal_office_desk_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/metal_office_desk",
    scale: 0.5,
  },
  desk_exec: {
    id: "metal_office_desk",
    url: "/office-assets/polyhaven/metal_office_desk/metal_office_desk_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/metal_office_desk",
    scale: 0.85,
  },
  chair_exec: {
    id: "modern_arm_chair_01",
    url: "/office-assets/polyhaven/modern_arm_chair_01/modern_arm_chair_01_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/modern_arm_chair_01",
    scale: 0.95,
  },
  plant: {
    id: "potted_plant_01",
    url: "/office-assets/polyhaven/potted_plant_01/potted_plant_01_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/potted_plant_01",
    scale: 0.55,
  },
  plant_large: {
    id: "potted_plant_02",
    url: "/office-assets/polyhaven/potted_plant_02/potted_plant_02_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/potted_plant_02",
    scale: 0.85,
  },
  flower_pot: {
    id: "potted_plant_04",
    url: "/office-assets/polyhaven/potted_plant_04/potted_plant_04_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/potted_plant_04",
    scale: 0.45,
  },
  sofa: {
    id: "Sofa_01",
    url: "/office-assets/polyhaven/Sofa_01/Sofa_01_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/Sofa_01",
    scale: 0.9,
  },
  sofa_large: {
    id: "sofa_02",
    url: "/office-assets/polyhaven/sofa_02/sofa_02_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/sofa_02",
    scale: 1.05,
  },
  sofa_loveseat: {
    id: "Sofa_01",
    url: "/office-assets/polyhaven/Sofa_01/Sofa_01_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/Sofa_01",
    scale: 0.72,
  },
  coffee_table: {
    id: "modern_coffee_table_01",
    url: "/office-assets/polyhaven/modern_coffee_table_01/modern_coffee_table_01_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/modern_coffee_table_01",
    scale: 0.85,
  },
  coffee_table_round: {
    id: "modern_coffee_table_01",
    url: "/office-assets/polyhaven/modern_coffee_table_01/modern_coffee_table_01_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/modern_coffee_table_01",
    scale: 0.7,
  },
  cabinet: {
    id: "modern_wooden_cabinet",
    url: "/office-assets/polyhaven/modern_wooden_cabinet/modern_wooden_cabinet_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/modern_wooden_cabinet",
    scale: 0.8,
  },
  shelf: {
    id: "wooden_bookshelf_worn",
    url: "/office-assets/polyhaven/wooden_bookshelf_worn/wooden_bookshelf_worn_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/wooden_bookshelf_worn",
    scale: 0.75,
  },
  coffee: {
    id: "CoffeeCart_01",
    url: "/office-assets/polyhaven/CoffeeCart_01/CoffeeCart_01_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/CoffeeCart_01",
    scale: 0.7,
  },
  floor_lamp: {
    id: "desk_lamp_arm_01",
    url: "/office-assets/polyhaven/desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/desk_lamp_arm_01",
    scale: 0.9,
  },
  whiteboard: {
    id: "projector_screen",
    url: "/office-assets/polyhaven/projector_screen/projector_screen_1k.gltf",
    license: "CC0",
    source: "https://polyhaven.com/a/projector_screen",
    scale: 0.55,
    yaw: Math.PI,
  },
};

/** Avatar → Mixamo human GLB（真人向；需 Idle，坐姿用骨骼近似） */
const XBOT: GltfAssetDef = {
  id: "mixamo_xbot",
  url: "/office-assets/characters/mixamo_xbot.glb",
  license: "Mixamo",
  source: "https://www.mixamo.com",
  scale: 0.88,
  y: 0,
};

const SOLDIER: GltfAssetDef = {
  id: "mixamo_soldier",
  url: "/office-assets/characters/mixamo_soldier.glb",
  license: "Mixamo",
  source: "https://www.mixamo.com",
  scale: 0.86,
  y: 0,
};

export const CHARACTER_ASSET_MAP: Record<string, GltfAssetDef> = {
  classic: { ...XBOT, scale: 0.88 },
  warm: { ...XBOT, scale: 0.87 },
  mint: { ...XBOT, scale: 0.86 },
  ink: { ...SOLDIER, scale: 0.85 },
  violet: { ...XBOT, scale: 0.87 },
  sand: { ...XBOT, scale: 0.88 },
  sky: { ...XBOT, scale: 0.87 },
  rose: { ...XBOT, scale: 0.86 },
  nova: { ...XBOT, scale: 0.88 },
  ember: { ...SOLDIER, scale: 0.86 },
  jade: { ...XBOT, scale: 0.85 },
  slate: { ...SOLDIER, scale: 0.87 },
};

export function allPreloadUrls(): string[] {
  const set = new Set<string>();
  for (const a of Object.values(PROP_ASSET_MAP)) {
    if (a) set.add(a.url);
  }
  // 人物暂不预加载裸 Mixamo T-Pose；办公室用程序化小人。
  return [...set];
}
