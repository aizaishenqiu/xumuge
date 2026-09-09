<script setup lang="ts">
import { computed, ref } from "vue";
import { FouButton } from "foucui";
import {
  CATALOG_CATEGORIES,
  familiesForCategory,
  isWallCutKind,
  PROP_COLOR_PRESETS,
  type CatalogCategoryId,
  type CatalogFamily,
  type CatalogVariant,
  type PropKind,
} from "../office/catalog";
import { catalogPreviewDataUrl } from "../office/catalogPreview";
import { OFFICE_LAYOUT_PRESETS, type OfficeLayoutPresetId } from "../office/officePresets";
import { readDeskCount } from "../utils/officeSettings";

const props = defineProps<{
  placeKind: PropKind | null;
  selectedPropId: string | null;
  selectedKind?: PropKind | string | null;
  selectedColor?: string | null;
  selectedSx?: number;
  selectedSy?: number;
  selectedSz?: number;
  dirty: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  place: [kind: PropKind, seatCount?: number, color?: string | null];
  save: [];
  reset: [];
  restoreDefault: [];
  applyPreset: [id: OfficeLayoutPresetId];
  applyArea: [meta: { floorWidth: number; floorDepth: number; layoutMode?: "surround" | "open_hall" | "blank" }];
  done: [];
  rotate: [delta: number];
  flip: [axis: "x" | "z"];
  scale: [delta: number];
  size: [axis: "sx" | "sy" | "sz", value: number];
  color: [hex: string | null];
}>();

const selectedIsCut = computed(() => isWallCutKind(props.selectedKind ?? ""));
const placeIsCut = computed(() => isWallCutKind(props.placeKind ?? ""));

const activeCategory = ref<CatalogCategoryId>("workstations");
const activeFamily = ref<CatalogFamily | null>(null);
const seatOpen = ref(false);
const presetOpen = ref(false);
const seatDraft = ref("2");
const pendingVariant = ref<CatalogVariant | null>(null);
const floorWidth = ref(24);
const floorDepth = ref(18);

const families = computed(() => familiesForCategory(activeCategory.value));

const statusText = computed(() => {
  if (props.placeKind) {
    if (placeIsCut.value) {
      return `切墙「${props.placeKind}」· 点墙面放置 · 再用宽/高调洞口`;
    }
    return `放置「${props.placeKind}」· 地面单击确认`;
  }
  if (activeFamily.value) {
    return `已选「${activeFamily.value.name}」· 右侧选造型与配色`;
  }
  if (props.selectedPropId) {
    if (selectedIsCut.value) {
      return "已选切墙件 · 宽=洞宽 · 高=洞高 · 贴墙拖动改位置";
    }
    return "已选中 · 方向键微调 · 可旋转/拉伸宽高深";
  }
  return "左栏选分类与族 · 右侧选造型 · 可用「布局模板」";
});

function selectFamily(f: CatalogFamily) {
  activeFamily.value = f;
  if (f.variants.length === 1 && f.variants[0].seatMode === "fixed") {
    emit("place", f.variants[0].kind, undefined, f.variants[0].color ?? null);
  }
}

function pickVariant(v: CatalogVariant) {
  if (v.seatMode === "ask") {
    pendingVariant.value = v;
    seatDraft.value = String(Math.max(1, v.defaultSeats || 1));
    seatOpen.value = true;
    return;
  }
  emit("place", v.kind, undefined, v.color ?? null);
}

function confirmSeats() {
  const v = pendingVariant.value;
  if (!v) return;
  const n = Math.max(1, Math.min(12, Math.round(Number(seatDraft.value) || 1)));
  seatOpen.value = false;
  emit("place", v.kind, n, v.color ?? null);
  pendingVariant.value = null;
}

function bumpSize(axis: "sx" | "sy" | "sz", delta: number) {
  const cur =
    axis === "sx" ? (props.selectedSx ?? 1) : axis === "sy" ? (props.selectedSy ?? 1) : (props.selectedSz ?? 1);
  emit("size", axis, Math.round((cur + delta) * 20) / 20);
}

function applyPreset(id: OfficeLayoutPresetId) {
  presetOpen.value = false;
  emit("applyPreset", id);
}

function applyArea(mode?: "surround" | "open_hall" | "blank") {
  emit("applyArea", {
    floorWidth: Math.max(16, Math.min(48, Number(floorWidth.value) || 24)),
    floorDepth: Math.max(12, Math.min(36, Number(floorDepth.value) || 18)),
    layoutMode: mode,
  });
}
</script>

<template>
  <aside class="builder-panel" aria-label="办公室搭建">
    <header class="builder-header">
      <div class="builder-title ui-font">搭建办公室</div>
      <p class="builder-status ui-font">{{ statusText }}</p>
      <div class="builder-actions">
        <FouButton icon="save-line" size="small" native-type="button" :disabled="saving || !dirty" @click="emit('save')">
          {{ saving ? "保存中…" : "保存" }}
        </FouButton>
        <FouButton icon="layout-masonry-line" size="small" native-type="button" @click="presetOpen = true">
          布局模板
        </FouButton>
        <FouButton icon="history-line" size="small" native-type="button" @click="emit('restoreDefault')">
          恢复默认
        </FouButton>
        <FouButton icon="refresh-line" size="small" native-type="button" @click="emit('reset')">
          三开间默认
        </FouButton>
        <FouButton type="primary" icon="check-line" size="small" native-type="button" @click="emit('done')">
          完成
        </FouButton>
      </div>
      <div class="area-row ui-font">
        <label>
          宽
          <input v-model.number="floorWidth" type="range" min="16" max="48" step="1" />
          {{ floorWidth }}
        </label>
        <label>
          深
          <input v-model.number="floorDepth" type="range" min="12" max="36" step="1" />
          {{ floorDepth }}
        </label>
        <FouButton icon="aspect-ratio-line" size="small" native-type="button" @click="applyArea()">
          应用面积
        </FouButton>
        <FouButton icon="layout-masonry-line" size="small" native-type="button" @click="applyArea('open_hall')">
          大开间
        </FouButton>
        <FouButton icon="community-line" size="small" native-type="button" @click="applyArea('surround')">
          环绕总部
        </FouButton>
        <FouButton icon="building-4-line" size="small" native-type="button" @click="applyPreset('hq_plan10')">
          经典环绕
        </FouButton>
        <FouButton icon="draft-line" size="small" native-type="button" @click="applyPreset('blank')">
          空白自绘
        </FouButton>
      </div>
    </header>

    <div v-if="selectedPropId" class="builder-transform">
      <span class="builder-transform-label ui-font">变换</span>
      <FouButton icon="arrow-go-back-line" size="small" native-type="button" @click="emit('rotate', -Math.PI / 4)">旋转</FouButton>
      <FouButton icon="arrow-go-forward-line" size="small" native-type="button" @click="emit('rotate', Math.PI / 4)">旋转</FouButton>
      <FouButton icon="swap-box-line" size="small" native-type="button" @click="emit('flip', 'x')">翻转X</FouButton>
      <FouButton icon="exchange-line" size="small" native-type="button" @click="emit('flip', 'z')">翻转Z</FouButton>
      <FouButton icon="subtract-line" size="small" native-type="button" @click="emit('scale', -0.1)">缩小</FouButton>
      <FouButton icon="add-line" size="small" native-type="button" @click="emit('scale', 0.1)">放大</FouButton>
      <div class="size-row ui-font">
        <span>{{ selectedIsCut ? "洞宽" : "宽" }} {{ (selectedSx ?? 1).toFixed(1) }}</span>
        <FouButton icon="subtract-line" size="small" native-type="button" @click="bumpSize('sx', -0.1)">−</FouButton>
        <FouButton icon="add-line" size="small" native-type="button" @click="bumpSize('sx', 0.1)">+</FouButton>
        <span>{{ selectedIsCut ? "洞高" : "高" }} {{ (selectedSy ?? 1).toFixed(1) }}</span>
        <FouButton icon="subtract-line" size="small" native-type="button" @click="bumpSize('sy', -0.1)">−</FouButton>
        <FouButton icon="add-line" size="small" native-type="button" @click="bumpSize('sy', 0.1)">+</FouButton>
        <span v-if="!selectedIsCut">深 {{ (selectedSz ?? 1).toFixed(1) }}</span>
        <FouButton
          v-if="!selectedIsCut"
          icon="subtract-line"
          size="small"
          native-type="button"
          @click="bumpSize('sz', -0.1)"
        >−</FouButton>
        <FouButton
          v-if="!selectedIsCut"
          icon="add-line"
          size="small"
          native-type="button"
          @click="bumpSize('sz', 0.1)"
        >+</FouButton>
      </div>
      <p v-if="selectedIsCut" class="cut-hint ui-font">洞口会真实切开墙体；可换「自定义切墙」做无门框开口。</p>
      <div class="color-row">
        <FouButton
          v-for="c in PROP_COLOR_PRESETS"
          :key="c"
          class="color-swatch"
          :class="{ active: selectedColor === c }"
          icon="palette-line"
          text
          native-type="button"
          :style="{ background: c }"
          :title="c"
          :aria-label="`换色 ${c}`"
          @click="emit('color', c)"
        />
        <FouButton icon="close-circle-line" native-type="button" size="small" @click="emit('color', null)">
          原色
        </FouButton>
      </div>
    </div>

    <div class="builder-catalog">
      <nav class="builder-cats" aria-label="元素分类">
        <FouButton
          v-for="cat in CATALOG_CATEGORIES"
          :key="cat.id"
          class="cat-btn"
          :class="{ active: activeCategory === cat.id }"
          :icon="cat.icon"
          size="small"
          native-type="button"
          @click="
            activeCategory = cat.id;
            activeFamily = null;
          "
        >
          {{ cat.name }}
        </FouButton>
      </nav>
      <div class="builder-split">
        <div class="builder-families" role="list">
          <FouButton
            v-for="f in families"
            :key="f.id"
            class="family-item"
            :class="{ active: activeFamily?.id === f.id }"
            :icon="f.icon"
            size="small"
            native-type="button"
            @click="selectFamily(f)"
          >
            {{ f.name }}
          </FouButton>
        </div>
        <div class="builder-variants" aria-label="造型">
          <p v-if="!activeFamily" class="hint ui-font">点左侧族，右侧出现大图造型与配色</p>
          <FouButton
            v-for="(v, i) in activeFamily?.variants ?? []"
            :key="`${v.kind}-${v.name}-${i}`"
            class="variant-card"
            icon="image-line"
            text
            native-type="button"
            @click="pickVariant(v)"
          >
            <img
              :src="catalogPreviewDataUrl(v.kind, v.name, v.styleId || 'default')"
              :alt="v.name"
            />
            <span class="ui-font">{{ v.name }}</span>
            <small v-if="v.seatMode === 'ask'" class="ui-font">可设工位数</small>
          </FouButton>
        </div>
      </div>
    </div>

    <FouDialog
      v-model="seatOpen"
      title="多少工位？"
      width="400px"
      append-to-body
      :show-fullscreen="false"
      :show-minimize="false"
      :draggable="false"
      :resizable="false"
      :z-index="21000"
    >
      <p class="hint ui-font">输入座位数后，点击地面会一次放下对应数量的工位（1–12）。</p>
      <label class="field ui-font">
        <span>工位数</span>
        <FouInput v-model="seatDraft" type="number" min="1" max="12" />
      </label>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="seatOpen = false">取消</FouButton>
        <FouButton type="primary" icon="check-line" native-type="button" @click="confirmSeats">生成并放置</FouButton>
      </template>
    </FouDialog>

    <FouDialog
      v-model="presetOpen"
      title="选择布局模板"
      width="560px"
      append-to-body
      :show-fullscreen="false"
      :show-minimize="false"
      :draggable="false"
      :resizable="false"
      :z-index="21000"
    >
      <p class="hint ui-font">点选一套后自动生成整间办公室（约 {{ readDeskCount() }} 工位容量）。部门用区标，不会再套房间墙盒。</p>
      <div class="preset-grid">
        <FouButton
          v-for="p in OFFICE_LAYOUT_PRESETS"
          :key="p.id"
          class="preset-card"
          :icon="p.icon"
          native-type="button"
          @click="applyPreset(p.id)"
        >
          <span class="preset-text">
            <strong class="ui-font">{{ p.name }}</strong>
            <span class="ui-font">{{ p.description }}</span>
          </span>
        </FouButton>
      </div>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="presetOpen = false">取消</FouButton>
      </template>
    </FouDialog>
  </aside>
</template>

<style scoped>
.builder-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 380px;
  min-width: 320px;
  max-height: 100%;
  overflow: auto;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--surface-card) 92%, transparent);
}
.builder-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.builder-title {
  font-weight: 650;
  font-size: 15px;
}
.builder-status {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.builder-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.area-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--muted);
}
.area-row label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.area-row input[type="range"] {
  width: 72px;
}
.builder-transform {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
}
.builder-transform-label {
  font-size: 12px;
  color: var(--muted);
  width: 100%;
}
.size-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  font-size: 12px;
  width: 100%;
}
.cut-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--muted);
  width: 100%;
}
.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  width: 100%;
}
.color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  cursor: pointer;
}
.color-swatch.active {
  outline: 2px solid var(--primary, #2a6b5a);
}
.builder-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.cat-btn.active {
  outline: 2px solid color-mix(in srgb, var(--primary, #2a6b5a) 50%, transparent);
}
.builder-split {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px;
  min-height: 280px;
}
.builder-families {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
  max-height: 420px;
}
.family-item.active {
  outline: 2px solid color-mix(in srgb, var(--primary, #2a6b5a) 55%, transparent);
}
.builder-variants {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  max-height: 420px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--canvas, #f8fafc) 88%, transparent);
}
.variant-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  background: #fff;
  cursor: pointer;
  text-align: left;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
.variant-card:hover {
  border-color: var(--primary, #2a6b5a);
}
.variant-card img {
  width: 100%;
  height: 118px;
  object-fit: cover;
  border-radius: 8px;
  background: #eef2f7;
  image-rendering: auto;
}
.variant-card span {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
}
.variant-card small {
  font-size: 11px;
  color: var(--muted);
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.preset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}
.preset-card {
  display: flex !important;
  height: auto !important;
  min-height: 72px;
  align-items: flex-start !important;
  justify-content: flex-start !important;
  text-align: left;
  padding: 12px !important;
  white-space: normal !important;
}
.preset-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.preset-text strong {
  font-size: 14px;
  color: var(--ink, #0f172a);
}
.preset-text span {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
  font-weight: 400;
}
</style>
