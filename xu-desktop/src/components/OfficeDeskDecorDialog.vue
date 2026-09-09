<script setup lang="ts">
/**
 * @file OfficeDeskDecorDialog.vue 工位皮肤与小摆件装扮
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo form-localStorage
 */
import { computed, ref, watch } from "vue";
import { FouButton } from "foucui";
import {
  DESK_PROP_OPTIONS,
  DESK_SKIN_OPTIONS,
  readDeskDecor,
  writeDeskDecor,
  type DeskDecor,
  type DeskPropId,
  type DeskSkinId,
} from "../utils/officeDeskDecor";
import type { Employee } from "../utils/employees";

const open = defineModel<boolean>("open", { default: false });

const props = defineProps<{
  deskIndex: number;
  employees: Employee[];
}>();

const draft = ref<DeskDecor>(readDeskDecor(0));
const deskPicker = ref(0);

const deskLabel = computed(() => {
  const emp = props.employees.find((e) => e.deskIndex === deskPicker.value);
  return emp ? `${emp.name}（工位 ${deskPicker.value + 1}）` : `工位 ${deskPicker.value + 1}`;
});

function syncDraft(idx: number) {
  deskPicker.value = idx;
  draft.value = readDeskDecor(idx);
}

watch(open, (v) => {
  if (v) syncDraft(props.deskIndex >= 0 ? props.deskIndex : 0);
});

watch(
  () => props.deskIndex,
  (idx) => {
    if (open.value && idx >= 0) syncDraft(idx);
  },
);

function selectSkin(id: DeskSkinId) {
  draft.value.skinId = id;
}

function toggleProp(id: DeskPropId) {
  const set = new Set(draft.value.props);
  if (set.has(id)) set.delete(id);
  else if (set.size < 2) set.add(id);
  draft.value.props = [...set];
}

function save() {
  writeDeskDecor(deskPicker.value, draft.value);
  open.value = false;
}

/** 将当前装扮应用到所有已落座员工工位 */
function applyToAllSeated() {
  const indices = [
    ...new Set(
      props.employees
        .map((e) => e.deskIndex)
        .filter((n): n is number => n != null && n >= 0),
    ),
  ];
  indices.forEach((i) => writeDeskDecor(i, draft.value));
  open.value = false;
}
</script>

<template>
  <FouDialog v-model="open" title="工位装扮" width="480px" append-to-body destroy-on-close>
    <p class="decor-hint ui-font">点击空桌可打开此面板；摆件最多 2 个。</p>

    <div class="decor-desk-pick ui-font">
      <span>工位</span>
      <FouButton
        icon="arrow-left-s-line"
        size="small"
        native-type="button"
        :disabled="deskPicker <= 0"
        @click="syncDraft(deskPicker - 1)"
      />
      <span class="decor-desk-label">{{ deskLabel }}</span>
      <FouButton
        icon="arrow-right-s-line"
        size="small"
        native-type="button"
        :disabled="deskPicker >= 15"
        @click="syncDraft(deskPicker + 1)"
      />
    </div>

    <div class="decor-section ui-font">
      <h4>桌面皮肤</h4>
      <div class="decor-skins">
        <button
          v-for="s in DESK_SKIN_OPTIONS"
          :key="s.id"
          type="button"
          class="decor-skin-btn"
          :class="{ active: draft.skinId === s.id }"
          :style="{ '--swatch': `#${s.desk.toString(16).padStart(6, '0')}` }"
          @click="selectSkin(s.id)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <div class="decor-section ui-font">
      <h4>小摆件（≤2）</h4>
      <div class="decor-props">
        <FouButton
          v-for="p in DESK_PROP_OPTIONS"
          :key="p.id"
          size="small"
          :type="draft.props.includes(p.id) ? 'primary' : 'default'"
          native-type="button"
          @click="toggleProp(p.id)"
        >
          {{ p.label }}
        </FouButton>
      </div>
    </div>

    <template #footer>
      <FouButton icon="group-line" native-type="button" @click="applyToAllSeated">
        应用到全员工位
      </FouButton>
      <FouButton icon="close-line" native-type="button" @click="open = false">取消</FouButton>
      <FouButton icon="save-line" type="primary" native-type="button" @click="save">保存</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.decor-hint {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--muted, #64748b);
}
.decor-desk-pick {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.decor-desk-label {
  flex: 1;
  text-align: center;
  font-weight: 600;
}
.decor-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.decor-skins {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}
.decor-skin-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--fou-border-color, #e2e8f0);
  cursor: pointer;
  font-size: 12px;
}
.decor-skin-btn::before {
  content: "";
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--swatch);
}
.decor-skin-btn.active {
  border-color: var(--primary, #0f766e);
}
.decor-props {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
