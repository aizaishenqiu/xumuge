/** Mixamo / skinned human characters — SkeletonUtils + AnimationMixer. */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { CHARACTER_ASSET_MAP, type GltfAssetDef } from "./assets/registry";

const loader = new GLTFLoader();

interface CharTemplate {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

const templates = new Map<string, CharTemplate>();
const inflight = new Map<string, Promise<CharTemplate | null>>();

export type PersonPose = "sit" | "stand";

async function loadCharTemplate(url: string): Promise<CharTemplate | null> {
  const hit = templates.get(url);
  if (hit) return hit;
  const pending = inflight.get(url);
  if (pending) return pending;

  const job = loader
    .loadAsync(url)
    .then((gltf) => {
      const tpl: CharTemplate = {
        scene: gltf.scene,
        animations: gltf.animations ?? [],
      };
      tpl.scene.updateMatrixWorld(true);
      templates.set(url, tpl);
      inflight.delete(url);
      return tpl;
    })
    .catch((err) => {
      console.warn("[xu] character gltf failed", url, err);
      inflight.delete(url);
      return null;
    });
  inflight.set(url, job);
  return job;
}

export function preloadCharacters(): Promise<void> {
  const urls = [...new Set(Object.values(CHARACTER_ASSET_MAP).map((a) => a.url))];
  return Promise.all(urls.map((u) => loadCharTemplate(u))).then(() => undefined);
}

function findBone(root: THREE.Object3D, ...names: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    for (const n of names) {
      if (o.name === n || o.name.endsWith(n) || o.name.includes(n)) {
        found = o;
        return;
      }
    }
  });
  return found;
}

/** Approximate seated pose on Mixamo skeleton (no Sitting clip required). */
function applySitBones(root: THREE.Object3D) {
  const hips = findBone(root, "mixamorigHips", "Hips");
  const spine = findBone(root, "mixamorigSpine", "Spine");
  const lup = findBone(root, "mixamorigLeftUpLeg", "LeftUpLeg");
  const rup = findBone(root, "mixamorigRightUpLeg", "RightUpLeg");
  const ll = findBone(root, "mixamorigLeftLeg", "LeftLeg");
  const rl = findBone(root, "mixamorigRightLeg", "RightLeg");
  if (hips) {
    hips.position.y -= 0.42;
    hips.rotation.x += 0.12;
  }
  if (spine) spine.rotation.x += 0.08;
  if (lup) lup.rotation.x = Math.PI * 0.52;
  if (rup) rup.rotation.x = Math.PI * 0.52;
  if (ll) ll.rotation.x = -Math.PI * 0.48;
  if (rl) rl.rotation.x = -Math.PI * 0.48;
}

function pickClip(anims: THREE.AnimationClip[], pose: PersonPose): THREE.AnimationClip | null {
  if (!anims.length) return null;
  const lower = anims.map((a) => ({ a, n: a.name.toLowerCase() }));
  if (pose === "sit") {
    const sit = lower.find((x) => x.n.includes("sit"));
    if (sit) return sit.a;
    // No sit clip → caller applies bone sit; still prefer idle if we want upper-body idle later
    return null;
  }
  return (
    lower.find((x) => x.n === "idle" || x.n.includes("idle"))?.a ??
    lower.find((x) => x.n.includes("stand"))?.a ??
    anims[0]
  );
}

function tintRoot(root: THREE.Object3D, hex: string, strength: number) {
  const target = new THREE.Color(hex);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && "color" in m && m.color instanceof THREE.Color) {
        m.color.lerp(target, strength);
      }
    }
  });
}

function prepareMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
    else if (o.material) o.material = o.material.clone();
  });
}

export interface HumanCharacterResult {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
}

/**
 * Build a realistic Mixamo human for the office.
 * Call `mixer?.update(dt)` each frame from the scene loop.
 */
export function tryMakeHumanCharacter(
  avatarId: string,
  opts: {
    tintHex?: string;
    scale?: number;
    pose?: PersonPose;
    gender?: "male" | "female";
  } = {},
): HumanCharacterResult | null {
  const def: GltfAssetDef | undefined =
    CHARACTER_ASSET_MAP[avatarId] ?? CHARACTER_ASSET_MAP.classic;
  if (!def) return null;
  const tpl = templates.get(def.url);
  if (!tpl) return null;

  const cloned = cloneSkinned(tpl.scene);
  prepareMaterials(cloned);
  if (opts.tintHex) tintRoot(cloned, opts.tintHex, 0.2);

  const wrap = new THREE.Group();
  wrap.add(cloned);

  const s =
    (def.scale ?? 1) *
    (opts.scale ?? 1) *
    (opts.gender === "female" ? 0.94 : 1) *
    (opts.pose === "sit" ? 0.96 : 1);
  wrap.scale.setScalar(s);
  wrap.rotation.y = Math.PI + (def.yaw ?? 0);

  // Feet on floor
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  if (Number.isFinite(box.min.y)) wrap.position.y -= box.min.y;
  if (def.y) wrap.position.y += def.y;

  let mixer: THREE.AnimationMixer | null = null;
  const pose = opts.pose ?? "stand";
  const clip = pickClip(tpl.animations, pose);

  if (pose === "sit") {
    // Prefer real Sitting clip; otherwise bone-approximate sit (do NOT play standing idle).
    if (clip) {
      mixer = new THREE.AnimationMixer(cloned);
      const action = mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
    } else {
      applySitBones(cloned);
    }
    wrap.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(wrap);
    if (Number.isFinite(b2.min.y)) wrap.position.y -= b2.min.y;
  } else if (clip) {
    mixer = new THREE.AnimationMixer(cloned);
    const action = mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
  }

  wrap.userData.fromGltf = true;
  wrap.userData.avatarId = avatarId;
  wrap.userData.mixer = mixer;
  wrap.userData.humanCharacter = true;

  return { root: wrap, mixer };
}

/** Preload then build (async). */
export async function makeHumanCharacterAsync(
  avatarId: string,
  opts: {
    tintHex?: string;
    scale?: number;
    pose?: PersonPose;
    gender?: "male" | "female";
  } = {},
): Promise<HumanCharacterResult | null> {
  const def = CHARACTER_ASSET_MAP[avatarId] ?? CHARACTER_ASSET_MAP.classic;
  if (!def) return null;
  await loadCharTemplate(def.url);
  return tryMakeHumanCharacter(avatarId, opts);
}

/** Tick all mixers under a people group. */
export function updateCharacterMixers(root: THREE.Object3D | null, dt: number) {
  if (!root) return;
  root.traverse((o) => {
    const m = o.userData?.mixer as THREE.AnimationMixer | undefined;
    if (m) m.update(dt);
  });
}
