<script setup lang="ts">
/**
 * @file 批量预设项目：按行业与名称列表创建并入队
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Layout
 * @algo batch-project-preset
 */
import { computed, ref, watch } from "vue";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton, FouCheckbox, FouInput, fouAlert, fouMsg } from "foucui";
import { INDUSTRY_NAV } from "../project/industryNav";
import type { IndustryId } from "../project/industryProfiles";
import { industryToProjectType } from "../project/industryWizards";
import { sanitizeDirName, joinFsPath } from "../utils/devWorkspace";
import {
  defaultEmployeeIds,
  defaultProjectToolPolicy,
  upsertProject,
} from "../utils/projects";
import { scaffoldDeliveryWorkspace, scaffoldProjectWorkspace } from "../utils/projectWorkspaceScaffold";
import { buildKickoffSoftwareStack } from "../utils/projectStack";
import { enqueueProjects } from "../utils/projectQueue";
import { onApiCatch } from "../utils/userFacingError";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  "update:visible": [boolean];
  created: [string[]];
}>();

const dialogOpen = computed({
  get: () => props.visible,
  set: (v: boolean) => emit("update:visible", v),
});

const industryId = ref<IndustryId>("consulting");
const parentPath = ref("");
const namesText = ref("");
const addToQueue = ref(true);
const busy = ref(false);

watch(dialogOpen, (open) => {
  if (open) return;
  namesText.value = "";
});

const nameLines = computed(() =>
  namesText.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean),
);

async function pickParent() {
  const picked = await openFileDialog({ directory: true, multiple: false });
  if (typeof picked === "string" && picked) parentPath.value = picked;
}

async function submit() {
  const parent = parentPath.value.trim();
  const lines = nameLines.value;
  if (!parent) {
    void fouAlert("请选择父目录", "批量创建");
    return;
  }
  if (!lines.length) {
    void fouAlert("请至少填写一个项目名称（每行一个）", "批量创建");
    return;
  }
  busy.value = true;
  const createdIds: string[] = [];
  try {
    const type = industryToProjectType(industryId.value);
    const empIds = defaultEmployeeIds();
    for (const rawName of lines) {
      const name = sanitizeDirName(rawName);
      const generatePath = joinFsPath(parent, name);
      const project = await upsertProject({
        name,
        categoryId: type === "software" ? "cat_product" : "cat_delivery",
        industryId: industryId.value,
        type,
        employeeIds: empIds.slice(0, Math.min(6, empIds.length)),
        employeeNotes: {},
        docPath: "",
        generatePath,
        kickoffMode: type === "software" ? "phased" : null,
        toolPolicy: defaultProjectToolPolicy(),
        git: null,
      });
      try {
        if (type === "software") {
          const stackPatch = buildKickoffSoftwareStack(name, ["TypeScript", "Vue"], {
            frontend: true,
            backend: true,
            ui: true,
            desktop: false,
            app: false,
          });
          await scaffoldProjectWorkspace({
            generatePath,
            projectName: name,
            stack: stackPatch.stackProfile,
          });
        } else {
          await scaffoldDeliveryWorkspace({ generatePath, projectName: name });
        }
      } catch {
        /* scaffold best effort */
      }
      createdIds.push(project.id);
    }
    if (addToQueue.value && createdIds.length) {
      await enqueueProjects(createdIds);
    }
    fouMsg.success(`已创建 ${createdIds.length} 个项目${addToQueue.value ? "并加入队列" : ""}`);
    emit("created", createdIds);
    dialogOpen.value = false;
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    title="批量预设项目"
    width="560px"
    append-to-body
    :close-on-click-modal="false"
    :show-fullscreen="false"
    :show-minimize="false"
  >
    <p class="batch-hint ui-font">每行一个项目名称；将创建标准工作区并可选加入严格顺序队列。</p>
    <div class="batch-field">
      <label class="ui-font">行业</label>
      <select v-model="industryId" class="batch-select ui-font" :disabled="busy">
        <option v-for="ind in INDUSTRY_NAV" :key="ind.id" :value="ind.id">
          {{ ind.label }}
        </option>
      </select>
    </div>
    <div class="batch-field">
      <label class="ui-font">父目录</label>
      <div class="batch-path-row">
        <FouInput v-model="parentPath" placeholder="选择保存父目录" :disabled="busy" />
        <FouButton icon="folder-open-line" native-type="button" :disabled="busy" @click="pickParent">
          选择
        </FouButton>
      </div>
    </div>
    <div class="batch-field">
      <label class="ui-font">项目名称（每行一个，共 {{ nameLines.length }} 个）</label>
      <textarea
        v-model="namesText"
        class="batch-textarea ui-font"
        rows="8"
        placeholder="客户 A 方案&#10;客户 B 实施&#10;内部运营周报"
        :disabled="busy"
      />
    </div>
    <FouCheckbox v-model="addToQueue" :disabled="busy">创建后加入项目队列</FouCheckbox>
    <template #footer>
      <FouButton icon="close-line" native-type="button" :disabled="busy" @click="dialogOpen = false">
        取消
      </FouButton>
      <FouButton
        icon="add-line"
        type="primary"
        native-type="button"
        :loading="busy"
        @click="submit"
      >
        创建
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.batch-hint {
  margin: 0 0 12px;
  font-size: 13px;
  opacity: 0.85;
}
.batch-field {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.batch-select {
  padding: 6px 8px;
  border-radius: 6px;
}
.batch-path-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.batch-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border-radius: 6px;
  resize: vertical;
}
</style>
