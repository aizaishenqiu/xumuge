<script setup lang="ts">
/**
 * @file SketchColorDialog.vue CDR Uniform Fill 风格选色
 * @author qiuye yjk150@qq.com
 * @date 2026-09-06
 * @version 1.0.1
 * @category UI
 * @algo hsv-sv-picker
 */
import { computed, ref, watch } from "vue";
import { FouButton, FouDialog, FouInput } from "foucui";
import {
  cmykToRgb,
  hsvToRgb,
  loadRecentColors,
  parseHex,
  pushRecentColor,
  rgbToCmyk,
  rgbToHex,
  rgbToHsv,
  type Hsv,
} from "../../canvas/sketchColor";

const props = defineProps<{ modelValue: boolean; color: string; title?: string }>();
const emit = defineEmits<{ "update:modelValue": [boolean]; confirm: [string] }>();

const mode = ref<"rgb" | "cmyk" | "hsv">("rgb");
const hsv = ref<Hsv>({ h: 210, s: 50, v: 23 });
const rgbR = ref(30);
const rgbG = ref(41);
const rgbB = ref(59);
const cmykC = ref(0);
const cmykM = ref(0);
const cmykY = ref(0);
const cmykK = ref(0);
const hexDraft = ref("#1e293b");
const recent = ref<string[]>(loadRecentColors());
const svEl = ref<HTMLElement | null>(null);
const hueEl = ref<HTMLElement | null>(null);

const preview = computed(() => rgbToHex(hsvToRgb(hsv.value)));
const hueBg = computed(() => `hsl(${hsv.value.h}, 100%, 50%)`);

function syncFromHex(hex: string) {
  const rgb = parseHex(hex);
  hsv.value = rgbToHsv(rgb);
  rgbR.value = rgb.r;
  rgbG.value = rgb.g;
  rgbB.value = rgb.b;
  const c = rgbToCmyk(rgb);
  cmykC.value = c.c;
  cmykM.value = c.m;
  cmykY.value = c.y;
  cmykK.value = c.k;
  hexDraft.value = rgbToHex(rgb);
}

function applyHsv() {
  const rgb = hsvToRgb(hsv.value);
  rgbR.value = rgb.r;
  rgbG.value = rgb.g;
  rgbB.value = rgb.b;
  const c = rgbToCmyk(rgb);
  cmykC.value = c.c;
  cmykM.value = c.m;
  cmykY.value = c.y;
  cmykK.value = c.k;
  hexDraft.value = rgbToHex(rgb);
}

function applyRgb() {
  const rgb = { r: Number(rgbR.value), g: Number(rgbG.value), b: Number(rgbB.value) };
  hsv.value = rgbToHsv(rgb);
  applyHsv();
}

function applyCmyk() {
  const rgb = cmykToRgb({
    c: Number(cmykC.value),
    m: Number(cmykM.value),
    y: Number(cmykY.value),
    k: Number(cmykK.value),
  });
  hsv.value = rgbToHsv(rgb);
  applyHsv();
}

function applyHexField() {
  syncFromHex(hexDraft.value);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      syncFromHex(props.color);
      recent.value = loadRecentColors();
    }
  },
);

function onSv(e: PointerEvent) {
  const el = svEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const s = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
  const v = Math.max(0, Math.min(100, (1 - (e.clientY - r.top) / r.height) * 100));
  hsv.value = { ...hsv.value, s: Math.round(s), v: Math.round(v) };
  applyHsv();
}

function startSv(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  onSv(e);
}

function onHue(e: PointerEvent) {
  const el = hueEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const h = Math.max(0, Math.min(360, ((e.clientX - r.left) / r.width) * 360));
  hsv.value = { ...hsv.value, h: Math.round(h) };
  applyHsv();
}

function startHue(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  onHue(e);
}

function pickRecent(h: string) {
  syncFromHex(h);
}

function confirm() {
  const hex = preview.value;
  recent.value = pushRecentColor(hex);
  emit("confirm", hex);
  emit("update:modelValue", false);
}

function close() {
  emit("update:modelValue", false);
}
</script>

<template>
  <FouDialog :model-value="modelValue" :title="title || '均匀填充'" width="440px" append-to-body @update:model-value="emit('update:modelValue', $event)">
    <div class="scd ui-font">
      <div
        ref="svEl"
        class="scd-sv"
        :style="{ backgroundColor: hueBg }"
        @pointerdown="startSv"
        @pointermove="(e: PointerEvent) => e.buttons && onSv(e)"
      >
        <div class="scd-sv-white" />
        <div class="scd-sv-black" />
        <div class="scd-sv-cursor" :style="{ left: hsv.s + '%', top: 100 - hsv.v + '%' }" />
      </div>
      <div
        ref="hueEl"
        class="scd-hue"
        @pointerdown="startHue"
        @pointermove="(e: PointerEvent) => e.buttons && onHue(e)"
      >
        <div class="scd-hue-cursor" :style="{ left: (hsv.h / 360) * 100 + '%' }" />
      </div>
      <div class="scd-preview" :style="{ background: preview }" />
      <div class="scd-modes">
        <FouButton icon="palette-line" size="small" :type="mode === 'rgb' ? 'primary' : 'default'" native-type="button" @click="mode = 'rgb'">RGB</FouButton>
        <FouButton icon="drop-line" size="small" :type="mode === 'cmyk' ? 'primary' : 'default'" native-type="button" @click="mode = 'cmyk'">CMYK</FouButton>
        <FouButton icon="contrast-2-line" size="small" :type="mode === 'hsv' ? 'primary' : 'default'" native-type="button" @click="mode = 'hsv'">HSV</FouButton>
      </div>
      <div class="scd-fields">
        <template v-if="mode === 'rgb'">
          <label>R</label><FouInput v-model="rgbR" type="number" @change="applyRgb" />
          <label>G</label><FouInput v-model="rgbG" type="number" @change="applyRgb" />
          <label>B</label><FouInput v-model="rgbB" type="number" @change="applyRgb" />
        </template>
        <template v-else-if="mode === 'cmyk'">
          <label>C</label><FouInput v-model="cmykC" type="number" @change="applyCmyk" />
          <label>M</label><FouInput v-model="cmykM" type="number" @change="applyCmyk" />
          <label>Y</label><FouInput v-model="cmykY" type="number" @change="applyCmyk" />
          <label>K</label><FouInput v-model="cmykK" type="number" @change="applyCmyk" />
        </template>
        <template v-else>
          <label>H</label><FouInput v-model="hsv.h" type="number" @change="applyHsv" />
          <label>S</label><FouInput v-model="hsv.s" type="number" @change="applyHsv" />
          <label>V</label><FouInput v-model="hsv.v" type="number" @change="applyHsv" />
        </template>
        <label>Hex</label><FouInput v-model="hexDraft" @change="applyHexField" />
      </div>
      <div v-if="recent.length" class="scd-recent">
        <span>最近</span>
        <button
          v-for="r in recent"
          :key="r"
          type="button"
          class="scd-chip"
          :style="{ background: r }"
          :aria-label="r"
          @click="pickRecent(r)"
        />
      </div>
    </div>
    <template #footer>
      <FouButton icon="close-line" size="small" native-type="button" @click="close">取消</FouButton>
      <FouButton icon="check-line" type="primary" size="small" native-type="button" @click="confirm">确定</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.scd {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.scd-sv {
  position: relative;
  height: 180px;
  border-radius: 6px;
  cursor: crosshair;
  overflow: hidden;
}
.scd-sv-white,
.scd-sv-black {
  position: absolute;
  inset: 0;
}
.scd-sv-white {
  background: linear-gradient(to right, #fff, transparent);
}
.scd-sv-black {
  background: linear-gradient(to top, #000, transparent);
}
.scd-sv-cursor {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px #000;
  pointer-events: none;
}
.scd-hue {
  position: relative;
  height: 16px;
  border-radius: 4px;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  cursor: ew-resize;
}
.scd-hue-cursor {
  position: absolute;
  top: -2px;
  width: 4px;
  height: 20px;
  margin-left: -2px;
  background: #fff;
  border: 1px solid #333;
  pointer-events: none;
}
.scd-preview {
  height: 28px;
  border-radius: 4px;
  border: 1px solid var(--hairline, #e2e8f0);
}
.scd-modes {
  display: flex;
  gap: 6px;
}
.scd-fields {
  display: grid;
  grid-template-columns: 40px 1fr 40px 1fr;
  gap: 6px;
  align-items: center;
}
.scd-recent {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.scd-chip {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid #94a3b8;
  padding: 0;
  cursor: pointer;
}
</style>
