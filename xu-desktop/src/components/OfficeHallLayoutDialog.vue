<script setup lang="ts">
/**
 * @file OfficeHallLayoutDialog.vue 3D 大厅工位数与分区模式设置
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo form-localStorage
 */
import { ref, watch } from "vue";
import { FouButton } from "foucui";
import {
  HALL_ZONE_MODE_LABELS,
  readOfficeHallLayout,
  writeOfficeHallLayout,
  type HallZoneMode,
  type OfficeHallLayoutConfig,
} from "../utils/officeHallLayout";
import {
  OFFICE_DESK_MAX,
  OFFICE_DESK_MIN,
  writeDeskCount,
} from "../utils/officeSettings";

const open = defineModel<boolean>("open", { default: false });

const draft = ref<OfficeHallLayoutConfig>(readOfficeHallLayout());
const modes = Object.entries(HALL_ZONE_MODE_LABELS) as [
  HallZoneMode,
  (typeof HALL_ZONE_MODE_LABELS)[HallZoneMode],
][];

function syncDraft() {
  draft.value = readOfficeHallLayout();
}

watch(open, (v) => {
  if (v) syncDraft();
});

const ZONE_DEFAULTS: Record<HallZoneMode, OfficeHallLayoutConfig["zones"]> = {
  studio_full: { tea: true, lounge: true, meeting: true, front: true },
  meeting_first: { tea: true, lounge: false, meeting: true, front: true },
  open_startup: { tea: false, lounge: false, meeting: true, front: true },
  rd_collab: { tea: true, lounge: false, meeting: false, front: true },
};

function selectMode(mode: HallZoneMode) {
  draft.value.zoneMode = mode;
  draft.value.zones = { ...ZONE_DEFAULTS[mode] };
}

function bumpDesk(delta: number) {
  const next = Math.min(OFFICE_DESK_MAX, Math.max(OFFICE_DESK_MIN, draft.value.deskCount + delta));
  draft.value.deskCount = next;
}

function save() {
  writeDeskCount(draft.value.deskCount);
  writeOfficeHallLayout({
    zoneMode: draft.value.zoneMode,
    deskCount: draft.value.deskCount,
    zones: { ...draft.value.zones },
  });
  open.value = false;
}
</script>

<template>
  <FouDialog v-model="open" title="工位与分区" width="560px" append-to-body destroy-on-close>
    <p class="layout-hint ui-font">切换模式会更新 3D 大厅工位排布与休闲区；工位数与设置页同步。</p>

    <div class="layout-modes">
      <button
        v-for="[id, meta] in modes"
        :key="id"
        type="button"
        class="layout-mode-card ui-font"
        :class="{ active: draft.zoneMode === id }"
        @click="selectMode(id)"
      >
        <i :class="`ri-${meta.icon}`" aria-hidden="true" />
        <strong>{{ meta.name }}</strong>
        <span>{{ meta.description }}</span>
      </button>
    </div>

    <div class="layout-desk-row ui-font">
      <span>工位数</span>
      <FouButton
        icon="subtract-line"
        size="small"
        native-type="button"
        :disabled="draft.deskCount <= OFFICE_DESK_MIN"
        @click="bumpDesk(-1)"
      />
      <span class="layout-desk-num">{{ draft.deskCount }}</span>
      <FouButton
        icon="add-line"
        size="small"
        native-type="button"
        :disabled="draft.deskCount >= OFFICE_DESK_MAX"
        @click="bumpDesk(1)"
      />
    </div>

    <div class="layout-zones ui-font">
      <label><input v-model="draft.zones.tea" type="checkbox" /> 茶水区</label>
      <label><input v-model="draft.zones.lounge" type="checkbox" /> 休息区</label>
      <label><input v-model="draft.zones.meeting" type="checkbox" /> 会议圆桌</label>
      <label><input v-model="draft.zones.front" type="checkbox" /> 前台/屏风</label>
    </div>

    <template #footer>
      <FouButton icon="close-line" native-type="button" @click="open = false">取消</FouButton>
      <FouButton icon="save-line" type="primary" native-type="button" @click="save">保存</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.layout-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted, #64748b);
}
.layout-modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.layout-mode-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--fou-border-color, #e2e8f0);
  background: var(--fou-fill-color-light, #f8fafc);
  cursor: pointer;
  text-align: left;
}
.layout-mode-card.active {
  border-color: var(--primary, #0f766e);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary, #0f766e) 35%, transparent);
}
.layout-mode-card strong {
  font-size: 13px;
}
.layout-mode-card span {
  font-size: 11px;
  opacity: 0.8;
}
.layout-desk-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.layout-desk-num {
  min-width: 28px;
  text-align: center;
  font-weight: 600;
}
.layout-zones {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  font-size: 13px;
}
.layout-zones label {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
