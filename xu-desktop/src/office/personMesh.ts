/** Procedural employee body mesh — shared by office scene + look preview.
 * Prefers Mixamo 真人 (Idle / 坐姿骨骼)；资源未就绪时回退程序化小人。
 */

import * as THREE from "three";
import { getAvatar, type Gender } from "../utils/employees";
import { getHairStyle, getOutfit, type HairStyleId } from "./appearance";

function makeMat(color: number | string | undefined, opts: THREE.MeshStandardMaterialParameters = {}) {
  const safeColor = color ?? 0x888888;
  const { color: optColor, emissive: optEmissive, ...rest } = opts;
  const params: THREE.MeshStandardMaterialParameters = {
    color: optColor ?? safeColor,
    roughness: 0.72,
    metalness: 0.08,
    ...rest,
  };
  if (optEmissive !== undefined && optEmissive !== null) {
    params.emissive = optEmissive as THREE.ColorRepresentation;
  }
  return new THREE.MeshStandardMaterial(params);
}

function hairColorFor(gender: Gender, avatarId: string): number {
  if (gender === "female") {
    const map: Record<string, number> = {
      classic: 0x3a2a22,
      warm: 0x6b3a28,
      mint: 0x2c241c,
      ink: 0x1a1a1c,
      violet: 0x4a3058,
      sand: 0x8a6238,
      sky: 0x3a2e28,
      rose: 0x5a2838,
    };
    return map[avatarId] ?? 0x3a2a22;
  }
  return 0x2a2220;
}

function addHair(
  g: THREE.Group,
  style: HairStyleId,
  hairCol: number,
  headR: number,
  s: number,
  headY = 0.9,
) {
  const mat = makeMat(hairCol, { roughness: 0.75 });
  const y = headY;
  if (style === "short" || style === "side" || style === "spiky" || style === "undercut") {
    const topScale = style === "undercut" ? 1.12 : style === "spiky" ? 1.08 : 1.02;
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(headR * topScale, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.48),
      mat,
    );
    top.position.y = y + (style === "undercut" ? 0.08 * s : 0.06 * s);
    g.add(top);
    if (style === "side" || style === "undercut") {
      const side = new THREE.Mesh(new THREE.CapsuleGeometry(0.035 * s, 0.12 * s, 4, 8), mat);
      side.position.set(headR * 0.9, y - 0.02 * s, 0);
      g.add(side);
      const sweep = new THREE.Mesh(new THREE.CapsuleGeometry(0.04 * s, 0.08 * s, 4, 8), mat);
      sweep.position.set(-headR * 0.35, y + 0.1 * s, -headR * 0.2);
      sweep.rotation.z = 0.4;
      g.add(sweep);
    }
    if (style === "spiky") {
      for (let i = 0; i < 4; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03 * s, 0.1 * s, 5), mat);
        const a = (i / 4) * Math.PI - Math.PI / 2;
        spike.position.set(Math.cos(a) * headR * 0.5, y + 0.14 * s, Math.sin(a) * headR * 0.3);
        g.add(spike);
      }
    }
    return;
  }
  if (style === "bob" || style === "fringe") {
    const fringe = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 1.12, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      mat,
    );
    fringe.position.y = y + 0.02 * s;
    g.add(fringe);
    if (style === "fringe") {
      const bangs = new THREE.Mesh(new THREE.BoxGeometry(headR * 1.6, 0.06 * s, 0.04 * s), mat);
      bangs.position.set(0, y + 0.04 * s, -headR * 0.95);
      g.add(bangs);
    }
    return;
  }
  if (style === "long" || style === "wavy") {
    const fringe = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      mat,
    );
    fringe.position.y = y + 0.05 * s;
    g.add(fringe);
    for (const sx of [-1, 1] as const) {
      const lock = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.045 * s, style === "wavy" ? 0.28 * s : 0.34 * s, 4, 8),
        mat,
      );
      lock.position.set(sx * headR * 0.95, y - 0.12 * s, -0.02 * s);
      g.add(lock);
    }
    return;
  }
  if (style === "pony") {
    const fringe = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 1.04, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      mat,
    );
    fringe.position.y = y + 0.05 * s;
    g.add(fringe);
    const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.05 * s, 0.28 * s, 4, 8), mat);
    pony.position.set(0, y - 0.05 * s, -headR * 0.95);
    pony.rotation.x = 0.4;
    g.add(pony);
    return;
  }
  const fringe = new THREE.Mesh(
    new THREE.SphereGeometry(headR * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    mat,
  );
  fringe.position.y = y + 0.05 * s;
  g.add(fringe);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.55, 12, 12), mat);
  bun.position.set(0, y + 0.14 * s, -headR * 0.35);
  g.add(bun);
}

export function makePerson(
  avatarId: string,
  gender: Gender = "male",
  scale = 1,
  outfitId: string = "casual",
  hairId: string = "short",
  pose: "sit" | "stand" = "stand",
): THREE.Group {
  // X Bot / Soldier 是关节假人，不是真人；暂不启用 Mixamo 网格，避免「骨架」观感。
  // 真人员工需带皮肤/服装的 Mixamo 角色或 Ready Player Me GLB（后续接入）。
  const avatar = getAvatar(avatarId);
  const outfit = getOutfit(outfitId);
  const hairStyle = getHairStyle(hairId).id as HairStyleId;
  const g = new THREE.Group();
  const female = gender === "female";
  const s = scale * (female ? 0.96 : 1.02);
  const skin = avatar.skin;
  const shirt = outfit.top;
  const pants = outfit.bottom;
  const outer = outfit.outer ?? outfit.top;
  const shoes = outfit.shoes ?? 0x1a1a1c;
  const hairCol = hairColorFor(gender, avatarId);
  const sitting = pose === "sit";
  const sil = outfit.silhouette ?? "default";
  const isSkirt = sil === "dress" || sil === "skirt";

  const box = (
    w: number,
    h: number,
    d: number,
    color: number | string,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMat(color, { roughness: 0.65 }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };

  const torsoW = female ? 0.28 * s : 0.34 * s;
  let torsoY: number;
  let armY: number;
  let neckY: number;
  let headY: number;

  if (sitting) {
    box(0.11 * s, 0.1 * s, 0.28 * s, pants, -0.07 * s, 0.48 * s, -0.06 * s);
    box(0.11 * s, 0.1 * s, 0.28 * s, pants, 0.07 * s, 0.48 * s, -0.06 * s);
    box(0.1 * s, 0.28 * s, 0.1 * s, pants, -0.07 * s, 0.28 * s, 0.12 * s);
    box(0.1 * s, 0.28 * s, 0.1 * s, pants, 0.07 * s, 0.28 * s, 0.12 * s);
    box(0.11 * s, 0.06 * s, 0.14 * s, shoes, -0.07 * s, 0.1 * s, 0.14 * s);
    box(0.11 * s, 0.06 * s, 0.14 * s, shoes, 0.07 * s, 0.1 * s, 0.14 * s);
    torsoY = 0.72 * s;
    armY = 0.75 * s;
    neckY = 0.92 * s;
    headY = 1.08 * s;
  } else if (isSkirt) {
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2 * s, sil === "skirt" ? 0.24 * s : 0.28 * s, 0.4 * s, 12),
      makeMat(pants, { roughness: 0.7 }),
    );
    skirt.position.y = 0.28 * s;
    skirt.castShadow = true;
    g.add(skirt);
    box(0.09 * s, 0.16 * s, 0.1 * s, skin, -0.06 * s, 0.08 * s, 0);
    box(0.09 * s, 0.16 * s, 0.1 * s, skin, 0.06 * s, 0.08 * s, 0);
    box(0.1 * s, 0.05 * s, 0.18 * s, shoes, -0.07 * s, 0.03 * s, 0.02 * s);
    box(0.1 * s, 0.05 * s, 0.18 * s, shoes, 0.07 * s, 0.03 * s, 0.02 * s);
    box(0.04 * s, 0.06 * s, 0.04 * s, shoes, -0.07 * s, 0.01 * s, -0.06 * s);
    box(0.04 * s, 0.06 * s, 0.04 * s, shoes, 0.07 * s, 0.01 * s, -0.06 * s);
    torsoY = 0.55 * s;
    armY = 0.58 * s;
    neckY = 0.74 * s;
    headY = 0.9 * s;
  } else {
    box(0.1 * s, 0.38 * s, 0.12 * s, pants, -0.07 * s, 0.2 * s, 0);
    box(0.1 * s, 0.38 * s, 0.12 * s, pants, 0.07 * s, 0.2 * s, 0);
    box(0.11 * s, 0.06 * s, 0.16 * s, shoes, -0.07 * s, 0.03 * s, 0.02 * s);
    box(0.11 * s, 0.06 * s, 0.16 * s, shoes, 0.07 * s, 0.03 * s, 0.02 * s);
    torsoY = 0.55 * s;
    armY = 0.58 * s;
    neckY = 0.74 * s;
    headY = 0.9 * s;
  }

  if (sil === "hoodie") {
    const hood = new THREE.Mesh(
      new THREE.CapsuleGeometry(torsoW * 0.48, 0.32 * s, 6, 12),
      makeMat(shirt, { roughness: 0.85 }),
    );
    hood.position.y = torsoY;
    hood.castShadow = true;
    g.add(hood);
    const hoodCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.12 * s, 10, 10),
      makeMat(shirt, { roughness: 0.85 }),
    );
    hoodCap.position.set(0, torsoY + 0.22 * s, -0.06 * s);
    g.add(hoodCap);
  } else if (sil === "dress" && sitting) {
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2 * s, 0.26 * s, 0.28 * s, 12),
      makeMat(pants, { roughness: 0.7 }),
    );
    skirt.position.set(0, 0.52 * s, 0.04 * s);
    g.add(skirt);
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(torsoW * 0.42, 0.22 * s, 6, 12),
      makeMat(shirt, { roughness: 0.7 }),
    );
    torso.position.y = torsoY;
    g.add(torso);
  } else {
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(torsoW * 0.4, 0.28 * s, 6, 12),
      makeMat(shirt, { roughness: 0.55 }),
    );
    torso.position.y = torsoY;
    torso.castShadow = true;
    g.add(torso);

    if (sil === "vest") {
      box(torsoW * 0.95, 0.32 * s, torsoW * 0.85, outer, 0, torsoY - 0.02 * s, 0.01 * s);
      box(0.05 * s, 0.22 * s, 0.02 * s, outfit.accent ?? 0x111827, 0, torsoY + 0.02 * s, torsoW * 0.42);
      box(0.04 * s, 0.03 * s, 0.01 * s, 0xf8fafc, torsoW * 0.28, torsoY + 0.06 * s, torsoW * 0.42);
    } else if (sil === "blazer" || sil === "skirt" || sil === "suit") {
      box(torsoW * 0.42, 0.34 * s, 0.08 * s, outer, -torsoW * 0.28, torsoY - 0.01 * s, 0.02 * s);
      box(torsoW * 0.42, 0.34 * s, 0.08 * s, outer, torsoW * 0.28, torsoY - 0.01 * s, 0.02 * s);
      box(0.06 * s, 0.14 * s, 0.03 * s, outer, -torsoW * 0.12, torsoY + 0.08 * s, torsoW * 0.4);
      box(0.06 * s, 0.14 * s, 0.03 * s, outer, torsoW * 0.12, torsoY + 0.08 * s, torsoW * 0.4);
      if (sil === "suit" || sil === "blazer") {
        const tie = outfit.accent ?? avatar.accent;
        box(0.05 * s, 0.2 * s, 0.02 * s, tie, 0, torsoY + 0.02 * s, torsoW * 0.42);
      }
      if (sil === "skirt") {
        box(0.03 * s, 0.03 * s, 0.02 * s, 0xc0c0c0, -torsoW * 0.22, torsoY + 0.1 * s, torsoW * 0.45);
      }
    } else if (outfit.id === "formal" || outfit.id === "suit") {
      box(0.06 * s, 0.22 * s, 0.02 * s, outfit.accent ?? avatar.accent, 0, torsoY + 0.03 * s, torsoW * 0.4);
    }
  }

  const rolled = sil === "rolled" || sil === "vest" || sil === "blazer";
  if (sitting) {
    box(0.08 * s, 0.1 * s, 0.22 * s, shirt, -torsoW * 0.5, armY - 0.02 * s, -0.12 * s);
    box(0.08 * s, 0.1 * s, 0.22 * s, shirt, torsoW * 0.5, armY - 0.02 * s, -0.12 * s);
    box(0.07 * s, 0.07 * s, 0.07 * s, skin, -torsoW * 0.5, armY - 0.04 * s, -0.24 * s);
    box(0.07 * s, 0.07 * s, 0.07 * s, skin, torsoW * 0.5, armY - 0.04 * s, -0.24 * s);
  } else if (rolled) {
    box(0.08 * s, 0.18 * s, 0.08 * s, shirt, -torsoW * 0.55, armY + 0.04 * s, 0);
    box(0.08 * s, 0.18 * s, 0.08 * s, shirt, torsoW * 0.55, armY + 0.04 * s, 0);
    box(0.07 * s, 0.16 * s, 0.07 * s, skin, -torsoW * 0.55, armY - 0.12 * s, 0);
    box(0.07 * s, 0.16 * s, 0.07 * s, skin, torsoW * 0.55, armY - 0.12 * s, 0);
    box(0.075 * s, 0.03 * s, 0.075 * s, 0x111827, torsoW * 0.55, armY - 0.18 * s, 0);
  } else {
    const sleeve = sil === "skirt" ? outer : shirt;
    box(0.08 * s, 0.32 * s, 0.08 * s, sleeve, -torsoW * 0.55, armY, 0);
    box(0.08 * s, 0.32 * s, 0.08 * s, sleeve, torsoW * 0.55, armY, 0);
    box(0.07 * s, 0.08 * s, 0.07 * s, skin, -torsoW * 0.55, armY - 0.2 * s, 0);
    box(0.07 * s, 0.08 * s, 0.07 * s, skin, torsoW * 0.55, armY - 0.2 * s, 0);
  }

  box(0.08 * s, 0.08 * s, 0.08 * s, skin, 0, neckY, 0);
  const headR = female ? 0.13 * s : 0.145 * s;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headR, 20, 20),
    makeMat(skin, { roughness: 0.55 }),
  );
  head.position.y = headY;
  head.castShadow = true;
  g.add(head);

  const eyeMat = makeMat(0x1a1a1c);
  for (const sx of [-1, 1] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018 * s, 8, 8), eyeMat);
    eye.position.set(sx * 0.045 * s, headY + 0.02 * s, -headR * 0.85);
    g.add(eye);
  }

  if (outfit.glasses === "round" || outfit.glasses === "thin") {
    const frame = makeMat(0x111827, { roughness: 0.4, metalness: 0.2 });
    const r = outfit.glasses === "round" ? 0.038 * s : 0.032 * s;
    for (const sx of [-1, 1] as const) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006 * s, 6, 16), frame);
      lens.position.set(sx * 0.048 * s, headY + 0.02 * s, -headR * 0.92);
      lens.rotation.y = Math.PI / 2;
      g.add(lens);
    }
    box(0.04 * s, 0.01 * s, 0.01 * s, 0x111827, 0, headY + 0.02 * s, -headR * 0.95);
  }

  addHair(g, hairStyle, hairCol, headR, s, headY);
  g.userData.pose = pose;
  return g;
}

/** Shared low-poly avatar for crowded floors (avoids freeze on office open). */
let liteBodyGeo: THREE.CapsuleGeometry | null = null;
let liteHeadGeo: THREE.SphereGeometry | null = null;
const liteMatByColor = new Map<number, THREE.MeshBasicMaterial>();

function liteMat(colorHex: number): THREE.MeshBasicMaterial {
  let m = liteMatByColor.get(colorHex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: colorHex });
    liteMatByColor.set(colorHex, m);
  }
  return m;
}

export function makeLitePerson(colorHex: number, scale = 1): THREE.Group {
  if (!liteBodyGeo) liteBodyGeo = new THREE.CapsuleGeometry(0.14, 0.5, 3, 6);
  if (!liteHeadGeo) liteHeadGeo = new THREE.SphereGeometry(0.11, 8, 8);
  const g = new THREE.Group();
  const mat = liteMat(colorHex);
  const body = new THREE.Mesh(liteBodyGeo, mat);
  body.position.y = 0.48 * scale;
  body.scale.setScalar(scale);
  body.userData.sharedGeo = true;
  body.userData.sharedMat = true;
  g.add(body);
  const head = new THREE.Mesh(liteHeadGeo, mat);
  head.position.y = 0.98 * scale;
  head.scale.setScalar(scale);
  head.userData.sharedGeo = true;
  head.userData.sharedMat = true;
  g.add(head);
  g.userData.pose = "sit";
  g.userData.lite = true;
  return g;
}
