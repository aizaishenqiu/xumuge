<script setup lang="ts">
/**
 * @file 项目创建与编辑表单
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.0.1
 * @category UI
 * @algo wizard-state-validation
 */
import { computed, reactive, ref, watch } from "vue";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton } from "foucui";
import {
  genderLabel,
  genderTagClass,
  loadProjectCategories,
  INDUSTRY_LABEL,
  upsertProject,
  type XuProject,
  type ProjectCategory,
  type ProjectToolchain,
  type ProjectKickoffMode,
  KICKOFF_MODE_LABEL,
} from "../utils/projects";
import type { IndustryId, IndustryProfile } from "../project/industryProfiles";
import { defaultIndustryProfile } from "../project/industryProfiles";
import {
  getRequirementPlaceholder,
  getRequirementTemplate,
  isRequirementTemplateOnly,
} from "../project/industryRequirementTemplates";
import {
  getWizardForIndustry,
  industryToProjectType,
  type WizardStepId,
} from "../project/industryWizards";
import {
  addEmployee,
  findEmployeeByAgentRoleId,
  loadEmployees,
  readEmployees,
  type Employee,
} from "../utils/employees";
import { getAgencyRole, type AgencyRole } from "../office/agencyRoles";
import { resolveLegacyAgencyRoleId } from "../office/agencyRoleIdMap";
import {
  buildDefaultKickoffPlan,
  defaultToolchain,
} from "../utils/softwareKickoff";
import {
  buildAndWritePlaybook,
  deliveryFromKickoff,
  emptyStackProfile,
  formatStackLangs,
  parseStackLangs,
  suggestStackEndDirs,
  STACK_ENDS,
  TECH_STACK_OPTIONS,
  type StackEndKey,
  type StackProfile,
  validateStackForSoftware,
} from "../utils/projectStack";
import {
  defaultProjectToolPolicy,
  type ProjectToolPolicy,
  TOOL_POLICY_LABELS,
} from "../utils/projectToolPolicy";
import { sanitizeUserDisplayText, toUserError } from "../utils/userFacingError";
import ProjectRolePickerDialog from "./ProjectRolePickerDialog.vue";
import XuReqEditor from "./XuReqEditor.vue";
import MultiSelectDropdown from "./MultiSelectDropdown.vue";
import {
  firstInstalledIde,
  idePickerOptions,
  isIdeCliInstalled,
  probeInstalledIdes,
  type IdeProbeResult,
  emptyIdeProbe,
} from "../utils/ideProbe";
import type { CodeEditorSurface } from "../utils/codingSurfacePrefs";

const props = defineProps<{
  open: boolean;
  project?: XuProject | null;
  preferredIndustryId?: IndustryId | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [project: XuProject];
}>();

const dialogOpen = computed({
  get: () => props.open,
  set: (v: boolean) => {
    if (!v) emit("close");
  },
});

const isEdit = computed(() => Boolean(props.project?.id));
const wizardStep = ref(0);
const name = ref("");
const categoryId = ref("");
const industryId = ref<IndustryId>("software");
const kickoffMode = ref<ProjectKickoffMode>("phased");
const industryProfile = reactive<IndustryProfile>(defaultIndustryProfile("software"));
const selectedIds = ref<string[]>([]);
const employeeNotes = ref<Record<string, string>>({});
const docPath = ref("");
const generatePath = ref("");
const toolchainIde = ref<ProjectToolchain["ide"]>("cursor");
const codeEditorSurface = ref<Exclude<CodeEditorSurface, "inherit">>("builtin");
const ideProbe = ref<IdeProbeResult>(emptyIdeProbe());
const toolchainLangSelected = ref<string[]>(["TypeScript"]);
const toolchainPm = ref("pnpm");
const employees = ref<Employee[]>([]);
const categories = ref<ProjectCategory[]>([]);
const error = ref("");
const saving = ref(false);
const rolePickerOpen = ref(false);

const stack = reactive<StackProfile>(emptyStackProfile());
const reqMode = ref<"editor" | "doc_folder" | "both">("editor");
const richHtml = ref("");
const docFolder = ref("");
const playbookAck = ref(false);
const toolPolicy = reactive<ProjectToolPolicy>(defaultProjectToolPolicy());
const toolPolicyAck = ref(false);
const errorDetailOpen = ref(false);

const errorSummary = computed(() => {
  const raw = error.value.trim();
  if (!raw) return "";
  if (/fs\.write_text_file|not allowed|Permissions associated/i.test(raw)) {
    return "无法写入生成路径，请检查目录是否存在、是否有写权限，或重新选择生成路径。";
  }
  if (/生成路径为空|路径超出工作区/i.test(raw)) {
    return "生成路径无效，请重新选择可写文件夹。";
  }
  return sanitizeUserDisplayText(raw, "保存失败，请检查填写内容后重试");
});

const errorHasDetail = computed(() => false);

const reqPlaceholder = computed(() => getRequirementPlaceholder(industryId.value));

const wizardConfig = computed(() => getWizardForIndustry(industryId.value));
const type = computed(() => industryToProjectType(industryId.value));
const isSoftware = computed(() => wizardConfig.value.steps.some((s) => s.id === "stack"));
const maxStep = computed(() => (isEdit.value ? 0 : wizardConfig.value.steps.length - 1));
const stepTitles = computed(() => wizardConfig.value.steps.map((s) => s.title));
const currentStepId = computed<WizardStepId>(
  () => wizardConfig.value.steps[wizardStep.value]?.id ?? "basics",
);

const industryOptions = Object.entries(INDUSTRY_LABEL).map(([value, label]) => ({
  value: value as IndustryId,
  label,
}));

const categorySelectOptions = computed(() =>
  categories.value.map((c) => ({ value: c.id, label: c.name })),
);

const ideSelectOptions = computed(() => idePickerOptions(ideProbe.value));

const selectedEmployees = computed(() => {
  const map = new Map(employees.value.map((e) => [e.id, e]));
  return selectedIds.value.map((id) => map.get(id)).filter(Boolean) as Employee[];
});

const selectedRoleIds = computed(() =>
  selectedEmployees.value.map((e) => e.agentRoleId).filter(Boolean),
);

function applyIndustryProfile(src: IndustryProfile | null | undefined, id: IndustryId) {
  const base = defaultIndustryProfile(id);
  Object.assign(industryProfile, base, src || {});
  if (id === "finance") {
    const profile = industryProfile as Extract<IndustryProfile, { kind: "finance" }>;
    const financeBase = (base.kind === "finance" ? base : defaultIndustryProfile("finance")) as Extract<
      IndustryProfile,
      { kind: "finance" }
    >;
    const financeSrc = src?.kind === "finance" ? src : null;
    profile.dataSources = [...(financeSrc?.dataSources ?? financeBase.dataSources)];
    profile.outputFormats = [...(financeSrc?.outputFormats ?? financeBase.outputFormats)];
  }
  if (id === "events") {
    const profile = industryProfile as Extract<IndustryProfile, { kind: "events" }>;
    const eventsBase = (base.kind === "events" ? base : defaultIndustryProfile("events")) as Extract<
      IndustryProfile,
      { kind: "events" }
    >;
    const eventsSrc = src?.kind === "events" ? src : null;
    profile.deliverableTypes = [...(eventsSrc?.deliverableTypes ?? eventsBase.deliverableTypes)];
  }
  if (id === "marketing") {
    const profile = industryProfile as Extract<IndustryProfile, { kind: "marketing" }>;
    const marketingBase = (base.kind === "marketing" ? base : defaultIndustryProfile("marketing")) as Extract<
      IndustryProfile,
      { kind: "marketing" }
    >;
    const marketingSrc = src?.kind === "marketing" ? src : null;
    profile.channels = [...(marketingSrc?.channels ?? marketingBase.channels)];
  }
  if (id === "design") {
    const profile = industryProfile as Extract<IndustryProfile, { kind: "design" }>;
    const designBase = (base.kind === "design" ? base : defaultIndustryProfile("design")) as Extract<
      IndustryProfile,
      { kind: "design" }
    >;
    const designSrc = src?.kind === "design" ? src : null;
    profile.deliverableFormats = [...(designSrc?.deliverableFormats ?? designBase.deliverableFormats)];
  }
}

watch(industryId, (id, prev) => {
  if (!props.project) applyIndustryProfile(null, id);
  if (props.project || !props.open) return;
  if (!prev || prev === id) {
    if (!stripRough(richHtml.value)) richHtml.value = getRequirementTemplate(id);
    return;
  }
  if (isRequirementTemplateOnly(richHtml.value, prev) || !stripRough(richHtml.value)) {
    richHtml.value = getRequirementTemplate(id);
  } else if (window.confirm("切换行业将按新模板重置需求内容，是否继续？")) {
    richHtml.value = getRequirementTemplate(id);
  }
});

async function refreshMeta() {
  try {
    employees.value = await loadEmployees();
  } catch {
    employees.value = readEmployees();
  }
  categories.value = await loadProjectCategories();
}

function applyStack(src: StackProfile | null | undefined) {
  const base = emptyStackProfile();
  Object.assign(stack, base, src || {});
  stack.enabled = { ...base.enabled, ...(src?.enabled || {}) };
}

function resetForm() {
  error.value = "";
  saving.value = false;
  rolePickerOpen.value = false;
  wizardStep.value = 0;
  playbookAck.value = false;
  void refreshMeta().then(() => {
    if (props.project) {
      name.value = props.project.name;
      categoryId.value = props.project.categoryId;
      industryId.value = props.project.industryId || "software";
      applyIndustryProfile(props.project.industryProfile, industryId.value);
      selectedIds.value = [...props.project.employeeIds];
      employeeNotes.value = { ...(props.project.employeeNotes || {}) };
      docPath.value = props.project.docPath;
      generatePath.value = props.project.generatePath;
      const tc = props.project.toolchain || defaultToolchain();
      toolchainIde.value = tc.ide;
      codeEditorSurface.value =
        tc.codeEditorSurface === "external" ? "external" : "builtin";
      toolchainLangSelected.value =
        tc.languages?.length ? [...tc.languages] : ["TypeScript"];
      toolchainPm.value = tc.packageManager || "pnpm";
      applyStack(props.project.stackProfile);
      const rq = props.project.requirements;
      reqMode.value = rq?.mode || "editor";
      richHtml.value = rq?.richHtml || getRequirementTemplate(industryId.value);
      docFolder.value = rq?.docFolder || props.project.docPath || "";
      Object.assign(toolPolicy, props.project.toolPolicy || defaultProjectToolPolicy());
      toolPolicyAck.value = Boolean(props.project.toolPolicy);
      kickoffMode.value = props.project.kickoffMode || "phased";
    } else {
      name.value = "";
      categoryId.value = categories.value[0]?.id || "";
      industryId.value = props.preferredIndustryId || "software";
      applyIndustryProfile(null, industryId.value);
      selectedIds.value = [];
      employeeNotes.value = {};
      docPath.value = "";
      generatePath.value = "";
      toolchainIde.value = "cursor";
      codeEditorSurface.value = "builtin";
      toolchainLangSelected.value = ["TypeScript"];
      toolchainPm.value = "pnpm";
      applyStack(emptyStackProfile());
      kickoffMode.value = "phased";
      reqMode.value = "editor";
      richHtml.value = getRequirementTemplate(industryId.value);
      docFolder.value = "";
      Object.assign(toolPolicy, defaultProjectToolPolicy());
      toolPolicyAck.value = false;
    }
  });
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      resetForm();
      void probeInstalledIdes().then((p) => {
        ideProbe.value = p;
        if (codeEditorSurface.value === "external" && !isIdeCliInstalled(toolchainIde.value, p)) {
          const hit = firstInstalledIde(p);
          if (hit) toolchainIde.value = hit;
        }
      });
    }
  },
);

function removeEmp(id: string) {
  selectedIds.value = selectedIds.value.filter((x) => x !== id);
}

const ensureRoleLocks = new Map<string, Promise<Employee>>();

async function ensureEmployeeForRole(role: AgencyRole): Promise<Employee> {
  const roleKey = resolveLegacyAgencyRoleId(role.id);
  const pending = ensureRoleLocks.get(roleKey);
  if (pending) return pending;

  const job = (async () => {
    await refreshMeta();
    const existing = findEmployeeByAgentRoleId(role.id, employees.value);
    if (existing) return existing;
    const gender = /女|design|ux|content|marketing/i.test(`${role.nameZh}${role.id}`)
      ? "female"
      : "male";
    return addEmployee({
      name: (role.nameZh || role.name).slice(0, 20),
      role: role.nameZh || role.name,
      agentRoleId: role.id,
      roleKind: role.roleKind,
      brainSlot: role.brainSlot,
      gender,
      avatarId: gender === "female" ? "rose" : "classic",
      deskIndex: null,
      workspaceRoot: null,
      readExtraPaths: [],
      allowNetworkExfil: false,
      driveMode: "off",
      apiSource: "inherit",
    });
  })();

  ensureRoleLocks.set(roleKey, job);
  try {
    return await job;
  } finally {
    ensureRoleLocks.delete(roleKey);
  }
}

/** 勾选岗位后确保对应员工存在并加入项目选中列表 */
async function onPickRole(role: AgencyRole) {
  error.value = "";
  try {
    const emp = await ensureEmployeeForRole(role);
    await refreshMeta();
    if (!selectedIds.value.includes(emp.id)) {
      selectedIds.value = [...selectedIds.value, emp.id];
    }
  } catch (e) {
    error.value = toUserError(e);
  }
}

function onUnpickRole(roleId: string) {
  const emp = findEmployeeByAgentRoleId(roleId, employees.value);
  if (emp) removeEmp(emp.id);
}

async function pickDoc() {
  if (isEdit.value && docPath.value) return;
  try {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) docPath.value = selected;
  } catch (e) {
    error.value = toUserError(e);
  }
}

async function pickGenerate() {
  try {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) generatePath.value = selected;
  } catch (e) {
    error.value = toUserError(e);
  }
}

async function pickStackDir(key: StackEndKey) {
  try {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) {
      (stack as Record<string, unknown>)[`${key}Dir`] = selected;
    }
  } catch (e) {
    error.value = toUserError(e);
  }
}

async function pickDocFolder() {
  try {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) docFolder.value = selected;
  } catch (e) {
    error.value = toUserError(e);
  }
}

function toggleEnd(key: StackEndKey) {
  stack.enabled = { ...stack.enabled, [key]: !stack.enabled?.[key] };
}

function validateBasics(): string | null {
  if (!name.value.trim()) return "请填写项目名称";
  if (selectedIds.value.length === 0) return "请通过「选择角色」添加至少一名员工";
  if (isSoftware.value && !codeEditorSurface.value) return "软件研发项目请选择写码表面";
  if (isSoftware.value && codeEditorSurface.value === "external") {
    if (!isIdeCliInstalled(toolchainIde.value, ideProbe.value)) {
      return "本机 IDE 未检测到 CLI，请安装 Cursor / VS Code 等并加入 PATH，或改选内置虚募阁 IDE";
    }
  }
  if (isSoftware.value && codeEditorSurface.value === "builtin" && !toolchainIde.value) {
    toolchainIde.value = "cursor";
  }
  if (isSoftware.value && toolchainLangSelected.value.length === 0) {
    return "请至少选择一种开发语言";
  }
  if (!generatePath.value.trim()) return "请选择生成路径";
  return null;
}

function validateRequirements(forEdit = false): string | null {
  const hasEditor = reqMode.value === "editor" || reqMode.value === "both";
  const hasFolder = reqMode.value === "doc_folder" || reqMode.value === "both";
  if (hasEditor && !stripRough(richHtml.value)) {
    return "请按行业模板填写需求，或改为仅文档夹模式";
  }
  if (hasFolder && !docFolder.value.trim()) {
    return "请指定需求文档文件夹";
  }
  if (!forEdit && !playbookAck.value) return "请勾选「已确认将生成项目需求摘要文档」";
  return null;
}

function stripRough(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function validateToolPolicy(): string | null {
  if (!toolPolicyAck.value) return "请勾选「已确认工具权限」后再继续";
  return null;
}

function validateCurrentStep(): string | null {
  const id = currentStepId.value;
  if (id === "basics") return validateBasics();
  if (id === "stack") {
    applySuggestedStackDirs();
    return validateStackForSoftware(stack);
  }
  if (id === "requirements") return validateRequirements();
  if (id === "tool_policy") return validateToolPolicy();
  return null;
}

function validateStep0(): string | null {
  return validateBasics();
}

function validateStep2(): string | null {
  return validateRequirements();
}

function nextStep() {
  error.value = "";
  const e = validateCurrentStep();
  if (e) {
    error.value = e;
    return;
  }
  if (wizardStep.value < maxStep.value) wizardStep.value += 1;
}

function prevStep() {
  error.value = "";
  if (wizardStep.value > 0) wizardStep.value -= 1;
}

async function save() {
  error.value = "";
  if (!isEdit.value) {
    for (let i = 0; i <= maxStep.value; i++) {
      wizardStep.value = i;
      const e = validateCurrentStep();
      if (e) {
        error.value = e;
        return;
      }
    }
    wizardStep.value = maxStep.value;
  } else {
    const e0 = validateBasics();
    if (e0) {
      error.value = e0;
      return;
    }
    if (isSoftware.value) {
      applySuggestedStackDirs();
      const e1 = validateStackForSoftware(stack);
      if (e1) {
        error.value = e1;
        return;
      }
    }
    const eReq = validateRequirements(true);
    if (eReq) {
      error.value = eReq;
      return;
    }
  }

  saving.value = true;
  try {
    const projectType = type.value;
    const toolchain =
      isSoftware.value
        ? {
            ide: toolchainIde.value,
            codeEditorSurface: codeEditorSurface.value,
            languages: [...toolchainLangSelected.value],
            packageManager: toolchainPm.value.trim() || undefined,
            repoStyle: "app",
          }
        : props.project?.toolchain ?? null;
    const kickoffPlan =
      props.project?.kickoffPlan || buildDefaultKickoffPlan(projectType);

    let stackProfile: StackProfile | null = null;
    let requirements = props.project?.requirements ?? null;
    let deliveryProgress = props.project?.deliveryProgress ?? null;
    let playbookPath = requirements?.playbookPath;

    if (isSoftware.value) {
      applySuggestedStackDirs();
      stackProfile = {
        enabled: { ...stack.enabled },
        frontendDir: stack.frontendDir,
        backendDir: stack.backendDir,
        uiDir: stack.uiDir,
        desktopDir: stack.desktopDir,
        appDir: stack.appDir,
        frontendLang: stack.frontendLang,
        backendLang: stack.backendLang,
        uiLang: stack.uiLang,
        desktopLang: stack.desktopLang,
        appLang: stack.appLang,
      };
      if (!deliveryProgress?.steps?.length) {
        deliveryProgress = deliveryFromKickoff(kickoffPlan);
      }
    } else {
      stackProfile = props.project?.stackProfile ?? null;
    }

    requirements = {
      mode: reqMode.value,
      richHtml: richHtml.value || undefined,
      docFolder: docFolder.value.trim() || undefined,
      playbookPath,
    };
    if (!isEdit.value || playbookAck.value) {
      playbookPath = await buildAndWritePlaybook({
        projectName: name.value.trim(),
        generatePath: generatePath.value.trim(),
        stack: stackProfile ?? emptyStackProfile(),
        requirements,
        customRequirements: kickoffPlan.customRequirements,
      });
      requirements = { ...requirements, playbookPath };
    }

    const profileSnapshot = JSON.parse(JSON.stringify(industryProfile)) as IndustryProfile;
    const saved = await upsertProject({
      id: props.project?.id,
      name: name.value.trim(),
      categoryId: categoryId.value || "cat_other",
      industryId: industryId.value,
      industryProfile: profileSnapshot,
      type: projectType,
      employeeIds: [...selectedIds.value],
      employeeNotes: { ...employeeNotes.value },
      docPath: docPath.value.trim(),
      generatePath: generatePath.value.trim(),
      git: null,
      toolchain,
      kickoffPlan,
      stackProfile,
      requirements,
      deliveryProgress,
      toolPolicy: { ...toolPolicy },
      kickoffMode: projectType === "software" ? kickoffMode.value : null,
    });
    emit("saved", saved);
    emit("close");
  } catch (e) {
    error.value = toUserError(e);
  } finally {
    saving.value = false;
  }
}

function roleLabel(e: Employee) {
  return getAgencyRole(e.agentRoleId)?.nameZh || e.role;
}

function applySuggestedStackDirs() {
  if (!isSoftware.value || !name.value.trim()) return;
  Object.assign(stack, suggestStackEndDirs(name.value.trim(), stack));
}

function endDir(key: StackEndKey): string {
  const cur = String((stack as Record<string, unknown>)[`${key}Dir`] || "").trim();
  if (cur) return cur;
  if (name.value.trim() && stack.enabled?.[key]) {
    const suggested = suggestStackEndDirs(name.value.trim(), stack);
    return String(suggested[`${key}Dir` as keyof StackProfile] || "");
  }
  return "";
}

function setEndLang(key: StackEndKey, langs: string[]) {
  const map: Record<StackEndKey, keyof StackProfile> = {
    frontend: "frontendLang",
    backend: "backendLang",
    ui: "uiLang",
    desktop: "desktopLang",
    app: "appLang",
  };
  (stack as Record<string, unknown>)[map[key]] = formatStackLangs(langs);
}

function endLangs(key: StackEndKey): string[] {
  return parseStackLangs(endLang(key));
}

function endLang(key: StackEndKey): string {
  const map: Record<StackEndKey, keyof StackProfile> = {
    frontend: "frontendLang",
    backend: "backendLang",
    ui: "uiLang",
    desktop: "desktopLang",
    app: "appLang",
  };
  return String(stack[map[key]] || "");
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    class="proj-form-dialog"
    :title="isEdit ? '编辑项目' : '添加项目'"
    width="920px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="true"
    :show-fullscreen="false"
    :show-minimize="false"
    :z-index="20000"
    @close="emit('close')"
  >
    <div class="proj-form">
      <div v-if="maxStep > 0" class="proj-wizard-steps">
        <div
          v-for="(t, i) in stepTitles"
          :key="t"
          class="proj-wizard-step"
          :class="{
            'proj-wizard-step--active': wizardStep === i,
            'proj-wizard-step--done': wizardStep > i,
          }"
        >
          <button
            type="button"
            class="proj-wizard-step-btn"
            :aria-current="wizardStep === i ? 'step' : undefined"
            @click="wizardStep = i"
          >
            <span class="proj-wizard-step-num">
              <span v-if="wizardStep > i" class="proj-wizard-done">✓</span>
              <span v-else>{{ i + 1 }}</span>
            </span>
            <span class="proj-wizard-step-label">{{ t }}</span>
          </button>
          <span v-if="i < stepTitles.length - 1" class="proj-wizard-step-line" />
        </div>
      </div>

      <!-- Step: basics -->
      <template v-if="currentStepId === 'basics' || (isEdit && wizardStep === 0)">
        <div class="proj-grid proj-grid-3">
          <label class="proj-field">
            <span class="proj-label">项目名称</span>
            <FouInput v-model="name" maxlength="40" placeholder="例如：虚募阁桌面客户端" />
          </label>
          <label class="proj-field">
            <span class="proj-label">行业</span>
            <FouSelect
              v-model="industryId"
              placeholder="选择行业"
              :disabled="isEdit"
              :options="industryOptions"
            />
          </label>
          <label class="proj-field">
            <span class="proj-label">标签</span>
            <FouSelect
              v-model="categoryId"
              placeholder="可选分类标签"
              :options="categorySelectOptions"
            />
          </label>
        </div>
        <div v-if="isSoftware" class="proj-req-block">
          <p class="proj-section-title">研发模式</p>
          <div class="proj-type-row">
            <FouButton
              icon="refresh-line"
              size="small"
              native-type="button"
              :type="kickoffMode === 'phased' ? 'primary' : 'default'"
              @click="kickoffMode = 'phased'"
            >
              {{ KICKOFF_MODE_LABEL.phased }}
            </FouButton>
            <FouButton
              icon="git-branch-line"
              size="small"
              native-type="button"
              :type="kickoffMode === 'strict' ? 'primary' : 'default'"
              @click="kickoffMode = 'strict'"
            >
              {{ KICKOFF_MODE_LABEL.strict }}
            </FouButton>
          </div>
          <p class="proj-hint">
            敏捷：切片开发，Review 通过后合 dev。瀑布：需求、设计、技术方案锁定后才写码。与办公室「派活模型」无关。
          </p>
        </div>

        <div v-if="isSoftware" class="proj-grid proj-grid-tool">
          <label class="proj-field">
            <span class="proj-label">写码表面</span>
            <div class="proj-emp-actions">
              <FouButton
                icon="code-box-line"
                size="small"
                native-type="button"
                :type="codeEditorSurface === 'builtin' ? 'primary' : 'default'"
                @click="codeEditorSurface = 'builtin'"
              >
                内置 虚募阁 IDE
              </FouButton>
              <FouButton
                icon="terminal-window-line"
                size="small"
                native-type="button"
                :type="codeEditorSurface === 'external' ? 'primary' : 'default'"
                @click="codeEditorSurface = 'external'"
              >
                本机 IDE
              </FouButton>
            </div>
          </label>
          <label v-if="codeEditorSurface === 'external'" class="proj-field">
            <span class="proj-label">本机 IDE</span>
            <FouSelect v-model="toolchainIde" placeholder="已安装的 IDE" :options="ideSelectOptions" />
          </label>
          <label class="proj-field">
            <span class="proj-label">包管理</span>
            <FouInput v-model="toolchainPm" placeholder="包管理器名称" />
          </label>
          <label class="proj-field">
            <span class="proj-label">技术栈</span>
            <MultiSelectDropdown
              v-model="toolchainLangSelected"
              :options="TECH_STACK_OPTIONS"
              placeholder="语言 / 框架（可多选）"
            />
          </label>
        </div>

        <div class="proj-grid proj-grid-2">
          <label class="proj-field">
            <span class="proj-label">文档路径</span>
            <div class="proj-path">
              <FouInput
                v-model="docPath"
                :disabled="isEdit && Boolean(project?.docPath)"
                placeholder="只读文档目录"
              />
              <FouButton
                icon="folder-open-line"
                size="small"
                native-type="button"
                :disabled="isEdit && Boolean(project?.docPath)"
                @click="pickDoc"
              >
                浏览
              </FouButton>
            </div>
          </label>
          <label class="proj-field">
            <span class="proj-label">生成路径</span>
            <div class="proj-path">
              <FouInput v-model="generatePath" placeholder="读写输出目录" />
              <FouButton icon="folder-open-line" size="small" native-type="button" @click="pickGenerate">
                浏览
              </FouButton>
            </div>
          </label>
        </div>

        <div class="proj-field proj-field--top">
          <span class="proj-label">员工</span>
          <div class="proj-emp-block">
            <div class="proj-emp-actions">
              <FouButton
                icon="user-star-line"
                size="small"
                type="primary"
                native-type="button"
                :disabled="saving"
                @click="rolePickerOpen = true"
              >
                选择角色
              </FouButton>
              <span class="proj-emp-tip">可多选</span>
            </div>
            <div class="proj-emp-grid">
              <FouButton
                v-for="e in selectedEmployees"
                :key="e.id"
                class="proj-emp-chip"
                icon="close-circle-line"
                size="small"
                type="primary"
                native-type="button"
                @click="removeEmp(e.id)"
              >
                <span :class="genderTagClass(e.gender)">{{ genderLabel(e.gender) }}</span>
                {{ e.name }}
                <small>{{ roleLabel(e) }}</small>
              </FouButton>
              <span v-if="selectedEmployees.length === 0" class="proj-emp-empty">尚未选择</span>
            </div>
          </div>
        </div>

        <!-- Edit: stack (software) + requirements (all industries) -->
        <template v-if="isEdit && isSoftware">
          <div class="proj-stack-block">
            <p class="proj-section-title">端与目录</p>
            <div v-for="e in STACK_ENDS" :key="e.key" class="proj-end-row">
              <FouButton
                :icon="stack.enabled?.[e.key] ? 'checkbox-circle-line' : 'checkbox-blank-line'"
                size="small"
                native-type="button"
                :type="stack.enabled?.[e.key] ? 'primary' : 'default'"
                @click="toggleEnd(e.key)"
              >
                {{ e.label }}
              </FouButton>
              <template v-if="stack.enabled?.[e.key]">
                <FouInput :model-value="endDir(e.key)" readonly placeholder="目录" />
                <FouButton icon="folder-open-line" size="small" native-type="button" @click="pickStackDir(e.key)">
                  浏览
                </FouButton>
                <MultiSelectDropdown
                  :model-value="endLangs(e.key)"
                  :options="TECH_STACK_OPTIONS"
                  placeholder="语言/框架"
                  @update:model-value="(v) => setEndLang(e.key, v)"
                />
              </template>
            </div>
          </div>
        </template>
        <template v-if="isEdit">
          <div class="proj-req-block">
            <p class="proj-section-title">需求 · {{ INDUSTRY_LABEL[industryId] }}</p>
            <p class="proj-hint">按模板章节填写；保存时可重新生成需求摘要文档。</p>
            <div class="proj-type-row">
              <FouButton icon="edit-2-line" size="small" native-type="button" :type="reqMode === 'editor' ? 'primary' : 'default'" @click="reqMode = 'editor'">富文本</FouButton>
              <FouButton icon="folder-line" size="small" native-type="button" :type="reqMode === 'doc_folder' ? 'primary' : 'default'" @click="reqMode = 'doc_folder'">文档夹</FouButton>
              <FouButton icon="stack-line" size="small" native-type="button" :type="reqMode === 'both' ? 'primary' : 'default'" @click="reqMode = 'both'">两者</FouButton>
              <FouButton icon="file-copy-line" size="small" text native-type="button" @click="richHtml = getRequirementTemplate(industryId)">
                重置模板
              </FouButton>
            </div>
            <XuReqEditor v-if="reqMode !== 'doc_folder'" v-model="richHtml" :placeholder="reqPlaceholder" />
            <div v-if="reqMode !== 'editor'" class="proj-path" style="margin-top: 8px">
              <FouInput v-model="docFolder" placeholder="需求文档文件夹" />
              <FouButton icon="folder-open-line" native-type="button" @click="pickDocFolder">浏览</FouButton>
            </div>
            <label class="proj-ack">
              <FouCheckbox v-model="playbookAck" />
              重新生成项目需求摘要文档（REQUIREMENTS_PLAYBOOK.md）
            </label>
          </div>
        </template>
      </template>

      <!-- Step: stack -->
      <template v-else-if="currentStepId === 'stack'">
        <p class="proj-hint">勾选启用的端，每端必须选目录与语言（语言可多选，不猜 monorepo）。</p>
        <div v-for="e in STACK_ENDS" :key="e.key" class="proj-end-row">
          <FouButton
            :icon="stack.enabled?.[e.key] ? 'checkbox-circle-line' : 'checkbox-blank-line'"
            size="small"
            native-type="button"
            :type="stack.enabled?.[e.key] ? 'primary' : 'default'"
            @click="toggleEnd(e.key)"
          >
            {{ e.label }}
          </FouButton>
          <template v-if="stack.enabled?.[e.key]">
            <FouInput :model-value="endDir(e.key)" readonly placeholder="目录" />
            <FouButton icon="folder-open-line" size="small" native-type="button" @click="pickStackDir(e.key)">
              浏览
            </FouButton>
            <MultiSelectDropdown
              :model-value="endLangs(e.key)"
              :options="TECH_STACK_OPTIONS"
              placeholder="语言/框架"
              @update:model-value="(v) => setEndLang(e.key, v)"
            />
          </template>
        </div>
      </template>

      <!-- Step: requirements -->
      <template v-else-if="currentStepId === 'requirements'">
        <p class="proj-hint">
          已预填「{{ INDUSTRY_LABEL[industryId] }}」行业模板，请按章节填写；可随时重置模板。
        </p>
        <div class="proj-type-row">
          <FouButton icon="edit-2-line" size="small" native-type="button" :type="reqMode === 'editor' ? 'primary' : 'default'" @click="reqMode = 'editor'">富文本</FouButton>
          <FouButton icon="folder-line" size="small" native-type="button" :type="reqMode === 'doc_folder' ? 'primary' : 'default'" @click="reqMode = 'doc_folder'">文档夹</FouButton>
          <FouButton icon="stack-line" size="small" native-type="button" :type="reqMode === 'both' ? 'primary' : 'default'" @click="reqMode = 'both'">两者</FouButton>
          <FouButton icon="file-copy-line" size="small" text native-type="button" @click="richHtml = getRequirementTemplate(industryId)">
            重置模板
          </FouButton>
        </div>
        <XuReqEditor v-if="reqMode !== 'doc_folder'" v-model="richHtml" :placeholder="reqPlaceholder" />
        <div v-if="reqMode !== 'editor'" class="proj-path" style="margin-top: 8px">
          <FouInput v-model="docFolder" placeholder="需求文档文件夹" />
          <FouButton icon="folder-open-line" native-type="button" @click="pickDocFolder">浏览</FouButton>
        </div>
        <label class="proj-ack">
          <FouCheckbox v-model="playbookAck" />
          已确认将生成项目需求摘要文档（REQUIREMENTS_PLAYBOOK.md）
        </label>
      </template>

      <template v-else-if="currentStepId === 'tool_policy'">
        <p class="proj-hint">
          勾选本项目允许 Agent 使用的工具组。未勾选的权限在聊天与派活中会被<strong>硬拒绝</strong>（不可被口头授权绕过）。
        </p>
        <div class="proj-tool-policy-grid">
          <label
            v-for="(meta, key) in TOOL_POLICY_LABELS"
            :key="key"
            class="proj-tool-policy-row"
          >
            <FouCheckbox v-model="toolPolicy[key]" />
            <span>
              <strong>{{ meta.label }}</strong>
              <span class="proj-hint">{{ meta.hint }}</span>
            </span>
          </label>
        </div>
        <label class="proj-field proj-field--top">
          <FouCheckbox v-model="toolPolicyAck" />
          <span class="proj-label">已确认工具权限（必填）</span>
        </label>
      </template>

      <!-- Step: confirm -->
      <template v-else-if="currentStepId === 'confirm'">
        <div class="proj-confirm-grid">
          <section class="proj-confirm-card">
            <h3>基本信息</h3>
            <dl>
              <div><dt>名称</dt><dd>{{ name }}</dd></div>
              <div><dt>行业</dt><dd>{{ INDUSTRY_LABEL[industryId] }}</dd></div>
              <div><dt>需求模式</dt><dd>{{ reqMode }}</dd></div>
            </dl>
          </section>
          <section class="proj-confirm-card">
            <h3>路径与端</h3>
            <dl>
              <div><dt>生成路径</dt><dd class="mono">{{ generatePath }}</dd></div>
              <template v-if="isSoftware">
                <div><dt>技术栈</dt><dd>{{ toolchainLangSelected.join("、") || "—" }}</dd></div>
                <div>
                  <dt>启用端</dt>
                  <dd>{{ STACK_ENDS.filter((e) => stack.enabled?.[e.key]).map((e) => e.label).join("、") }}</dd>
                </div>
              </template>
            </dl>
          </section>
          <section class="proj-confirm-card proj-confirm-card--wide">
            <h3>项目员工</h3>
            <div class="proj-confirm-chips">
              <span v-for="e in selectedEmployees" :key="e.id" class="proj-confirm-chip">
                {{ e.name }} · {{ roleLabel(e) }}
              </span>
              <span v-if="!selectedEmployees.length" class="proj-confirm-empty">未选择员工</span>
            </div>
          </section>
          <section class="proj-confirm-card">
            <h3>工具权限</h3>
            <p class="proj-confirm-tools">
              {{
                Object.entries(TOOL_POLICY_LABELS)
                  .filter(([k]) => toolPolicy[k as import("../utils/projectToolPolicy").ProjectToolPolicyFlag])
                  .map(([, m]) => m.label)
                  .join("、") || "无"
              }}
            </p>
            <p class="proj-confirm-note">
              保存后将生成 REQUIREMENTS_PLAYBOOK.md{{ isSoftware ? "，并写入 kickoff 进度" : "" }}。
            </p>
          </section>
        </div>
      </template>

      <div v-if="errorSummary" class="proj-error-box">
        <span class="proj-error-icon" aria-hidden="true">!</span>
        <div class="proj-error-body">
          <p class="proj-error-summary">{{ errorSummary }}</p>
        </div>
      </div>
    </div>

    <template #footer>
      <FouButton icon="close-line" native-type="button" @click="emit('close')">取消</FouButton>
      <FouButton
        v-if="maxStep > 0 && wizardStep > 0"
        icon="arrow-left-line"
        native-type="button"
        @click="prevStep"
      >
        上一步
      </FouButton>
      <FouButton
        v-if="maxStep > 0 && wizardStep < maxStep"
        type="primary"
        icon="arrow-right-line"
        native-type="button"
        @click="nextStep"
      >
        下一步
      </FouButton>
      <FouButton
        v-if="maxStep === 0 || wizardStep === maxStep"
        type="primary"
        icon="save-line"
        native-type="button"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? "保存中…" : "保存" }}
      </FouButton>
    </template>
  </FouDialog>

  <ProjectRolePickerDialog
    v-if="rolePickerOpen"
    open
    :selected-role-ids="selectedRoleIds"
    @close="rolePickerOpen = false"
    @pick="onPickRole"
    @unpick="onUnpickRole"
  />
</template>

<style scoped>
.proj-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(70vh, 620px);
  overflow: auto;
}
.proj-grid {
  display: grid;
  gap: 8px 12px;
  align-items: center;
}
.proj-grid-2 {
  grid-template-columns: 1fr 1fr;
}
.proj-grid-3 {
  grid-template-columns: 1.4fr 0.9fr 0.9fr;
}
.proj-grid-tool {
  grid-template-columns: 0.9fr 0.7fr 1.4fr;
}
.proj-field {
  display: grid;
  grid-template-columns: 4.2em 1fr;
  gap: 8px;
  align-items: center;
  margin: 0;
  min-width: 0;
}
.proj-field--top {
  align-items: start;
}
.proj-field > :not(.proj-label) {
  min-width: 0;
}
@media (max-width: 860px) {
  .proj-grid-3,
  .proj-grid-tool,
  .proj-grid-2 {
    grid-template-columns: 1fr;
  }
  .proj-field {
    grid-template-columns: 1fr;
  }
  .proj-label {
    text-align: left;
    padding-top: 0;
  }
}
.proj-wizard-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}
.proj-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
}
.proj-row--top {
  align-items: flex-start;
}
.proj-label {
  text-align: right;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.proj-type-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.proj-path {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.proj-path :deep(.fou-input) {
  flex: 1;
  min-width: 0;
}
.proj-emp-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.proj-emp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.proj-emp-tip {
  font-size: 11px;
  color: var(--muted);
}
.proj-emp-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 120px;
  overflow: auto;
}
.proj-emp-chip {
  height: auto !important;
  min-height: 32px;
}
.proj-emp-chip small {
  opacity: 0.75;
  margin-left: 4px;
}
.proj-emp-empty {
  font-size: 12px;
  color: var(--muted);
}
.proj-error {
  color: #b42318;
  font-size: 12px;
  margin: 0;
}
.proj-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.proj-section-title {
  margin: 8px 0 4px;
  font-size: 13px;
  font-weight: 600;
}
.proj-end-row {
  display: grid;
  grid-template-columns: 76px 1fr auto minmax(200px, 1.1fr);
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.proj-end-row :deep(.fou-input) {
  min-width: 0;
}
.proj-ack {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-top: 10px;
}
.proj-wizard-steps {
  display: flex;
  align-items: flex-start;
  gap: 0;
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-soft, #f8fafc);
  border: 1px solid var(--border, #e5e7eb);
  overflow-x: auto;
}
.proj-wizard-step {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.proj-wizard-step-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 4px 8px;
  min-width: 72px;
  color: var(--muted, #64748b);
}
.proj-wizard-step--active .proj-wizard-step-btn {
  color: var(--primary, #0d9488);
}
.proj-wizard-step--done .proj-wizard-step-btn {
  color: var(--primary, #0d9488);
}
.proj-wizard-step-num {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  border: 2px solid currentColor;
  background: var(--surface, #fff);
}
.proj-wizard-step--active .proj-wizard-step-num {
  background: var(--primary, #0d9488);
  color: #fff;
  border-color: var(--primary, #0d9488);
}
.proj-wizard-step--done .proj-wizard-step-num {
  border-color: transparent;
  background: transparent;
}
.proj-wizard-step-label {
  font-size: 11px;
  text-align: center;
  line-height: 1.2;
  max-width: 88px;
}
.proj-wizard-step-line {
  flex: 1;
  height: 2px;
  min-width: 12px;
  margin: 0 4px 18px;
  background: var(--border, #e2e8f0);
}
.proj-wizard-step--done .proj-wizard-step-line {
  background: var(--primary, #0d9488);
  opacity: 0.45;
}
.proj-confirm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.proj-confirm-card {
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--surface-soft, #f8fafc);
}
.proj-confirm-card--wide {
  grid-column: 1 / -1;
}
.proj-confirm-card h3 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted, #64748b);
}
.proj-confirm-card dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.proj-confirm-card dl > div {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  font-size: 13px;
}
.proj-confirm-card dt {
  margin: 0;
  color: var(--muted, #64748b);
}
.proj-confirm-card dd {
  margin: 0;
  word-break: break-all;
}
.proj-confirm-card dd.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.proj-confirm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.proj-confirm-chip {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e2e8f0);
}
.proj-confirm-empty {
  font-size: 13px;
  color: var(--muted, #64748b);
}
.proj-confirm-tools {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}
.proj-confirm-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted, #64748b);
}
.proj-error-box {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
}
.proj-error-icon {
  color: #dc2626;
  flex-shrink: 0;
  margin-top: 2px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}
.proj-wizard-done {
  font-size: 14px;
  line-height: 1;
}
.proj-error-summary {
  margin: 0;
  font-size: 13px;
  color: #b91c1c;
  line-height: 1.45;
}
.proj-error-details {
  margin-top: 6px;
  font-size: 12px;
}
.proj-error-details pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  color: #7f1d1d;
  max-height: 120px;
  overflow: auto;
}
.proj-stack-block,
.proj-req-block {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border, #e5e7eb);
}
</style>

<style>
.gender-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  border: 1px solid transparent;
}
.gender-tag--m {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #bfdbfe;
}
.gender-tag--f {
  color: #be185d;
  background: #fdf2f8;
  border-color: #fbcfe8;
}
.fou-dialog.proj-form-dialog {
  border: none !important;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28) !important;
  max-height: min(92vh, 860px) !important;
}
</style>
