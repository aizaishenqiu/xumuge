/** Cached GLTF clones for office props (Poly Haven CC0). */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GltfAssetDef } from "./registry";
import { allPreloadUrls, PROP_ASSET_MAP } from "./registry";
import type { PropKind } from "../catalog";

const loader = new GLTFLoader();
/** Raw gltf.scene roots — never put these in the live scene. */
const templateByUrl = new Map<string, THREE.Object3D>();
const inflight = new Map<string, Promise<THREE.Object3D | null>>();
let preloadPromise: Promise<void> | null = null;

function prepareInstance(root: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.add(root);
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => m.clone());
      } else if (o.material) {
        o.material = o.material.clone();
      }
    }
  });
  return g;
}

async function loadTemplate(url: string): Promise<THREE.Object3D | null> {
  const hit = templateByUrl.get(url);
  if (hit) return hit;
  const pending = inflight.get(url);
  if (pending) return pending;

  const job = loader
    .loadAsync(url)
    .then((gltf) => {
      const tpl = gltf.scene;
      tpl.updateMatrixWorld(true);
      templateByUrl.set(url, tpl);
      inflight.delete(url);
      return tpl;
    })
    .catch((err) => {
      console.warn("[xu] gltf load failed", url, err);
      inflight.delete(url);
      return null;
    });
  inflight.set(url, job);
  return job;
}

export function preloadOfficeAssets(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = Promise.all(allPreloadUrls().map((u) => loadTemplate(u))).then(() => undefined);
  return preloadPromise;
}

function applyDef(instance: THREE.Group, def: GltfAssetDef): THREE.Group {
  const wrap = new THREE.Group();
  wrap.add(instance);
  const s = def.scale ?? 1;
  wrap.scale.setScalar(s);
  if (def.yaw) wrap.rotation.y = def.yaw;
  if (def.y) wrap.position.y = def.y;
  wrap.userData.assetId = def.id;
  wrap.userData.license = def.license;
  return wrap;
}

function instantiate(url: string, def: GltfAssetDef): THREE.Group | null {
  const tpl = templateByUrl.get(url);
  if (!tpl) return null;
  return applyDef(prepareInstance(tpl.clone(true)), def);
}

export async function clonePropAsset(kind: PropKind): Promise<THREE.Group | null> {
  const def = PROP_ASSET_MAP[kind];
  if (!def) return null;
  await loadTemplate(def.url);
  return instantiate(def.url, def);
}

export function tryClonePropAssetSync(kind: PropKind): THREE.Group | null {
  const def = PROP_ASSET_MAP[kind];
  if (!def) return null;
  return instantiate(def.url, def);
}
