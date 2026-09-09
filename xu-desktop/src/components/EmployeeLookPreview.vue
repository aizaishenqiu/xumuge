<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import * as THREE from "three";
import { makePerson } from "../office/personMesh";
import type { Gender } from "../utils/employees";

const props = withDefaults(
  defineProps<{
    avatarId: string;
    gender: Gender;
    outfit: string;
    hairStyle: string;
    /** false = 单帧静态预览，避免语音通话时 WebGL 持续渲染导致 WebView 崩溃 */
    animated?: boolean;
  }>(),
  { animated: true },
);

const host = ref<HTMLElement | null>(null);
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let person: THREE.Group | null = null;
let animId = 0;
let yaw = 0.35;

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry?.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
  });
}

function rebuild() {
  if (!scene) return;
  if (person) {
    scene.remove(person);
    disposeObject(person);
    person = null;
  }
  person = makePerson(
    props.avatarId,
    props.gender,
    1.15,
    props.outfit,
    props.hairStyle,
    "stand",
  );
  person.rotation.y = yaw;
  scene.add(person);
}

function frame() {
  if (!props.animated) return;
  animId = requestAnimationFrame(frame);
  if (person) {
    yaw += 0.008;
    person.rotation.y = yaw;
  }
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function renderOnce() {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

onMounted(() => {
  if (!host.value) return;
  const w = host.value.clientWidth || 160;
  const h = host.value.clientHeight || 220;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8eef4);
  camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 20);
  camera.position.set(0.9, 1.35, 2.4);
  camera.lookAt(0, 0.75, 0);
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, props.animated ? 2 : 1));
  renderer.setSize(w, h, false);
  host.value.appendChild(renderer.domElement);
  const amb = new THREE.AmbientLight(0xffffff, 0.85);
  const dir = new THREE.DirectionalLight(0xffffff, 0.65);
  dir.position.set(2, 4, 3);
  scene.add(amb, dir);
  rebuild();
  if (props.animated) frame();
  else renderOnce();
});

watch(
  () => [props.avatarId, props.gender, props.outfit, props.hairStyle] as const,
  () => {
    rebuild();
    if (!props.animated) renderOnce();
  },
);

onUnmounted(() => {
  cancelAnimationFrame(animId);
  if (person && scene) {
    scene.remove(person);
    disposeObject(person);
  }
  renderer?.dispose();
  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement);
  }
  renderer = null;
  scene = null;
  camera = null;
});
</script>

<template>
  <div ref="host" class="look-preview" aria-label="职员造型预览" />
</template>

<style scoped>
.look-preview {
  width: 160px;
  height: 220px;
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--border, #cbd5e1) 80%, transparent);
  background: #e8eef4;
}
.look-preview :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
