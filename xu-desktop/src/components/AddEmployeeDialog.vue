<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton } from "foucui";
import {
  AVATAR_STYLES,
  addEmployee,
  generateVirtualPersona,
  listOccupiedDeskIndices,
  nextEmployeeNo,
  nextFreeDeskIndex,
  readEmployees,
  updateEmployee,
  type BrainSlot,
  type DriveMode,
  type Employee,
  type Gender,
  type RoleKind,
} from "../utils/employees";
import type { CodeEditorSurface } from "../utils/codingSurfacePrefs";
import { cachedSession } from "../utils/auth";
import { readDeskCount } from "../utils/officeSettings";
import { loadOfficeLayout } from "../utils/officeLayout";
import {
  listRoomSeatStats,
  pickSeatForDivision,
  type RoomSeatStats,
} from "../office/defaultLayout";
import type { OfficeLayout } from "../office/catalog";
import {
  hairStylesFor,
  outfitsFor,
  type HairStyleId,
  type OutfitId,
} from "../office/appearance";
import EmployeeLookPreview from "./EmployeeLookPreview.vue";
import {
  ensureAgencyCatalog,
  listAgencyRoles,
  getAgencyRole,
  type AgencyDivision,
} from "../office/agencyRoles";
import { resolveLegacyAgencyRoleId } from "../office/agencyRoleIdMap";
import AgencyDivisionTree from "./AgencyDivisionTree.vue";
import {
  getDefaultRemotePreset,
  getRemotePresetById,
  loadGlobalModelProfiles,
  type GlobalModelProfiles,
} from "../utils/globalModelProfiles";
import {
  employeePrivateApiKeyEnv,
  isApiKeyConfigured,
  setStoredApiKey,
} from "../utils/apiKeys";
import { useRouter } from "vue-router";
import { toUserError } from "../utils/userFacingError";

const props = withDefaults(
  defineProps<{
    isOpen?: boolean;
    visible?: boolean;
    employee?: Employee | null;
    preferredRoleId?: string | null;
  }>(),
  {
    isOpen: undefined,
    visible: undefined,
    employee: null,
    preferredRoleId: null,
  },
);

const emit = defineEmits<{
  close: [];
  saved: [emp: Employee];
  batch: [];
}>();

const router = useRouter();

const parentOpen = computed(() => Boolean(props.isOpen ?? props.visible));

const dialogOpen = computed({
  get: () => parentOpen.value,
  set: (v: boolean) => {
    if (!v) emit("close");
  },
});

const name = ref("");
const age = ref(28);
const employeeNoPreview = ref("");
const role = ref("工程师");
const avatarId = ref(AVATAR_STYLES[0].id);
const deskCount = computed(() => readDeskCount());
const deskChoice = ref<string>("auto");
const roomChoice = ref<string>("auto");
const officeLayout = ref<OfficeLayout | null>(null);
const roomStats = ref<RoomSeatStats[]>([]);

const deskOptions = computed(() => {
  const occupied = new Set(listOccupiedDeskIndices());
  if (props.employee?.deskIndex != null) occupied.delete(props.employee.deskIndex);
  const stats = roomStats.value;
  const roomId = roomChoice.value === "auto" ? null : roomChoice.value;
  const list = roomId ? stats.filter((r) => r.roomId === roomId) : stats;
  // Use seat:N (not bare "0") — FouSelect treats 0 / "0" as empty and blocks「席 1」.
  const out: Array<{ value: string; label: string; disabled: boolean }> = [];
  for (const r of list) {
    for (const seat of r.allSeats) {
      const taken = occupied.has(seat) && props.employee?.deskIndex !== seat;
      out.push({
        value: `seat:${seat}`,
        label: `${r.name} · 席 ${seat + 1}${taken ? "（已占用）" : ""}`,
        disabled: taken,
      });
    }
  }
  if (out.length === 0) {
    for (let i = 0; i < deskCount.value; i++) {
      const taken = occupied.has(i) && props.employee?.deskIndex !== i;
      out.push({
        value: `seat:${i}`,
        label: `席 ${i + 1}${taken ? "（已占用）" : ""}`,
        disabled: taken,
      });
    }
  }
  return out;
});

function parseDeskChoice(raw: string): number | null {
  if (raw === "auto" || raw === "none" || !raw) return null;
  if (raw.startsWith("seat:")) {
    const n = Number(raw.slice(5));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const rolePickerOpen = ref(false);
const taskPickerOpen = ref(false);
const roomPickerOpen = ref(false);
const deskPickerOpen = ref(false);
const genderPickerOpen = ref(false);
const characterPickerOpen = ref(false);
const drivePickerOpen = ref(false);

const ROLE_OPTIONS: Array<{ value: RoleKind; label: string; desc: string; icon: string }> = [
  { value: "worker", label: "员工", desc: "日常执行与协作", icon: "user-line" },
  { value: "reviewer", label: "代码审核员", desc: "审阅代码与质量把关", icon: "code-s-slash-line" },
  { value: "boss", label: "老板助理", desc: "汇总与拍板辅助", icon: "vip-crown-line" },
];

const TASK_OPTIONS: Array<{ value: BrainSlot; label: string; desc: string; icon: string }> = [
  { value: "command", label: "指挥任务", desc: "编排 / 指挥脑", icon: "compass-3-line" },
  { value: "work", label: "工作任务", desc: "通用干活 / 工作脑", icon: "briefcase-line" },
  { value: "code", label: "代码任务", desc: "写代码 / 代码脑", icon: "terminal-box-line" },
];

const GENDER_OPTIONS: Array<{ value: Gender; label: string; icon: string }> = [
  { value: "male", label: "男", icon: "men-line" },
  { value: "female", label: "女", icon: "women-line" },
];

const DRIVE_OPTIONS: Array<{ value: DriveMode; label: string; desc: string; icon: string }> = [
  { value: "off", label: "关闭", desc: "不启用驾驶", icon: "forbid-line" },
  { value: "sdk", label: "Cursor SDK", desc: "通过 SDK 驱动", icon: "terminal-box-line" },
  { value: "input_control", label: "键鼠驾驶", desc: "模拟键鼠操作", icon: "mouse-line" },
];

const roleKindLabel = computed(
  () => ROLE_OPTIONS.find((o) => o.value === roleKind.value)?.label ?? roleKind.value,
);
const brainSlotLabel = computed(
  () => TASK_OPTIONS.find((o) => o.value === brainSlot.value)?.label ?? brainSlot.value,
);
const genderLabel = computed(
  () => GENDER_OPTIONS.find((o) => o.value === gender.value)?.label ?? gender.value,
);
const driveModeLabel = computed(
  () => DRIVE_OPTIONS.find((o) => o.value === driveMode.value)?.label ?? driveMode.value,
);
const avatarLabel = computed(
  () => AVATAR_STYLES.find((a) => a.id === avatarId.value)?.name ?? avatarId.value,
);
const roomChoiceLabel = computed(() => {
  if (roomChoice.value === "auto") return "自动匹配角色办公室";
  const r = roomStats.value.find((x) => x.roomId === roomChoice.value);
  return r ? `${r.name}（空 ${r.free}/${r.total}）` : roomChoice.value;
});
const deskChoiceLabel = computed(() => {
  if (deskChoice.value === "auto") return "自动分配空位";
  if (deskChoice.value === "none") return "暂不分配";
  const opt = deskOptions.value.find((o) => o.value === deskChoice.value);
  return opt?.label ?? deskChoice.value;
});

function closeAllPickers() {
  rolePickerOpen.value = false;
  taskPickerOpen.value = false;
  roomPickerOpen.value = false;
  deskPickerOpen.value = false;
  genderPickerOpen.value = false;
  characterPickerOpen.value = false;
  drivePickerOpen.value = false;
  agencyPickerOpen.value = false;
}

function pickRole(v: RoleKind) {
  roleKind.value = v;
  rolePickerOpen.value = false;
}

function pickTask(v: BrainSlot) {
  brainSlot.value = v;
  taskPickerOpen.value = false;
}

function pickRoom(v: string) {
  roomChoice.value = v;
  roomPickerOpen.value = false;
  if (deskChoice.value.startsWith("seat:")) {
    const still = deskOptions.value.some((o) => o.value === deskChoice.value && !o.disabled);
    if (!still) deskChoice.value = "auto";
  }
}

function pickDesk(v: string) {
  deskChoice.value = v;
  deskPickerOpen.value = false;
}

function pickGender(v: Gender) {
  gender.value = v;
  genderPickerOpen.value = false;
}

function pickAvatar(id: string) {
  avatarId.value = id;
}

function pickDrive(v: DriveMode) {
  driveMode.value = v;
  drivePickerOpen.value = false;
}

function pickAgency(id: string) {
  agentRoleId.value = id;
  const ar = getAgencyRole(id);
  if (ar) {
    agencyDivision.value = ar.division;
    role.value = ar.nameZh || ar.name;
    roleKind.value = ar.roleKind;
    brainSlot.value = ar.brainSlot;
  }
  agencyPickerOpen.value = false;
}

async function refreshRoomStats() {
  try {
    const layout = await loadOfficeLayout();
    officeLayout.value = layout;
    const occupied = new Set(listOccupiedDeskIndices());
    if (props.employee?.deskIndex != null) occupied.delete(props.employee.deskIndex);
    roomStats.value = listRoomSeatStats(layout, occupied);
  } catch {
    roomStats.value = [];
  }
}
const workspaceRoot = ref("");
const readExtraText = ref("");
const allowNetworkExfil = ref(false);
const driveMode = ref<DriveMode>("off");
const codeEditorSurface = ref<CodeEditorSurface>("inherit");
const gender = ref<Gender>("male");
const roleKind = ref<RoleKind>("worker");
const brainSlot = ref<BrainSlot>("work");
const aiModel = ref("");
const aiBaseUrl = ref("");
const aiVisionModel = ref("");
const apiSource = ref<"inherit" | "local" | "remote">("inherit");
const remotePresetId = ref("");
const privateApiKeyDraft = ref("");
const privateApiKeyConfigured = ref(false);
const globalProfiles = ref<GlobalModelProfiles | null>(null);
const outfit = ref<OutfitId>("casual");
const hairStyle = ref<HairStyleId>("short");
const agencyDivision = ref<AgencyDivision>("engineering");
const agentRoleId = ref(resolveLegacyAgencyRoleId("engineering-frontend-developer"));
const agencyPickerOpen = ref(false);
const agencySearch = ref("");
const error = ref("");
const saving = ref(false);

const isEdit = computed(() => Boolean(props.employee?.id));
const hairOptions = computed(() => hairStylesFor(gender.value));
const outfitOptions = computed(() => outfitsFor(gender.value));
const agencyOptions = computed(() => {
  const q = agencySearch.value.trim().toLowerCase();
  return listAgencyRoles().filter((r) => {
    if (agencyDivision.value && agencyDivision.value !== "all" && r.division !== agencyDivision.value) {
      return false;
    }
    // 默认招聘列表隐藏「出海」偏置岗；搜索时仍可找到
    if (!agencySearch.value.trim() && (r.tags || []).includes("出海")) {
      return false;
    }
    if (!q) return true;
    const hay = `${r.nameZh} ${r.name} ${r.description}`.toLowerCase();
    return hay.includes(q);
  });
});
const selectedAgency = computed(() => getAgencyRole(agentRoleId.value));
const agencyLabel = computed(() => {
  const a = selectedAgency.value;
  if (!a) return "未选择岗位";
  return `${a.emoji} ${a.nameZh || a.name}`;
});

const selectedRemotePreset = computed(() => {
  if (!globalProfiles.value) return null;
  return getRemotePresetById(globalProfiles.value, remotePresetId.value);
});

const apiSourceSummary = computed(() => {
  const p = globalProfiles.value;
  if (!p) return "加载中…";
  if (apiSource.value === "inherit") {
    const src = p.defaultSource === "local" ? "本地" : "远程";
    const def = p.defaultSource === "local"
      ? p.local.textModel || "（未配置）"
      : getDefaultRemotePreset(p)?.label || "（未配置）";
    return `继承设置：默认${src} · ${def}`;
  }
  if (apiSource.value === "local") {
    const override = aiModel.value.trim();
    if (override) return `本员工本地模型：${override}`;
    const t = p.local.textModel || "（未配置）";
    const v = p.local.visionModel ? ` / 视觉 ${p.local.visionModel}` : "";
    return `全局本地：${t}${v}`;
  }
  const preset = selectedRemotePreset.value;
  const keyHint = privateApiKeyConfigured.value || privateApiKeyDraft.value.trim()
    ? " · 已配员工私有 Key"
    : " · 使用预设 Key";
  return preset ? `${preset.label} · ${preset.textModel}${keyHint}` : "（未选择远程预设）";
});

const remotePresetOptions = computed(() => {
  const p = globalProfiles.value;
  if (!p) return [];
  return p.remotePresets.map((r) => ({
    value: r.isDefault ? "" : r.id,
    label: r.isDefault ? `默认：${r.label}` : r.label,
  }));
});

const localOnlyMode = computed(() => globalProfiles.value?.localOnly === true);

async function loadProfilesForDialog() {
  globalProfiles.value = await loadGlobalModelProfiles();
}

function setApiSource(s: "inherit" | "local" | "remote") {
  if (s === "remote" && globalProfiles.value?.localOnly) return;
  apiSource.value = s;
}

watch(apiSource, (s) => {
  if (s === "remote" && !remotePresetId.value) {
    remotePresetId.value = "";
  }
});

watch(agentRoleId, (id) => {
  const r = getAgencyRole(id);
  if (!r) return;
  role.value = r.nameZh;
  roleKind.value = r.roleKind;
  brainSlot.value = r.brainSlot;
});

watch(gender, (g) => {
  const hairs = hairStylesFor(g);
  if (!hairs.some((h) => h.id === hairStyle.value)) {
    hairStyle.value = (hairs[0]?.id ?? "short") as HairStyleId;
  }
  const wears = outfitsFor(g);
  if (!wears.some((o) => o.id === outfit.value)) {
    outfit.value = (wears[0]?.id ?? "casual") as OutfitId;
  }
});

function rollVirtualPersona() {
  const persona = generateVirtualPersona({
    gender: gender.value,
    roleKind: roleKind.value,
    seed: `${Date.now()}_${Math.random()}`,
  });
  name.value = persona.name;
  gender.value = persona.gender;
  age.value = persona.age;
}

async function refreshEmployeeNoPreview() {
  if (props.employee?.employeeNo) {
    employeeNoPreview.value = props.employee.employeeNo;
    return;
  }
  employeeNoPreview.value = await nextEmployeeNo();
}

function resetForm() {
  error.value = "";
  roomChoice.value = "auto";
  void refreshRoomStats();
  if (props.employee) {
    name.value = props.employee.name;
    age.value = props.employee.age || 28;
    employeeNoPreview.value = props.employee.employeeNo || "";
    role.value = props.employee.role;
    avatarId.value = props.employee.avatarId;
    deskChoice.value =
      props.employee.deskIndex == null ? "none" : `seat:${props.employee.deskIndex}`;
    workspaceRoot.value = props.employee.workspaceRoot ?? "";
    readExtraText.value = props.employee.readExtraPaths.join("\n");
    allowNetworkExfil.value = props.employee.allowNetworkExfil;
    driveMode.value = props.employee.driveMode;
    codeEditorSurface.value = props.employee.codeEditorSurface || "inherit";
    gender.value = props.employee.gender;
    roleKind.value = props.employee.roleKind;
    brainSlot.value = props.employee.brainSlot;
    aiModel.value = props.employee.aiModel || "";
    aiBaseUrl.value = props.employee.aiBaseUrl || "";
    aiVisionModel.value = props.employee.aiVisionModel || "";
    apiSource.value =
      props.employee.apiSource === "local" || props.employee.apiSource === "remote"
        ? props.employee.apiSource
        : "inherit";
    remotePresetId.value = props.employee.remotePresetId || "";
    privateApiKeyDraft.value = "";
    privateApiKeyConfigured.value = false;
    void isApiKeyConfigured(employeePrivateApiKeyEnv(props.employee.id)).then((ok) => {
      privateApiKeyConfigured.value = ok;
    });
    outfit.value = (props.employee.outfit as OutfitId) || "casual";
    hairStyle.value = (props.employee.hairStyle as HairStyleId) || "short";
    agentRoleId.value = props.employee.agentRoleId || resolveLegacyAgencyRoleId("engineering-frontend-developer");
    const ar = getAgencyRole(agentRoleId.value);
    if (ar) agencyDivision.value = ar.division;
  } else {
    rollVirtualPersona();
    void refreshEmployeeNoPreview();
    role.value = "前端工程师";
    avatarId.value = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)].id;
    deskChoice.value = "auto";
    workspaceRoot.value = "";
    readExtraText.value = "";
    allowNetworkExfil.value = false;
    driveMode.value = "off";
    codeEditorSurface.value = "inherit";
    gender.value = "male";
    roleKind.value = "worker";
    brainSlot.value = "code";
    aiModel.value = "";
    aiBaseUrl.value = "";
    aiVisionModel.value = "";
    apiSource.value = "inherit";
    remotePresetId.value = "";
    privateApiKeyDraft.value = "";
    privateApiKeyConfigured.value = false;
    outfit.value = "casual";
    hairStyle.value = "short";
    agencyDivision.value = "engineering";
    agentRoleId.value = resolveLegacyAgencyRoleId("engineering-frontend-developer");
    if (props.preferredRoleId) {
      const ar = getAgencyRole(props.preferredRoleId);
      if (ar) {
        agentRoleId.value = ar.id;
        agencyDivision.value = ar.division;
        role.value = ar.nameZh || ar.name;
        roleKind.value = ar.roleKind;
        brainSlot.value = ar.brainSlot;
      }
    }
  }
}

function closeDialog() {
  closeAllPickers();
  document.body.style.overflow = "";
  requestAnimationFrame(() => {
    document.body.classList.remove("xu-popup-parent--hidden");
    document.body.style.pointerEvents = "";
  });
  emit("close");
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && parentOpen.value) {
    e.preventDefault();
    e.stopPropagation();
    closeDialog();
  }
}

watch(
  parentOpen,
  (v) => {
    if (v) {
      resetForm();
      closeAllPickers();
      void refreshRoomStats();
      void loadProfilesForDialog();
    } else {
      closeAllPickers();
      document.body.style.overflow = "";
      document.body.style.pointerEvents = "";
    }
  },
  { immediate: true },
);

onMounted(() => {
  void ensureAgencyCatalog();
  window.addEventListener("keydown", onKey, true);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey, true);
  closeAllPickers();
  document.body.style.overflow = "";
  document.body.style.pointerEvents = "";
});

async function pickWorkspace() {
  try {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) workspaceRoot.value = selected;
  } catch (e) {
    error.value = toUserError(e);
  }
}

async function save() {
  if (saving.value) return;
  if (!name.value.trim()) {
    error.value = "请填写姓名";
    return;
  }
  if (!workspaceRoot.value.trim() && roleKind.value !== "boss") {
    error.value = "请设置可写工作区（浏览选择文件夹）";
    return;
  }
  const session = cachedSession();
  if (session && !session.permissions.full) {
    const n = readEmployees().length;
    if (n >= session.permissions.maxEmployees) {
      error.value = `试用账号最多 ${session.permissions.maxEmployees} 名员工`;
      return;
    }
    if (driveMode.value !== "off") {
      error.value = "试用账号禁止键鼠驾驶";
      return;
    }
  }
  saving.value = true;
  error.value = "";
  try {
    let deskIndex: number | null = null;
    const occupied = new Set(listOccupiedDeskIndices());
    if (props.employee?.deskIndex != null) occupied.delete(props.employee.deskIndex);
    const div = getAgencyRole(agentRoleId.value)?.division;
    if (deskChoice.value === "auto") {
      deskIndex = officeLayout.value
        ? pickSeatForDivision(
            officeLayout.value,
            div,
            occupied,
            roomChoice.value === "auto" ? null : roomChoice.value,
          )
        : nextFreeDeskIndex(deskCount.value);
    } else if (deskChoice.value !== "none") {
      deskIndex = parseDeskChoice(deskChoice.value);
    }
    const payload = {
      name: name.value.trim(),
      age: age.value,
      role: role.value.trim() || "工程师",
      avatarId: avatarId.value,
      deskIndex,
      workspaceRoot: workspaceRoot.value.trim() || undefined,
      readExtraPaths: readExtraText.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      allowNetworkExfil: allowNetworkExfil.value,
      driveMode: driveMode.value,
      codeEditorSurface: codeEditorSurface.value,
      gender: gender.value,
      roleKind: roleKind.value,
      brainSlot: brainSlot.value,
      aiModel: apiSource.value === "local" ? aiModel.value.trim() : "",
      aiBaseUrl: "",
      aiVisionModel: "",
      apiSource: apiSource.value,
      remotePresetId: apiSource.value === "remote" ? remotePresetId.value : "",
      outfit: outfit.value,
      hairStyle: hairStyle.value,
      agentRoleId: agentRoleId.value,
    };
    if (props.employee?.id) {
      await updateEmployee(props.employee.id, payload);
      if (apiSource.value === "remote" && privateApiKeyDraft.value.trim()) {
        await setStoredApiKey(
          employeePrivateApiKeyEnv(props.employee.id),
          privateApiKeyDraft.value,
        );
      }
      emit("saved", { ...props.employee, ...payload, name: payload.name.trim(), age: payload.age } as Employee);
    } else {
      const emp = await addEmployee(payload);
      if (apiSource.value === "remote" && privateApiKeyDraft.value.trim()) {
        await setStoredApiKey(employeePrivateApiKeyEnv(emp.id), privateApiKeyDraft.value);
      }
      emit("saved", emp);
    }
    privateApiKeyDraft.value = "";
    closeDialog();
  } catch (e) {
    error.value = toUserError(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    class="emp-main-dialog"
    :title="isEdit ? '编辑员工' : '添加员工'"
    width="720px"
    append-to-body
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    :show-fullscreen="false"
    :show-minimize="false"
    :draggable="false"
    :resizable="false"
    :z-index="20000"
    @close="closeDialog"
  >
    <div class="emp-grid">
      <label class="emp-field">
        <span class="emp-label">工号</span>
        <FouInput :model-value="employeeNoPreview || '—'" disabled />
      </label>
      <label class="emp-field">
        <span class="emp-label">姓名（虚拟）</span>
        <div class="emp-path-row">
          <FouInput v-model="name" maxlength="20" />
          <FouButton icon="refresh-line" native-type="button" title="随机生成人设" @click="rollVirtualPersona">
            随机
          </FouButton>
        </div>
      </label>
      <label class="emp-field">
        <span class="emp-label">年龄（虚拟）</span>
        <FouInput v-model.number="age" type="number" :min="18" :max="65" />
      </label>
      <label class="emp-field">
        <span class="emp-label">职责</span>
        <FouInput v-model="role" maxlength="30" />
      </label>

      <label class="emp-field" style="grid-column: 1 / -1">
        <span class="emp-label">招聘岗位</span>
        <div class="emp-path-row">
          <FouButton
            class="emp-pick-trigger"
            icon="briefcase-4-line"
            native-type="button"
            :title="selectedAgency?.description || ''"
            @click="agencyPickerOpen = true; agencySearch = ''"
          >
            {{ agencyLabel }}
          </FouButton>
          <FouButton
            icon="folder-open-line"
            native-type="button"
            @click="router.push('/agency'); closeDialog()"
          >
            岗位库
          </FouButton>
          <FouButton
            icon="add-line"
            size="small"
            text
            native-type="button"
            @click="router.push('/agency?create=1'); closeDialog()"
          >
            新建岗位
          </FouButton>
        </div>
      </label>

      <label class="emp-field">
        <span class="emp-label">办公室</span>
        <FouButton
          class="emp-pick-trigger"
          icon="building-line"
          native-type="button"
          @click="roomPickerOpen = true"
        >
          {{ roomChoiceLabel }}
        </FouButton>
      </label>
      <label class="emp-field">
        <span class="emp-label">工位</span>
        <FouButton
          class="emp-pick-trigger"
          icon="computer-line"
          native-type="button"
          @click="deskPickerOpen = true"
        >
          {{ deskChoiceLabel }}
        </FouButton>
      </label>
      <label class="emp-field">
        <span class="emp-label">性别</span>
        <FouButton
          class="emp-pick-trigger"
          icon="user-line"
          native-type="button"
          @click="genderPickerOpen = true"
        >
          {{ genderLabel }}
        </FouButton>
      </label>

      <label class="emp-field">
        <span class="emp-label">角色</span>
        <FouButton
          class="emp-pick-trigger"
          icon="user-star-line"
          native-type="button"
          @click="rolePickerOpen = true"
        >
          {{ roleKindLabel }}
        </FouButton>
      </label>
      <label class="emp-field">
        <span class="emp-label">任务</span>
        <FouButton
          class="emp-pick-trigger"
          icon="task-line"
          native-type="button"
          @click="taskPickerOpen = true"
        >
          {{ brainSlotLabel }}
        </FouButton>
      </label>
      <label class="emp-field">
        <span class="emp-label">人物形象</span>
        <FouButton
          class="emp-pick-trigger"
          icon="emotion-line"
          native-type="button"
          @click="characterPickerOpen = true"
        >
          {{ avatarLabel }} · {{ genderLabel }}
        </FouButton>
      </label>

      <div class="emp-field" style="grid-column: 1 / -1">
        <span class="emp-label">工作 API</span>
        <div class="look-grid">
          <FouButton
            icon="link-m"
            size="small"
            native-type="button"
            :type="apiSource === 'inherit' ? 'primary' : 'default'"
            @click="setApiSource('inherit')"
          >
            继承默认
          </FouButton>
          <FouButton
            icon="computer-line"
            size="small"
            native-type="button"
            :type="apiSource === 'local' ? 'primary' : 'default'"
            @click="setApiSource('local')"
          >
            本地
          </FouButton>
          <FouButton
            icon="cloud-line"
            size="small"
            native-type="button"
            :type="apiSource === 'remote' ? 'primary' : 'default'"
            :disabled="localOnlyMode"
            @click="setApiSource('remote')"
          >
            远程
          </FouButton>
        </div>
        <p v-if="localOnlyMode" class="emp-hint ui-font">已开启「仅本地模型」，远程 API 已禁用</p>
      </div>

      <div class="emp-field emp-api-summary" style="grid-column: 1 / -1">
        <span class="emp-label">模型来源</span>
        <p class="emp-hint ui-font">{{ apiSourceSummary }}</p>
      </div>

      <div v-if="apiSource === 'local'" class="emp-field" style="grid-column: 1 / -1">
        <span class="emp-label">本地模型（可选）</span>
        <FouInput
          v-model="aiModel"
          placeholder="留空则用全局本地模型，如 qwen3:14b"
          clearable
        />
        <p class="emp-hint ui-font">仅本员工覆盖 Ollama 模型名；留空跟随设置 → 模型 → 本地。</p>
      </div>

      <div v-if="apiSource === 'remote'" class="emp-field emp-remote-preset" style="grid-column: 1 / -1">
        <span class="emp-label">远程预设</span>
        <FouSelect
          v-model="remotePresetId"
          class="emp-remote-preset-select"
          placeholder="默认远程预设"
          filterable
          :options="remotePresetOptions"
        />
      </div>

      <div v-if="apiSource === 'remote'" class="emp-field" style="grid-column: 1 / -1">
        <span class="emp-label">员工私有 API Key（可选）</span>
        <FouInput
          v-model="privateApiKeyDraft"
          type="password"
          show-password
          :placeholder="
            privateApiKeyConfigured
              ? '已配置私有 Key（留空保持不变，填写则覆盖）'
              : '留空则用远程预设的 Key；填写后仅本员工使用'
          "
          clearable
          autocomplete="new-password"
        />
        <p class="emp-hint ui-font">
          API 密钥只保存在本机，不会上传。软件开发岗可一人一 Key（本地或远程均可先选「工作 API」）。
        </p>
      </div>

      <label class="emp-field">
        <span class="emp-label">驾驶偏好</span>        <FouButton
          class="emp-pick-trigger"
          icon="steering-2-line"
          native-type="button"
          @click="drivePickerOpen = true"
        >
          {{ driveModeLabel }}
        </FouButton>
      </label>
      <div class="emp-field" style="grid-column: 1 / -1">
        <span class="emp-label">写码方式</span>
        <div class="look-grid">
          <FouButton
            icon="links-line"
            size="small"
            native-type="button"
            :type="codeEditorSurface === 'inherit' ? 'primary' : 'default'"
            @click="codeEditorSurface = 'inherit'"
          >
            跟随全局
          </FouButton>
          <FouButton
            icon="code-box-line"
            size="small"
            native-type="button"
            :type="codeEditorSurface === 'builtin' ? 'primary' : 'default'"
            @click="codeEditorSurface = 'builtin'"
          >
            内置 IDE
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
      </div>
      <label class="emp-field emp-check">
        <span class="emp-label">外传</span>
        <FouCheckbox v-model="allowNetworkExfil">允许网络外传</FouCheckbox>
      </label>
    </div>

    <div class="emp-field">
      <span class="emp-label">人物</span>
      <div class="look-row">
        <EmployeeLookPreview
          :avatar-id="avatarId"
          :gender="gender"
          :outfit="outfit"
          :hair-style="hairStyle"
        />
        <FouButton
          icon="emotion-line"
          native-type="button"
          type="primary"
          size="small"
          @click="characterPickerOpen = true"
        >
          形象
        </FouButton>
      </div>
    </div>

    <div class="emp-field">
      <span class="emp-label">工作区*</span>
      <div class="emp-path-row">
        <FouInput v-model="workspaceRoot" placeholder="绝对路径" />
        <FouButton icon="folder-open-line" native-type="button" @click="pickWorkspace">
          浏览
        </FouButton>
      </div>
    </div>

    <label class="emp-field">
      <span class="emp-label">只读路径</span>
      <FouInput v-model="readExtraText" type="textarea" :rows="2" placeholder="每行一个" />
    </label>

    <p v-if="error" class="emp-error">{{ error }}</p>

    <template #footer>
      <FouButton
        v-if="!isEdit"
        icon="group-line"
        native-type="button"
        @click="emit('batch'); closeDialog()"
      >
        批量入职
      </FouButton>
      <FouButton icon="close-line" native-type="button" @click="closeDialog">取消</FouButton>
      <FouButton
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

  <FouDialog v-model="rolePickerOpen" title="选择角色" width="440px" append-to-body :z-index="21000">
    <div class="pick-list">
      <FouButton
        v-for="o in ROLE_OPTIONS"
        :key="o.value"
        class="pick-item"
        :icon="o.icon"
        native-type="button"
        :type="roleKind === o.value ? 'primary' : 'default'"
        @click="pickRole(o.value)"
      >
        <span class="pick-item-text">
          <strong>{{ o.label }}</strong>
          <small>{{ o.desc }}</small>
        </span>
      </FouButton>
    </div>
  </FouDialog>

  <FouDialog v-model="taskPickerOpen" title="选择任务" width="440px" append-to-body :z-index="21000">
    <div class="pick-list">
      <FouButton
        v-for="o in TASK_OPTIONS"
        :key="o.value"
        class="pick-item"
        :icon="o.icon"
        native-type="button"
        :type="brainSlot === o.value ? 'primary' : 'default'"
        @click="pickTask(o.value)"
      >
        <span class="pick-item-text">
          <strong>{{ o.label }}</strong>
          <small>{{ o.desc }}</small>
        </span>
      </FouButton>
    </div>
  </FouDialog>

  <FouDialog v-model="roomPickerOpen" title="选择办公室" width="440px" append-to-body :z-index="21000">
    <div class="pick-list">
      <FouButton
        class="pick-item"
        icon="magic-line"
        native-type="button"
        :type="roomChoice === 'auto' ? 'primary' : 'default'"
        @click="pickRoom('auto')"
      >
        自动匹配角色办公室
      </FouButton>
      <FouButton
        v-for="r in roomStats"
        :key="r.roomId"
        class="pick-item"
        icon="building-line"
        native-type="button"
        :type="roomChoice === r.roomId ? 'primary' : 'default'"
        :disabled="r.total === 0"
        @click="pickRoom(r.roomId)"
      >
        <span class="pick-item-text">
          <strong>{{ r.name }}</strong>
          <small>共 {{ r.total }} 席 · 空 {{ r.free }}</small>
        </span>
      </FouButton>
    </div>
  </FouDialog>

  <FouDialog v-model="deskPickerOpen" title="选择工位" width="560px" append-to-body :z-index="21000">
    <div class="pick-list pick-list--scroll">
      <FouButton
        class="pick-item"
        icon="magic-line"
        native-type="button"
        :type="deskChoice === 'auto' ? 'primary' : 'default'"
        @click="pickDesk('auto')"
      >
        自动分配空位
      </FouButton>
      <FouButton
        class="pick-item"
        icon="forbid-line"
        native-type="button"
        :type="deskChoice === 'none' ? 'primary' : 'default'"
        @click="pickDesk('none')"
      >
        暂不分配
      </FouButton>
      <FouButton
        v-for="s in deskOptions"
        :key="s.value"
        class="pick-item"
        icon="computer-line"
        native-type="button"
        :type="deskChoice === s.value ? 'primary' : 'default'"
        :disabled="s.disabled"
        @click="pickDesk(s.value)"
      >
        {{ s.label }}
      </FouButton>
    </div>
  </FouDialog>

  <FouDialog v-model="genderPickerOpen" title="选择性别" width="440px" append-to-body :z-index="21000">
    <div class="pick-list">
      <FouButton
        v-for="o in GENDER_OPTIONS"
        :key="o.value"
        class="pick-item"
        :icon="o.icon"
        native-type="button"
        :type="gender === o.value ? 'primary' : 'default'"
        @click="pickGender(o.value)"
      >
        {{ o.label }}
      </FouButton>
    </div>
  </FouDialog>

  <FouDialog
    v-model="characterPickerOpen"
    title="选择人物形象"
    width="560px"
    append-to-body
    :z-index="21000"
  >
    <div class="char-picker">
      <EmployeeLookPreview
        :avatar-id="avatarId"
        :gender="gender"
        :outfit="outfit"
        :hair-style="hairStyle"
      />
      <div class="char-picker-cols">
        <p class="emp-hint">形象色系</p>
        <div class="avatar-grid">
          <FouButton
            v-for="a in AVATAR_STYLES"
            :key="a.id"
            class="avatar-pick"
            icon="palette-line"
            size="small"
            native-type="button"
            :type="avatarId === a.id ? 'primary' : 'default'"
            @click="pickAvatar(a.id)"
          >
            <span class="avatar-swatch" :style="{ background: a.shirt }" />
            {{ a.name }}
          </FouButton>
        </div>
        <p class="emp-hint">服装</p>
        <div class="look-grid">
          <FouButton
            v-for="o in outfitOptions"
            :key="o.id"
            icon="t-shirt-line"
            size="small"
            native-type="button"
            :type="outfit === o.id ? 'primary' : 'default'"
            @click="outfit = o.id"
          >
            {{ o.name }}
          </FouButton>
        </div>
        <p class="emp-hint">发型</p>
        <div class="look-grid">
          <FouButton
            v-for="h in hairOptions"
            :key="h.id"
            icon="scissors-cut-line"
            size="small"
            native-type="button"
            :type="hairStyle === h.id ? 'primary' : 'default'"
            @click="hairStyle = h.id"
          >
            {{ h.name }}
          </FouButton>
        </div>
      </div>
    </div>
    <template #footer>
      <FouButton icon="check-line" type="primary" native-type="button" @click="characterPickerOpen = false">
        完成
      </FouButton>
    </template>
  </FouDialog>

  <FouDialog v-model="agencyPickerOpen" title="选择招聘岗位" width="640px" append-to-body :z-index="21000">
    <FouInput v-model="agencySearch" placeholder="搜索岗位名称…" style="margin-bottom: 10px" />
    <div class="agency-pick-layout">
      <aside class="agency-pick-tree">
        <AgencyDivisionTree v-model="agencyDivision" />
      </aside>
      <div class="pick-list pick-list--scroll">
        <FouButton
          v-for="r in agencyOptions.slice(0, 80)"
          :key="r.id"
          class="pick-item"
          icon="briefcase-4-line"
          native-type="button"
          :type="agentRoleId === r.id ? 'primary' : 'default'"
          @click="pickAgency(r.id)"
        >
          <span class="pick-item-text">
            <strong>{{ r.emoji }} {{ r.nameZh || r.name }}</strong>
            <small>{{ r.description }}</small>
          </span>
        </FouButton>
        <p v-if="agencyOptions.length === 0" class="emp-hint">无匹配岗位</p>
      </div>
    </div>
  </FouDialog>

  <FouDialog v-model="drivePickerOpen" title="选择驾驶偏好" width="440px" append-to-body :z-index="21000">
    <div class="pick-list">
      <FouButton
        v-for="o in DRIVE_OPTIONS"
        :key="o.value"
        class="pick-item"
        :icon="o.icon"
        native-type="button"
        :type="driveMode === o.value ? 'primary' : 'default'"
        @click="pickDrive(o.value)"
      >
        <span class="pick-item-text">
          <strong>{{ o.label }}</strong>
          <small>{{ o.desc }}</small>
        </span>
      </FouButton>
    </div>
  </FouDialog>
</template>

<style scoped>
.emp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin-bottom: 8px;
}
.emp-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
  margin: 0;
  min-width: 0;
}
.emp-label {
  flex: 0 0 4.5em;
  text-align: right;
  line-height: 1.2;
  color: var(--muted);
  white-space: nowrap;
}
.emp-field > :not(.emp-label) {
  flex: 1;
  min-width: 0;
}
.emp-pick-trigger {
  justify-content: flex-start;
  width: 100%;
}
.emp-check {
  align-items: center;
}
.emp-model-combo {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  background: var(--canvas);
  color: var(--body);
  font-size: 13px;
}
.emp-model-combo:focus {
  outline: none;
  border-color: var(--primary);
}
.emp-hint {
  font-size: 11px;
  color: var(--muted);
}
.emp-remote-preset-select {
  width: 100%;
  max-width: 100%;
}
.emp-api-summary {
  align-items: flex-start;
}
.emp-api-summary .emp-hint {
  grid-column: 2;
  margin: 0;
  line-height: 1.45;
}
.emp-error {
  color: #b42318;
  font-size: 12px;
  margin: 4px 0 0;
}
.emp-path-row {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  flex: 1;
}
.emp-path-row :deep(.fou-input) {
  flex: 1;
  min-width: 0;
}
.look-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}
.look-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.look-pickers {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pick-list--scroll {
  max-height: min(52vh, 420px);
  overflow: auto;
  padding-right: 4px;
}
.pick-item {
  width: 100%;
  justify-content: flex-start;
  height: auto;
  min-height: 48px;
  padding: 10px 12px;
}
.pick-item-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
}
.pick-item-text strong {
  font-size: 13px;
  font-weight: 600;
}
.pick-item-text small {
  font-size: 11px;
  opacity: 0.75;
  font-weight: 400;
}
.char-picker {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.char-picker-cols {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.avatar-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.avatar-pick {
  justify-content: flex-start;
}
.avatar-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  margin-right: 4px;
  vertical-align: middle;
}
</style>

<style>
.agency-pick-layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 10px;
  min-height: 280px;
  max-height: min(52vh, 420px);
}
.agency-pick-tree {
  border: 1px solid var(--hairline, #2a3540);
  border-radius: 10px;
  padding: 6px;
  overflow: auto;
  min-height: 0;
}

/* Instance-scoped dialog polish only — do not use bare .fou-dialog globally */
:global(.fou-dialog.emp-main-dialog) {
  border: none;
  outline: none;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  background: var(--surface-card, #1c232b);
  max-height: min(88vh, 720px);
}
:global(.fou-dialog.emp-main-dialog .fou-dialog__header),
:global(.fou-dialog.emp-main-dialog .fou-dialog__footer) {
  border-color: var(--hairline, #2a3540);
  background: transparent;
}
:global(.fou-dialog.emp-main-dialog .fou-dialog__body) {
  overflow: auto;
  max-height: min(68vh, 560px);
  padding-top: 8px;
  padding-bottom: 8px;
}
</style>
