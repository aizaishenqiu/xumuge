<script setup lang="ts">
import { onApiCatch } from "../utils/userFacingError";
/**
 * Brief ready → confirm project name + generate path + role picks + models → save / hire / kickoff.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton, fouMsg, fouAlert} from "foucui";
import { clearStuckUiBlockers } from "../utils/clearStuckUiBlockers";
import type { RequirementBrief, RoleMatchItem } from "../intent/briefTypes";
import {
  projectStartFromBrief,
  suggestProjectNameFromBrief,
  type ProjectStartMode,
} from "../intent/projectStartFromBrief";
import { isSoftwareBriefWorkMode } from "../intent/workModeClassifier";
import {
  defaultKickoffModelKey,
  loadKickoffModelOptions,
  type KickoffModelOptions,
} from "../intent/kickoffModelPick";
import { loadOpsBrains } from "../utils/opsBrains";
import { TECH_STACK_OPTIONS } from "../utils/projectStack";
import {
  STACK_ENDS,
  buildKickoffSoftwareStack,
  type StackEndKey,
} from "../utils/projectStack";
import { sanitizeDirName, joinFsPath } from "../utils/devWorkspace";
import { workspaceDirsForStack } from "../utils/projectWorkspaceScaffold";
import {
  toolPolicyFromPreset,
  TOOL_POLICY_PRESET_LABELS,
  type ToolPolicyPreset,
} from "../utils/projectToolPolicy";
import MultiSelectDropdown from "./MultiSelectDropdown.vue";
import {
  KICKOFF_MODE_LABEL,
  type XuProject,
  type ProjectKickoffMode,
  type ProjectToolchain,
} from "../utils/projects";
import { INDUSTRY_NAV } from "../project/industryNav";
import type { IndustryId } from "../project/industryProfiles";
import {
  emptyIdeProbe,
  firstInstalledIde,
  idePickerOptions,
  isIdeCliInstalled,
  probeInstalledIdes,
  type IdeProbeResult,
} from "../utils/ideProbe";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    brief: RequirementBrief | null;
    project?: XuProject | null;
    suggestedPath?: string;
  }>(),
  {
    project: null,
    suggestedPath: "",
  },
);

const emit = defineEmits<{
  "update:visible": [boolean];
  done: [
    result: {
      mode: ProjectStartMode | "later";
      project?: XuProject;
      kickedOff?: boolean;
      hiredCount?: number;
      dispatched?: number;
      roleSummary?: string;
      awaitingDesignConfirm?: boolean;
    },
  ];
}>();

const dialogOpen = computed({
  get: () => props.visible,
  set: (v: boolean) => emit("update:visible", v),
});

watch(dialogOpen, (open) => {
  if (!open) nextTick(() => clearStuckUiBlockers());
});

const projectName = ref("");
const generatePath = ref("");
const busy = ref(false);
const selectedRoleIds = ref<string[]>([]);
const commandModelKey = ref("");
const codeModelKey = ref("");
const techStackSelected = ref<string[]>(["TypeScript", "Vue"]);
const gitRemoteUrl = ref("");
const gitDefaultBranch = ref("main");
const kickoffMode = ref<ProjectKickoffMode>("phased");
const codeEditorSurface = ref<"builtin" | "external">("builtin");
const toolchainIde = ref<ProjectToolchain["ide"]>("cursor");
const ideProbe = ref<IdeProbeResult>(emptyIdeProbe());
const modelOpts = ref<KickoffModelOptions>({
  localModels: [],
  localBase: "",
  remotePresets: [],
});
const wizardStep = ref(1);
const parentPath = ref("");
const permissionPreset = ref<ToolPolicyPreset>("full");
const stackEndsEnabled = ref<Record<StackEndKey, boolean>>({
  frontend: true,
  backend: true,
  ui: false,
  desktop: false,
  app: false,
});
const nonSoftwareIndustryId = ref<IndustryId>("consulting");

const nonSoftwareIndustries = computed(() =>
  INDUSTRY_NAV.filter((i) => i.id !== "software"),
);

const maxWizardStep = computed(() => (isSoftware.value ? 4 : 3));

const wizardStepTitle = computed(() => {
  if (!isSoftware.value) {
    return wizardStep.value === 1
      ? "保存位置"
      : wizardStep.value === 2
        ? "行业与权限"
        : "确认开工";
  }
  return ["保存位置", "权限", "端与目录", "确认开工"][wizardStep.value - 1] || "";
});

const previewGeneratePath = computed(() => {
  const parent = parentPath.value.trim();
  const name = sanitizeDirName(projectName.value.trim());
  if (!parent || !name) return "";
  return joinFsPath(parent, name);
});

const stackPreviewProfile = computed(() => {
  if (!isSoftware.value || !techStackSelected.value.length) return null;
  const patch = buildKickoffSoftwareStack(
    projectName.value.trim() || "app",
    techStackSelected.value,
    stackEndsEnabled.value,
  );
  return patch.stackProfile;
});

const directoryTreePreview = computed(() => {
  const root = previewGeneratePath.value || generatePath.value.trim() || "{项目路径}";
  const stack = stackPreviewProfile.value;
  const lines = [`${root}/`, "  README.md", "  docs/", "    REQUIREMENTS.md", "  UI/", "  code/", "  .xu/"];
  if (stack) {
    for (const rel of workspaceDirsForStack(stack)) {
      if (!["docs", "UI", "code", ".xu"].includes(rel)) {
        lines.push(`  ${rel}/`);
      }
    }
  }
  return lines.join("\n");
});

const canWizardNext = computed(() => {
  if (wizardStep.value === 1) {
    return Boolean(parentPath.value.trim() && projectName.value.trim());
  }
  if (wizardStep.value === 2) return true;
  if (wizardStep.value === 3 && isSoftware.value) {
    return Object.values(stackEndsEnabled.value).some(Boolean);
  }
  return canSubmit.value;
});

const isSoftware = computed(() =>
  isSoftwareBriefWorkMode(props.brief, props.project),
);

const matchRows = computed((): RoleMatchItem[] => {
  const b = props.brief;
  if (!b) return [];
  if (b.matchPlan?.length) return b.matchPlan;
  return (b.matchedRoleIds || []).map((id) => ({
    roleId: id,
    roleNameZh: id,
    task: "",
    acceptance: [],
  }));
});

async function refreshModelDefaults() {
  try {
    const opts = await loadKickoffModelOptions();
    modelOpts.value = opts;
    const brains = await loadOpsBrains();
    if (!commandModelKey.value) {
      commandModelKey.value = defaultKickoffModelKey(brains.command, opts);
    }
    if (!codeModelKey.value) {
      codeModelKey.value =
        defaultKickoffModelKey(brains.code, opts) ||
        defaultKickoffModelKey(brains.work, opts) ||
        commandModelKey.value;
    }
  } catch {
    /* ignore */
  }
}

watch(
  () => [props.visible, props.brief, props.project, props.suggestedPath] as const,
  ([vis]) => {
    if (!vis) return;
    wizardStep.value = 1;
    projectName.value =
      props.project?.name?.trim() ||
      suggestProjectNameFromBrief(props.brief) ||
      "未命名项目";
    const existingPath =
      (props.project?.generatePath || "").trim() ||
      (props.suggestedPath || "").trim() ||
      "";
    generatePath.value = existingPath;
    if (existingPath) {
      const sep = Math.max(existingPath.lastIndexOf("/"), existingPath.lastIndexOf("\\"));
      if (sep > 0) {
        parentPath.value = existingPath.slice(0, sep);
        if (!props.project?.name?.trim()) {
          projectName.value = existingPath.slice(sep + 1);
        }
      } else {
        parentPath.value = existingPath;
      }
    } else {
      parentPath.value = "";
    }
    permissionPreset.value = "full";
    stackEndsEnabled.value = {
      frontend: true,
      backend: true,
      ui: false,
      desktop: false,
      app: false,
    };
    selectedRoleIds.value = matchRows.value.map((m) => m.roleId).filter(Boolean);
    const existingLangs = props.project?.toolchain?.languages?.filter(Boolean);
    techStackSelected.value =
      existingLangs?.length ? [...existingLangs] : ["TypeScript", "Vue"];
    gitRemoteUrl.value = (props.project?.git?.remoteUrl || "").trim();
    gitDefaultBranch.value = (props.project?.git?.defaultBranch || "main").trim() || "main";
    kickoffMode.value = props.project?.kickoffMode || "phased";
    const surf = props.project?.toolchain?.codeEditorSurface;
    codeEditorSurface.value = surf === "external" ? "external" : "builtin";
    toolchainIde.value = props.project?.toolchain?.ide || "cursor";
    void probeInstalledIdes().then((p) => {
      ideProbe.value = p;
      if (codeEditorSurface.value === "external" && !isIdeCliInstalled(toolchainIde.value, p)) {
        const hit = firstInstalledIde(p);
        if (hit) toolchainIde.value = hit;
      }
    });
    void refreshModelDefaults();
  },
  { immediate: true },
);

onMounted(() => {
  void refreshModelDefaults();
});

const ideSelectOptions = computed(() => idePickerOptions(ideProbe.value));

const canSubmit = computed(() => {
  const path = (previewGeneratePath.value || generatePath.value).trim();
  if (!projectName.value.trim() || !path || busy.value) return false;
  if (isSoftware.value && !techStackSelected.value.length) return false;
  if (isSoftware.value && !codeEditorSurface.value) return false;
  if (
    isSoftware.value &&
    codeEditorSurface.value === "external" &&
    !isIdeCliInstalled(toolchainIde.value, ideProbe.value)
  ) {
    return false;
  }
  return true;
});

const canKickoff = computed(
  () =>
    canSubmit.value &&
    Boolean(commandModelKey.value.trim() || codeModelKey.value.trim()),
);

function toggleRole(roleId: string, on: boolean) {
  const set = new Set(selectedRoleIds.value);
  if (on) set.add(roleId);
  else set.delete(roleId);
  selectedRoleIds.value = [...set];
}

function isRoleOn(roleId: string) {
  return selectedRoleIds.value.includes(roleId);
}

async function pickParentPath() {
  try {
    const selected = await openFileDialog({
      directory: true,
      multiple: false,
      title: "选择项目父目录",
      defaultPath: parentPath.value.trim() || undefined,
    });
    if (typeof selected === "string" && selected.trim()) {
      parentPath.value = selected.trim();
      if (previewGeneratePath.value) generatePath.value = previewGeneratePath.value;
    }
  } catch (e) {
    void onApiCatch(e, undefined, { fallback: "选择目录失败" });
  }
}

function toggleStackEnd(key: StackEndKey, on: boolean) {
  stackEndsEnabled.value = { ...stackEndsEnabled.value, [key]: on };
}

function isStackEndOn(key: StackEndKey) {
  return Boolean(stackEndsEnabled.value[key]);
}

function wizardPrev() {
  if (wizardStep.value > 1) wizardStep.value -= 1;
}

function wizardNext() {
  if (wizardStep.value === 1 && previewGeneratePath.value) {
    generatePath.value = previewGeneratePath.value;
  }
  if (wizardStep.value < maxWizardStep.value && canWizardNext.value) {
    wizardStep.value += 1;
  }
}

async function pickGeneratePath() {
  try {
    const selected = await openFileDialog({
      directory: true,
      multiple: false,
      title: "选择项目生成路径",
      defaultPath: generatePath.value.trim() || undefined,
    });
    if (typeof selected === "string" && selected.trim()) {
      generatePath.value = selected.trim();
    }
  } catch (e) {
    void onApiCatch(e, undefined, { fallback: "选择目录失败" });
  }
}

async function runStart(mode: ProjectStartMode) {
  if (!props.brief) {
    void fouAlert("没有可用的需求 Brief", "提示");
    return;
  }
  if (!canSubmit.value) {
    void fouAlert("请填写项目名称并选择生成路径", "提示");
    return;
  }
  if (matchRows.value.length && !selectedRoleIds.value.length) {
    void fouAlert("请至少勾选一个岗位", "提示");
    return;
  }
  if (isSoftware.value && !techStackSelected.value.length) {
    void fouAlert("请至少选择一种语言或框架", "提示");
    return;
  }
  if (isSoftware.value && !codeEditorSurface.value) {
    void fouAlert("请选择写码表面（内置或本机 IDE）", "提示");
    return;
  }
  if (
    isSoftware.value &&
    codeEditorSurface.value === "external" &&
    !isIdeCliInstalled(toolchainIde.value, ideProbe.value)
  ) {
    void fouAlert("本机 IDE 未检测到 CLI，请改选内置虚募阁 IDE 或安装对应编辑器", "提示");
    return;
  }
  if (mode === "save_and_kickoff" && !canKickoff.value) {
    void fouAlert("请选择智脑模型与写码模型", "提示");
    return;
  }
  busy.value = true;
  try {
    const result = await projectStartFromBrief({
      brief: props.brief,
      project: props.project,
      name: projectName.value.trim(),
      generatePath: (previewGeneratePath.value || generatePath.value).trim(),
      mode,
      roleIds: selectedRoleIds.value.length ? selectedRoleIds.value : undefined,
      commandModelKey: commandModelKey.value,
      codeModelKey: codeModelKey.value,
      techStack: isSoftware.value ? [...techStackSelected.value] : undefined,
      gitRemoteUrl: gitRemoteUrl.value.trim() || undefined,
      gitDefaultBranch: gitDefaultBranch.value.trim() || "main",
      kickoffMode: isSoftware.value ? kickoffMode.value : undefined,
      codeEditorSurface: isSoftware.value ? codeEditorSurface.value : undefined,
      toolchainIde: isSoftware.value ? toolchainIde.value : undefined,
      toolPolicy: toolPolicyFromPreset(permissionPreset.value),
      stackEndOverrides: isSoftware.value ? { ...stackEndsEnabled.value } : undefined,
      industryId: isSoftware.value ? undefined : nonSoftwareIndustryId.value,
    });
    const roleSummary = (result.brief.matchPlan || [])
      .map((m) => `${m.roleNameZh || m.roleId}→${m.task || "按岗职责"}`)
      .join("；");
    fouMsg.success(
      mode === "save_and_kickoff"
        ? result.awaitingDesignConfirm
          ? `已保存并开始设计（入职 ${result.hiredCount} 人）。请确认线框后再写码。`
          : `已保存并开工（入职 ${result.hiredCount} 人${result.dispatched != null ? `，派活 ${result.dispatched}` : ""}）。进度请到「办公室」查看。`
        : `项目「${result.project.name}」已保存（入职 ${result.hiredCount} 人）`,
    );
    emit("done", {
      mode,
      project: result.project,
      kickedOff: result.kickedOff,
      hiredCount: result.hiredCount,
      dispatched: result.dispatched,
      roleSummary,
      awaitingDesignConfirm: result.awaitingDesignConfirm,
    });
    emit("update:visible", false);
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function onLater() {
  emit("done", { mode: "later" });
  emit("update:visible", false);
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    :title="`开始项目 · ${wizardStepTitle}`"
    width="620px"
    append-to-body
    :close-on-click-modal="false"
    :show-fullscreen="false"
    :show-minimize="false"
    :z-index="21100"
  >
    <div class="psc-steps ui-font">
      <span
        v-for="n in maxWizardStep"
        :key="n"
        class="psc-step"
        :class="{ active: wizardStep === n, done: wizardStep > n }"
      >
        {{ n }}
      </span>
    </div>

    <div v-show="wizardStep === 1" class="psc-step-panel">
      <p class="psc-hint ui-font">
        选择父目录并填写项目名称。完整路径 = 父目录 + 项目名（
        <strong>支持中文</strong>，文件夹名与项目名称一致，不会改成英文拼音）。
      </p>
      <div class="psc-field">
        <label class="psc-label ui-font">项目名称（即文件夹名）</label>
        <FouInput
          v-model="projectName"
          placeholder="例如：幼儿园收费小程序"
          :disabled="busy"
        />
      </div>
      <div class="psc-field">
        <label class="psc-label ui-font">父目录</label>
        <div class="psc-path-row">
          <FouInput
            v-model="parentPath"
            class="psc-path-input"
            placeholder="选择或输入父目录"
            :disabled="busy"
          />
          <FouButton
            icon="folder-open-line"
            native-type="button"
            :disabled="busy"
            @click="pickParentPath"
          >
            选择目录
          </FouButton>
        </div>
      </div>
      <div v-if="previewGeneratePath" class="psc-field">
        <label class="psc-label ui-font">预览完整路径</label>
        <p class="psc-path-preview ui-font">{{ previewGeneratePath }}</p>
      </div>
    </div>

    <div v-show="wizardStep === 2" class="psc-step-panel">
      <div v-if="!isSoftware" class="psc-field">
        <label class="psc-label ui-font">行业</label>
        <select v-model="nonSoftwareIndustryId" class="psc-select ui-font" :disabled="busy">
          <option v-for="ind in nonSoftwareIndustries" :key="ind.id" :value="ind.id">
            {{ ind.label }}
          </option>
        </select>
      </div>
      <p class="psc-hint ui-font">选择 Agent 在本项目中的工具权限。只读模式下无法写文件或执行 Shell。</p>
      <div class="psc-mode-row">
        <FouButton
          v-for="preset in (['readonly', 'readwrite', 'full'] as const)"
          :key="preset"
          :icon="preset === 'readonly' ? 'eye-line' : preset === 'readwrite' ? 'edit-line' : 'shield-check-line'"
          size="small"
          native-type="button"
          :type="permissionPreset === preset ? 'primary' : 'default'"
          :disabled="busy"
          @click="permissionPreset = preset"
        >
          {{ TOOL_POLICY_PRESET_LABELS[preset] }}
        </FouButton>
      </div>
      <p class="psc-stack-hint ui-font">
        {{
          permissionPreset === "readonly"
            ? "仅允许读文件、列目录与搜索。"
            : permissionPreset === "readwrite"
              ? "允许读写文件，不含 Shell / 浏览器 / IDE。"
              : "软件项目默认全开，适合研发开工。"
        }}
      </p>
    </div>

    <div v-show="wizardStep === 3 && isSoftware" class="psc-step-panel">
      <p class="psc-hint ui-font">勾选要创建的端与目录。确认后将生成 docs/、UI/、code/ 标准结构。</p>
      <div class="psc-mode-row">
        <FouButton
          v-for="end in STACK_ENDS"
          :key="end.key"
          :icon="end.key === 'ui' ? 'palette-line' : end.key === 'desktop' ? 'computer-line' : end.key === 'app' ? 'smartphone-line' : end.key === 'backend' ? 'server-line' : 'window-line'"
          size="small"
          native-type="button"
          :type="isStackEndOn(end.key) ? 'primary' : 'default'"
          :disabled="busy"
          @click="toggleStackEnd(end.key, !isStackEndOn(end.key))"
        >
          {{ end.label }}
        </FouButton>
      </div>
      <pre class="psc-tree-preview ui-font">{{ directoryTreePreview }}</pre>
    </div>

    <div v-show="wizardStep === maxWizardStep" class="psc-step-panel">
    <p class="psc-hint ui-font">
      软件项目将先规划与出线框设计，确认设计与技术方案后再写码。请指定技术栈、研发模式、智脑/写码模型；可选填 Git 远程。
    </p>
    <div v-if="isSoftware" class="psc-field">
      <label class="psc-label ui-font">研发模式</label>
      <div class="psc-mode-row">
        <FouButton
          icon="refresh-line"
          size="small"
          native-type="button"
          :type="kickoffMode === 'phased' ? 'primary' : 'default'"
          :disabled="busy"
          @click="kickoffMode = 'phased'"
        >
          {{ KICKOFF_MODE_LABEL.phased }}
        </FouButton>
        <FouButton
          icon="git-branch-line"
          size="small"
          native-type="button"
          :type="kickoffMode === 'strict' ? 'primary' : 'default'"
          :disabled="busy"
          @click="kickoffMode = 'strict'"
        >
          {{ KICKOFF_MODE_LABEL.strict }}
        </FouButton>
      </div>
    </div>
    <div v-if="isSoftware" class="psc-field">
      <label class="psc-label ui-font">写码表面</label>
      <div class="psc-mode-row">
        <FouButton
          icon="code-box-line"
          size="small"
          native-type="button"
          :type="codeEditorSurface === 'builtin' ? 'primary' : 'default'"
          :disabled="busy"
          @click="codeEditorSurface = 'builtin'"
        >
          内置 虚募阁 IDE
        </FouButton>
        <FouButton
          icon="terminal-window-line"
          size="small"
          native-type="button"
          :type="codeEditorSurface === 'external' ? 'primary' : 'default'"
          :disabled="busy"
          @click="codeEditorSurface = 'external'"
        >
          本机 IDE
        </FouButton>
      </div>
      <p class="psc-stack-hint ui-font">
        改文件始终走 Agent。内置：在应用内看过程。本机：开发开始时打开已安装的 IDE。
      </p>
      <FouSelect
        v-if="codeEditorSurface === 'external'"
        v-model="toolchainIde"
        placeholder="已安装的 IDE"
        :options="ideSelectOptions"
        :disabled="busy"
        style="max-width: 280px; margin-top: 6px"
      />
    </div>
    <div class="psc-field">
      <label class="psc-label ui-font">生成路径</label>
      <p class="psc-path-preview ui-font">{{ previewGeneratePath || generatePath }}</p>
    </div>
    <div v-if="isSoftware" class="psc-field">
      <label class="psc-label ui-font">Git 远程仓库（可选）</label>
      <p class="psc-stack-hint ui-font">
        请先在 Gitee/GitHub 建好空仓，粘贴 HTTPS 或 SSH 地址；设计确认后会自动 init/提交并尝试推送。
      </p>
      <FouInput
        v-model="gitRemoteUrl"
        placeholder="https://gitee.com/org/repo.git"
        :disabled="busy"
      />
      <FouInput
        v-model="gitDefaultBranch"
        class="psc-branch"
        placeholder="默认分支 main"
        :disabled="busy"
        style="margin-top: 6px; max-width: 160px"
      />
    </div>
    <div class="psc-models">
      <div class="psc-field">
        <label class="psc-label ui-font">智脑模型（规划 / 分配任务）</label>
        <select v-model="commandModelKey" class="psc-select ui-font" :disabled="busy">
          <option value="">请选择…</option>
          <optgroup v-if="modelOpts.localModels.length" label="本地 Ollama">
            <option v-for="m in modelOpts.localModels" :key="'c-l-' + m" :value="'local:' + m">
              {{ m }}
            </option>
          </optgroup>
          <optgroup v-if="modelOpts.remotePresets.length" label="远程 API">
            <option
              v-for="p in modelOpts.remotePresets"
              :key="'c-r-' + p.id"
              :value="'remote:' + p.id"
            >
              {{ p.label }} · {{ p.textModel }}
            </option>
          </optgroup>
        </select>
      </div>
      <div class="psc-field">
        <label class="psc-label ui-font">写码模型（开发员工）</label>
        <select v-model="codeModelKey" class="psc-select ui-font" :disabled="busy">
          <option value="">请选择…</option>
          <optgroup v-if="modelOpts.localModels.length" label="本地 Ollama">
            <option v-for="m in modelOpts.localModels" :key="'d-l-' + m" :value="'local:' + m">
              {{ m }}
            </option>
          </optgroup>
          <optgroup v-if="modelOpts.remotePresets.length" label="远程 API">
            <option
              v-for="p in modelOpts.remotePresets"
              :key="'d-r-' + p.id"
              :value="'remote:' + p.id"
            >
              {{ p.label }} · {{ p.textModel }}
            </option>
          </optgroup>
        </select>
      </div>
    </div>
    <div v-if="isSoftware" class="psc-field">
      <label class="psc-label ui-font">技术栈（语言 / 框架）</label>
      <p class="psc-stack-hint ui-font">
        可多选市面常见语言与框架；系统会据此划分前端/后端/桌面/App 目录，并写入项目给员工遵守。
      </p>
      <MultiSelectDropdown
        v-model="techStackSelected"
        :options="TECH_STACK_OPTIONS"
        placeholder="例如 TypeScript、Vue、Go、Spring Boot…"
        :disabled="busy"
      />
    </div>
    <p
      v-if="!modelOpts.localModels.length && !modelOpts.remotePresets.length"
      class="psc-empty ui-font"
    >
      未检测到可用模型。请先到「设置 → 模型」配置本地 Ollama 或远程预设。
    </p>
    <div class="psc-field">
      <label class="psc-label ui-font">派岗表（调用这些 AI 员工）</label>
      <p v-if="!matchRows.length" class="psc-empty ui-font">
        确认后将自动匹配岗位；也可先点「确认需求」生成派岗表。
      </p>
      <ul v-else class="psc-roles">
        <li v-for="row in matchRows" :key="row.roleId" class="psc-role">
          <label class="psc-role-label ui-font">
            <FouCheckbox
              :model-value="isRoleOn(row.roleId)"
              :disabled="busy"
              @update:model-value="(v: boolean) => toggleRole(row.roleId, v)"
            />
            <span class="psc-role-name">{{ row.roleNameZh || row.roleId }}</span>
            <span class="psc-role-task">{{ row.task || "按岗位职责推进" }}</span>
          </label>
        </li>
      </ul>
    </div>
    </div>
    <template #footer>
      <FouButton icon="time-line" native-type="button" :disabled="busy" @click="onLater">
        稍后
      </FouButton>
      <FouButton
        v-if="wizardStep > 1"
        icon="arrow-left-line"
        native-type="button"
        :disabled="busy"
        @click="wizardPrev"
      >
        上一步
      </FouButton>
      <FouButton
        v-if="wizardStep < maxWizardStep"
        icon="arrow-right-line"
        type="primary"
        native-type="button"
        :disabled="!canWizardNext || busy"
        @click="wizardNext"
      >
        下一步
      </FouButton>
      <template v-if="wizardStep === maxWizardStep">
      <FouButton
        icon="save-line"
        native-type="button"
        :disabled="!canSubmit || busy"
        @click="runStart('save_only')"
      >
        仅保存项目
      </FouButton>
      <FouButton
        type="primary"
        icon="palette-line"
        native-type="button"
        :disabled="!canKickoff || busy"
        @click="runStart('save_and_kickoff')"
      >
        {{ isSoftware ? "保存并开始设计" : "保存并开工" }}
      </FouButton>
      </template>
    </template>
  </FouDialog>
</template>

<style scoped>
.psc-hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted, #64748b);
  line-height: 1.45;
}
.psc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.psc-label {
  font-size: 13px;
  color: var(--body-strong, #0f172a);
}
.psc-path-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.psc-path-input {
  flex: 1;
  min-width: 0;
}
.psc-models {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 560px) {
  .psc-models {
    grid-template-columns: 1fr;
  }
}
.psc-stack-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted, #64748b);
  line-height: 1.4;
}
.psc-mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.psc-select {
  width: 100%;
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid var(--hairline, #e2e8f0);
  background: var(--surface, #fff);
  color: var(--body, #334155);
  padding: 6px 10px;
  font-size: 13px;
}
.psc-empty {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted, #64748b);
}
.psc-roles {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--hairline, #e2e8f0);
  border-radius: 8px;
}
.psc-role {
  border-bottom: 1px solid var(--hairline, #e2e8f0);
}
.psc-role:last-child {
  border-bottom: none;
}
.psc-role-label {
  display: grid;
  grid-template-columns: auto minmax(72px, 28%) 1fr;
  gap: 8px;
  align-items: start;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12px;
}
.psc-role-name {
  font-weight: 600;
  color: var(--body-strong, #0f172a);
}
.psc-role-task {
  color: var(--muted, #64748b);
  line-height: 1.4;
}
.psc-steps {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.psc-step {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  border: 1px solid var(--hairline, #e2e8f0);
  color: var(--muted, #64748b);
}
.psc-step.active {
  background: var(--primary, #2563eb);
  border-color: var(--primary, #2563eb);
  color: #fff;
}
.psc-step.done {
  border-color: var(--primary, #2563eb);
  color: var(--primary, #2563eb);
}
.psc-path-preview {
  margin: 0;
  font-size: 12px;
  word-break: break-all;
  color: var(--body, #334155);
}
.psc-tree-preview {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface-2, #f8fafc);
  border: 1px solid var(--hairline, #e2e8f0);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
}
</style>
