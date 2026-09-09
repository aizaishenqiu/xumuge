<script setup lang="ts">
import { onApiCatch } from "../utils/userFacingError";
/**
 * Industry kickoff wave swimlane editor (workflow.studio).
 * Saves overrides to {XU_HOME}/workflow-overrides/{id}.json
 */
import { computed, onMounted, ref } from "vue";
import { FouButton, fouMsg } from "foucui";
import {
  getBuiltinIndustryWorkflow,
  persistIndustryWorkflowOverride,
  resolveIndustryWorkflow,
  restoreOfficialIndustryWorkflow,
  type IndustryWorkflowTemplate,
  type KickoffWave,
} from "../office/industryWorkflows";
import type { ProjectType } from "../utils/projects";

const INDUSTRIES: { id: ProjectType; label: string }[] = [
  { id: "software", label: "软件研发" },
  { id: "delivery", label: "交付实施" },
  { id: "consulting", label: "咨询" },
  { id: "internal", label: "内部" },
  { id: "other", label: "其他" },
];

const industryOptions = INDUSTRIES.map((i) => ({ label: i.label, value: i.id }));

const ALL_WAVES: KickoffWave[] = ["planning", "design", "dev", "qa", "security", "ops", "other"];

const industryId = ref<ProjectType>("software");
const draft = ref<IndustryWorkflowTemplate | null>(null);
const busy = ref(false);
const dragRole = ref<string | null>(null);
const newRoleId = ref("");
const previewText = ref("");

const roleCards = computed(() => {
  const t = draft.value;
  if (!t) return [] as { id: string; wave: KickoffWave }[];
  return Object.entries(t.roleIdOverrides).map(([id, wave]) => ({ id, wave }));
});

async function load() {
  busy.value = true;
  try {
    draft.value = await resolveIndustryWorkflow(industryId.value);
    previewText.value = "";
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function onIndustryChange(v: string) {
  industryId.value = (v as ProjectType) || "software";
  void load();
}

function rolesInWave(wave: KickoffWave): string[] {
  return roleCards.value.filter((r) => r.wave === wave).map((r) => r.id);
}

function onDragStart(roleId: string) {
  dragRole.value = roleId;
}

function onDrop(wave: KickoffWave) {
  const rid = dragRole.value;
  dragRole.value = null;
  if (!rid || !draft.value) return;
  draft.value = {
    ...draft.value,
    roleIdOverrides: { ...draft.value.roleIdOverrides, [rid]: wave },
  };
}

function moveWave(idx: number, dir: -1 | 1) {
  if (!draft.value) return;
  const waves = [...draft.value.waves];
  const j = idx + dir;
  if (j < 0 || j >= waves.length) return;
  [waves[idx], waves[j]] = [waves[j], waves[idx]];
  draft.value = { ...draft.value, waves };
}

function addWave(w: KickoffWave) {
  if (!draft.value) return;
  if (draft.value.waves.includes(w)) return;
  draft.value = { ...draft.value, waves: [...draft.value.waves, w] };
}

function removeWave(w: KickoffWave) {
  if (!draft.value || draft.value.waves.length <= 1) return;
  const waves = draft.value.waves.filter((x) => x !== w);
  const fallback = waves[0] || "planning";
  const roleIdOverrides = { ...draft.value.roleIdOverrides };
  for (const [rid, wave] of Object.entries(roleIdOverrides)) {
    if (wave === w) roleIdOverrides[rid] = fallback;
  }
  draft.value = {
    ...draft.value,
    waves,
    roleIdOverrides,
  };
}

function setLabel(w: KickoffWave, label: string) {
  if (!draft.value) return;
  draft.value = {
    ...draft.value,
    waveLabels: { ...draft.value.waveLabels, [w]: label },
  };
}

function addRoleOverride() {
  const id = newRoleId.value.trim();
  if (!id || !draft.value) return;
  const wave = draft.value.waves[0] || "planning";
  draft.value = {
    ...draft.value,
    roleIdOverrides: { ...draft.value.roleIdOverrides, [id]: wave },
  };
  newRoleId.value = "";
}

function removeRole(id: string) {
  if (!draft.value) return;
  const next = { ...draft.value.roleIdOverrides };
  delete next[id];
  draft.value = { ...draft.value, roleIdOverrides: next };
}

async function save() {
  if (!draft.value) return;
  busy.value = true;
  try {
    await persistIndustryWorkflowOverride(draft.value);
    fouMsg.success("已保存本机流程覆盖");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function restoreOfficial() {
  busy.value = true;
  try {
    draft.value = await restoreOfficialIndustryWorkflow(industryId.value);
    fouMsg.success("已恢复官方模板");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function exportJson() {
  if (!draft.value) return;
  const blob = new Blob([JSON.stringify(draft.value, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `workflow-${draft.value.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJson() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file || !draft.value) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as IndustryWorkflowTemplate;
      const builtin = getBuiltinIndustryWorkflow(industryId.value);
      const { mergeWorkflowOverride } = await import("../office/workflowOverrides");
      draft.value = mergeWorkflowOverride(builtin, { ...raw, id: industryId.value });
      fouMsg.success("已导入（尚未保存）");
    } catch (e) {
      void onApiCatch(e);
    }
  };
  input.click();
}

function previewKickoff() {
  if (!draft.value) return;
  const lines = [
    `【预览 · ${draft.value.nameZh}】`,
    `波次：${draft.value.waves.map((w) => draft.value!.waveLabels[w]).join(" → ")}`,
    "",
  ];
  for (const w of draft.value.waves) {
    const roles = rolesInWave(w);
    if (!roles.length) continue;
    lines.push(`${draft.value.waveLabels[w]}：${roles.slice(0, 12).join("、")}${roles.length > 12 ? "…" : ""}`);
  }
  previewText.value = lines.join("\n");
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="wfs ui-font">
    <header class="wfs-toolbar">
      <FouSelect
        :model-value="industryId"
        :options="industryOptions"
        size="small"
        style="width: 140px"
        @update:model-value="onIndustryChange"
      />
      <FouButton icon="save-line" type="primary" size="small" :loading="busy" @click="save">
        保存覆盖
      </FouButton>
      <FouButton icon="history-line" size="small" :loading="busy" @click="restoreOfficial">
        恢复官方
      </FouButton>
      <FouButton icon="download-2-line" size="small" @click="exportJson">导出</FouButton>
      <FouButton icon="upload-2-line" size="small" @click="importJson">导入</FouButton>
      <FouButton icon="eye-line" size="small" @click="previewKickoff">预览分组</FouButton>
    </header>

    <div v-if="draft" class="wfs-lanes" @dragover.prevent>
      <div
        v-for="(wave, idx) in draft.waves"
        :key="wave"
        class="wfs-lane"
        @drop.prevent="onDrop(wave)"
      >
        <div class="wfs-lane-head">
          <FouInput
            :model-value="draft.waveLabels[wave]"
            size="small"
            @update:model-value="(v: string) => setLabel(wave, v)"
          />
          <div class="wfs-lane-acts">
            <FouButton
              icon="arrow-left-s-line"
              size="small"
              text
              native-type="button"
              aria-label="左移波次"
              @click="moveWave(idx, -1)"
            />
            <FouButton
              icon="arrow-right-s-line"
              size="small"
              text
              native-type="button"
              aria-label="右移波次"
              @click="moveWave(idx, 1)"
            />
            <FouButton
              icon="delete-bin-line"
              size="small"
              text
              native-type="button"
              aria-label="删除波次"
              @click="removeWave(wave)"
            />
          </div>
        </div>
        <div class="wfs-cards">
          <div
            v-for="rid in rolesInWave(wave)"
            :key="rid"
            class="wfs-card"
            draggable="true"
            @dragstart="onDragStart(rid)"
          >
            <span class="wfs-card-id">{{ rid }}</span>
            <FouButton
              icon="close-line"
              size="small"
              text
              native-type="button"
              aria-label="移除角色覆盖"
              @click="removeRole(rid)"
            />
          </div>
          <p v-if="!rolesInWave(wave).length" class="wfs-empty">拖入岗位覆盖</p>
        </div>
      </div>
    </div>

    <div class="wfs-add-row">
      <span class="muted">增波次</span>
      <FouButton
        v-for="w in ALL_WAVES.filter((x) => !draft?.waves.includes(x))"
        :key="w"
        icon="add-line"
        size="small"
        @click="addWave(w)"
      >
        {{ w }}
      </FouButton>
      <FouInput
        v-model="newRoleId"
        size="small"
        placeholder="岗位 catalog id"
        style="width: 180px; margin-left: auto"
      />
      <FouButton icon="user-add-line" size="small" @click="addRoleOverride">加角色覆盖</FouButton>
    </div>

    <pre v-if="previewText" class="wfs-preview">{{ previewText }}</pre>
  </div>
</template>

<style scoped>
.wfs {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 12px;
}
.wfs-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.wfs-lanes {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  flex: 1;
  min-height: 220px;
  padding-bottom: 8px;
}
.wfs-lane {
  flex: 0 0 200px;
  background: var(--surface-2, #f5f6f8);
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  min-height: 200px;
}
.wfs-lane-head {
  padding: 8px;
  border-bottom: 1px solid var(--hairline, #e5e7eb);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wfs-lane-acts {
  display: flex;
  gap: 2px;
}
.wfs-cards {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.wfs-card {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: var(--surface, #fff);
  border: 1px solid var(--hairline, #e5e7eb);
  border-radius: 6px;
  cursor: grab;
  font-size: 12px;
}
.wfs-card-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfs-empty {
  margin: 0;
  font-size: 12px;
  color: var(--muted, #999);
}
.wfs-add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.muted {
  font-size: 12px;
  color: var(--muted, #888);
}
.wfs-preview {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  background: var(--surface-2, #f5f6f8);
  border-radius: 6px;
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}
</style>
