<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import * as THREE from "three";
import { makePerson } from "../../office/personMesh";
import type { VoiceAssistantPreset } from "../../utils/voiceAssistantPrefs";
import type { VoicePhase } from "../../utils/voiceCall";

const props = defineProps<{
  preset: VoiceAssistantPreset;
  phase: VoicePhase;
}>();

const host = ref<HTMLElement | null>(null);
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let person: THREE.Object3D | null = null;
let head: THREE.Object3D | null = null;
let jaw: THREE.Mesh | null = null;
let animId = 0;
let lastTs = 0;
let t = 0;

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (!o.userData.sharedGeo) o.geometry?.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => !o.userData.sharedMat && x.dispose());
      else if (m && !o.userData.sharedMat) m.dispose();
    }
  });
}

function findHead(root: THREE.Object3D): THREE.Object3D | null {
  let best: THREE.Object3D | null = null;
  let bestY = -Infinity;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const y = o.getWorldPosition(new THREE.Vector3()).y;
    if (o.geometry instanceof THREE.SphereGeometry && y > bestY) {
      best = o;
      bestY = y;
    }
  });
  if (best) return best;
  root.traverse((o) => {
    const n = o.name.toLowerCase();
    if (!best && (n.includes("head") || n.includes("mixamorighead"))) best = o;
  });
  return best;
}

function rebuild() {
  if (!scene) return;
  if (person) {
    scene.remove(person);
    disposeObject(person);
    person = null;
    head = null;
    jaw = null;
  }
  const p = props.preset;
  person = makePerson(p.avatarId, p.gender, 1.2, p.outfit, p.hairStyle, "stand");
  person.rotation.y = 0.15;
  scene.add(person);
  head = findHead(person);
  const jawGeo = new THREE.BoxGeometry(0.08, 0.03, 0.06);
  const jawMat = new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 0.7 });
  jaw = new THREE.Mesh(jawGeo, jawMat);
  const hy = head ? head.position.y : 0.9;
  jaw.position.set(0, hy - 0.1, 0.08);
  person.add(jaw);
}

function frame(now: number) {
  animId = requestAnimationFrame(frame);
  const dt = lastTs ? Math.min(0.05, (now - lastTs) / 1000) : 0.016;
  lastTs = now;
  t += dt;
  if (person) {
    if (props.phase === "speaking") {
      const talk = Math.sin(t * 12) * 0.1;
      if (head) head.rotation.x = talk;
      if (jaw) jaw.position.y = (head ? head.position.y : 0.9) - 0.1 - Math.abs(Math.sin(t * 14)) * 0.025;
      person.rotation.y = 0.15 + Math.sin(t * 2.2) * 0.04;
    } else if (props.phase === "listening") {
      if (head) head.rotation.x = Math.sin(t * 2.4) * 0.06;
      if (jaw) jaw.position.y = (head ? head.position.y : 0.9) - 0.1;
      person.rotation.y = 0.15;
    } else if (props.phase === "thinking") {
      if (head) head.rotation.x *= 0.92;
      if (jaw) jaw.position.y = (head ? head.position.y : 0.9) - 0.1;
      person.rotation.y = 0.15 + Math.sin(t * 0.7) * 0.08;
    } else if (head) {
      head.rotation.x *= 0.9;
    }
  }
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function onResize() {
  if (!host.value || !renderer || !camera) return;
  const w = host.value.clientWidth || 360;
  const h = host.value.clientHeight || 420;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

onMounted(() => {
  if (!host.value) return;
  const w = host.value.clientWidth || 360;
  const h = host.value.clientHeight || 420;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);
  camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 20);
  camera.position.set(0.2, 1.22, 1.35);
  camera.lookAt(0, 0.98, 0);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  host.value.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0x9ecbff, 0.85);
  key.position.set(1.6, 3.2, 2.4);
  const rim = new THREE.DirectionalLight(0x3b82f6, 0.35);
  rim.position.set(-2, 1.4, -1);
  scene.add(key, rim);
  rebuild();
  lastTs = 0;
  frame(performance.now());
  window.addEventListener("resize", onResize);
});

watch(
  () => [props.preset.id, props.preset.outfit, props.preset.hairStyle] as const,
  () => void rebuild(),
);

onUnmounted(() => {
  cancelAnimationFrame(animId);
  window.removeEventListener("resize", onResize);
  if (person && scene) {
    scene.remove(person);
    disposeObject(person);
  }
  renderer?.dispose();
  renderer?.domElement.parentElement?.removeChild(renderer.domElement);
  renderer = null;
  scene = null;
  camera = null;
});
</script>

<template>
  <div ref="host" class="voice-bust" aria-label="语音助手形象" />
</template>

<style scoped>
.voice-bust {
  width: 100%;
  height: 100%;
  min-height: 280px;
  border-radius: 12px;
  overflow: hidden;
  background: #0b1220;
}
.voice-bust :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
