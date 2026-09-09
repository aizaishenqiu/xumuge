<script setup lang="ts">
/**
 * @file 设计办公室：复接 OfficeScene3D editMode + OfficeBuilderPanel 摆放家具
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category UI
 * @algo none
 */
import { computed, ref, watch } from "vue";
import { FouDialog, fouAlert } from "foucui";
import OfficeBuilderPanel from "./OfficeBuilderPanel.vue";
import OfficeScene3D from "./OfficeScene3D.vue";
import type { OfficeLayout, PropKind } from "../office/catalog";
import { buildDefaultOfficeLayout } from "../office/defaultLayout";
import {
  getOfficeLayoutPreset,
  type OfficeLayoutPresetId,
} from "../office/officePresets";
import { unbindEmployeesFromDesks, type Employee } from "../utils/employees";
import { loadOfficeLayout, saveOfficeLayout } from "../utils/officeLayout";
import { readDeskCount } from "../utils/officeSettings";
import { toUserError } from "../utils/userFacingError";

const open = defineModel<boolean>("open", { default: false });

const props = defineProps<{
  employees: Employee[];
}>();

const layout = ref<OfficeLayout | null>(null);
const baselineJson = ref("");
const placeKind = ref<PropKind | null>(null);
const placeSeatCount = ref<number | null>(null);
const placeColor = ref<string | null>(null);
const selectedPropId = ref<string | null>(null);
const saving = ref(false);
const sceneRef = ref<{
  rotateSelected: (d: number) => void;
  flipSelected: (axis: "x" | "z") => void;
  scaleSelected: (d: number) => void;
} | null>(null);

const deskCount = computed(() => readDeskCount());

const dirty = computed(() => {
  if (!layout.value) return false;
  try {
    return JSON.stringify(layout.value) !== baselineJson.value;
  } catch {
    return true;
  }
});

const selectedProp = computed(() => {
  const id = selectedPropId.value;
  if (!id || !layout.value) return null;
  return layout.value.props.find((p) => p.id === id) ?? null;
});

/** Duty: load editable layout when studio opens. */
async function loadStudio() {
  try {
    const cur = await loadOfficeLayout();
    layout.value = cur;
    baselineJson.value = JSON.stringify(cur);
    placeKind.value = null;
    placeSeatCount.value = null;
    placeColor.value = null;
    selectedPropId.value = null;
  } catch (e) {
    void fouAlert(toUserError(e).slice(0, 240), "加载办公室布局失败");
    open.value = false;
  }
}

watch(
  open,
  (v) => {
    if (v) void loadStudio();
  },
  { immediate: true },
);

function onPlace(kind: PropKind, seats?: number, color?: string | null) {
  placeKind.value = kind;
  placeSeatCount.value = seats ?? null;
  placeColor.value = color ?? null;
  selectedPropId.value = null;
}

/** Duty: persist furniture layout to xu.db. */
async function onSave() {
  if (!layout.value || saving.value) return;
  saving.value = true;
  try {
    await saveOfficeLayout(layout.value);
    baselineJson.value = JSON.stringify(layout.value);
    void fouAlert("家具布局已保存。日常大厅仍用 3D 展示；本布局供搭建场景与快照使用。", "已保存");
  } catch (e) {
    void fouAlert(toUserError(e).slice(0, 240), "保存失败");
  } finally {
    saving.value = false;
  }
}

function onResetThreeBay() {
  const next = buildDefaultOfficeLayout(deskCount.value);
  layout.value = next;
  selectedPropId.value = null;
  placeKind.value = null;
}

function onRestoreDefault() {
  const preset = getOfficeLayoutPreset("open_hall");
  layout.value = preset
    ? preset.build(deskCount.value)
    : buildDefaultOfficeLayout(deskCount.value);
  selectedPropId.value = null;
  placeKind.value = null;
}

function onApplyPreset(id: OfficeLayoutPresetId) {
  const preset = getOfficeLayoutPreset(id);
  if (!preset) return;
  layout.value = preset.build(deskCount.value);
  selectedPropId.value = null;
  placeKind.value = null;
}

function onApplyArea(meta: {
  floorWidth: number;
  floorDepth: number;
  layoutMode?: "surround" | "open_hall" | "blank";
}) {
  if (!layout.value) return;
  layout.value = {
    ...layout.value,
    meta: {
      ...layout.value.meta,
      floorWidth: meta.floorWidth,
      floorDepth: meta.floorDepth,
      ...(meta.layoutMode ? { layoutMode: meta.layoutMode } : {}),
    },
  };
}

function onSize(axis: "sx" | "sy" | "sz", value: number) {
  const id = selectedPropId.value;
  if (!id || !layout.value) return;
  layout.value = {
    ...layout.value,
    props: layout.value.props.map((p) =>
      p.id === id ? { ...p, [axis]: Math.max(0.2, value) } : p,
    ),
  };
}

function onColor(hex: string | null) {
  const id = selectedPropId.value;
  if (!id || !layout.value) return;
  layout.value = {
    ...layout.value,
    props: layout.value.props.map((p) =>
      p.id === id ? { ...p, color: hex ?? undefined } : p,
    ),
  };
}

function onDesksRemoved(seats: number[]) {
  void unbindEmployeesFromDesks(seats);
}

function onEditEmployee(_id: string) {
  /* design studio focuses furniture; employee edit stays on hall */
}

function onDone() {
  open.value = false;
}
</script>

<template>
  <FouDialog
    v-model="open"
    title="设计办公室 · 摆放家具"
    width="92vw"
    top="3vh"
    append-to-body
    destroy-on-close
    class="office-design-studio-dlg"
  >
    <div class="studio">
      <OfficeBuilderPanel
        class="studio-builder"
        :place-kind="placeKind"
        :selected-prop-id="selectedPropId"
        :selected-kind="selectedProp?.kind ?? null"
        :selected-color="selectedProp?.color ?? null"
        :selected-sx="selectedProp?.sx ?? 1"
        :selected-sy="selectedProp?.sy ?? 1"
        :selected-sz="selectedProp?.sz ?? 1"
        :dirty="dirty"
        :saving="saving"
        @place="onPlace"
        @save="onSave"
        @reset="onResetThreeBay"
        @restore-default="onRestoreDefault"
        @apply-preset="onApplyPreset"
        @apply-area="onApplyArea"
        @done="onDone"
        @rotate="(d) => sceneRef?.rotateSelected(d)"
        @flip="(a) => sceneRef?.flipSelected(a)"
        @scale="(d) => sceneRef?.scaleSelected(d)"
        @size="onSize"
        @color="onColor"
      />
      <div class="studio-scene">
        <OfficeScene3D
          v-if="open && layout"
          ref="sceneRef"
          edit-mode
          :desk-count="deskCount"
          :employees="employees"
          :layout="layout"
          :place-kind="placeKind"
          :place-seat-count="placeSeatCount"
          :place-color="placeColor"
          :selected-prop-id="selectedPropId"
          @update:layout="(l) => (layout = l)"
          @update:selected-prop-id="(id) => (selectedPropId = id)"
          @update:place-kind="(k) => (placeKind = k)"
          @desks-removed="onDesksRemoved"
          @edit-employee="onEditEmployee"
        />
      </div>
    </div>
  </FouDialog>
</template>

<style scoped>
.studio {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 10px;
  height: min(78vh, 820px);
  min-height: 420px;
}
.studio-builder {
  min-height: 0;
  overflow: auto;
}
.studio-scene {
  min-width: 0;
  min-height: 0;
  border-radius: 10px;
  overflow: hidden;
  background: #0b1020;
}
@media (max-width: 960px) {
  .studio {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(200px, 40%) 1fr;
  }
}
</style>
