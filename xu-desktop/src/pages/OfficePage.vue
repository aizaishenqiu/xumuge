<script setup lang="ts">
/**
 * @file OfficePage.vue 办公室：3D 大厅 + 设计模式锁员工/家具摆放
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-28
 * @updated 2026-09-01
 * @version 2.1.0
 * @category Layout
 * @algo none
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { FouButton, fouAlert } from "foucui";
import AddEmployeeDialog from "../components/AddEmployeeDialog.vue";
import BatchHireDialog from "../components/BatchHireDialog.vue";
import AssignTaskDialog from "../components/AssignTaskDialog.vue";
import VirmoorOfficeHall from "../components/VirmoorOfficeHall.vue";
import OfficeChatFloatLauncher from "../components/OfficeChatFloatLauncher.vue";
import OfficeChatFloating from "../components/OfficeChatFloating.vue";
import OfficeHallDisplayDialog from "../components/OfficeHallDisplayDialog.vue";
import OfficeHallLayoutDialog from "../components/OfficeHallLayoutDialog.vue";
import OfficeDeskDecorDialog from "../components/OfficeDeskDecorDialog.vue";
import OfficeDesignStudioDialog from "../components/OfficeDesignStudioDialog.vue";
import OfficeActivityDrawer from "../components/office/OfficeActivityDrawer.vue";
import OfficeTokenBar from "../components/office/OfficeTokenBar.vue";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import {
  loadEmployees,
  readEmployees,
  saveEmployeesBatch,
  type Employee,
} from "../utils/employees";
import { useNavCollapse } from "../composables/useNavCollapse";
import {
  ensureEmployeeLiveBridge,
  getLivePatch,
  mapEventState,
  type EmployeeLiveEvent,
} from "../employee/events";
import { loadProjectTheme, type ProjectTheme } from "../utils/projectTheme";
import { OFFICE_DESK_DEFAULT, readDeskCount, writeDeskCount } from "../utils/officeSettings";
import { canUseInputDrive, readDriveSettings } from "../utils/driveSettings";
import {
  readOfficeDesignMode,
  writeOfficeDesignMode,
} from "../utils/officeDesignMode";
import {
  DEFAULT_OFFICE_HALL_LAYOUT,
  writeOfficeHallLayout,
} from "../utils/officeHallLayout";
import { requireCapability } from "../utils/auth";
import { attachImageToChat, captureScreenToDataUrl } from "../utils/screenshot";
import { runReviewerConfirmAssist } from "../utils/reviewerAssist";
import {
  loadProjects,
  WORKFLOW_STATE_LABEL,
  workflowBlockReason,
  type XuProject,
} from "../utils/projects";
import { checkReleaseGate } from "../utils/releaseGate";
import {
  assessOfficeCapacity,
  officeCapacityBannerText,
} from "../utils/officeCapacityHints";
import {
  expandDesksToRoster,
  readAutoSyncDesk,
  staffingRecommendText,
  syncOfficeToProjectTeam,
  zoneModeForProject,
} from "../utils/officeStaffingSync";
import { toUserError } from "../utils/userFacingError";
import {
  bindWindowFullscreenExit,
  enterWindowFullscreen,
  exitWindowFullscreen,
} from "../utils/officeWindowFullscreen";

// ensure collapse class applied when opening office
const { setCollapsed } = useNavCollapse();

const IMMERSIVE_KEY = "xu.office.immersive";
const officeImmersive = ref(false);
let unbindFullscreenExit: (() => void) | null = null;
let immersiveSyncing = false;

const officeTheme = ref<ProjectTheme | null>(null);
const activeXuProject = ref<XuProject | null>(null);
const releaseChecking = ref(false);

const capacityBanner = computed(() =>
  officeCapacityBannerText(
    assessOfficeCapacity({
      rosterCount: employees.value.length,
      deskCount: deskCount.value,
      viewMode: "3d",
    }),
  ),
);

const workflowBar = computed(() => {
  const p = activeXuProject.value;
  if (!p || p.type !== "software" || !p.workflow) return null;
  const state = p.workflow.state;
  const label = WORKFLOW_STATE_LABEL[state] || state;
  const hint = workflowBlockReason(p.workflow);
  return { label, hint, state };
});

async function refreshOfficeProject() {
  try {
    officeTheme.value = await loadProjectTheme();
  } catch {
    officeTheme.value = null;
  }
  try {
    const list = await loadProjects();
    const tid = officeTheme.value?.id;
    activeXuProject.value = tid ? list.find((x) => x.id === tid) ?? null : null;
  } catch {
    activeXuProject.value = null;
  }
  maybeOfferStaffingSync();
}

async function onReleaseGateClick() {
  const p = activeXuProject.value;
  if (!p) {
    void fouAlert("请先绑定软件项目。", "结项检查");
    return;
  }
  releaseChecking.value = true;
  try {
    const gate = await checkReleaseGate(p);
    void fouAlert(gate.message, gate.ok ? "可以结项" : "暂不可结项");
  } catch (e) {
    void fouAlert(toUserError(e).slice(0, 200), "结项检查失败");
  } finally {
    releaseChecking.value = false;
  }
}

const router = useRouter();
const deskCount = ref(readDeskCount());
const employees = ref<Employee[]>(readEmployees());
const showAdd = ref(false);
const showBatchHire = ref(false);
const showDesignStudio = ref(false);
const editingEmployee = ref<Employee | null>(null);
const designMode = ref(readOfficeDesignMode());

function requireDesignMode(action: string): boolean {
  if (designMode.value) return true;
  void fouAlert(
    `日常模式下不可${action}。请先在「办公室设置」打开「设计办公室」。`,
    "设计模式",
  );
  return false;
}

function openAddDialog() {
  if (!requireDesignMode("添加或修改员工档案")) return;
  editingEmployee.value = null;
  showAdd.value = true;
}

function closeAddDialog() {
  showAdd.value = false;
  editingEmployee.value = null;
}

function onEditEmployee(emp: Employee | string) {
  if (!requireDesignMode("修改员工档案")) return;
  const id = typeof emp === "string" ? emp : emp.id;
  const found = employees.value.find((e) => e.id === id);
  if (!found) return;
  editingEmployee.value = found;
  showAdd.value = true;
}

function setDesignMode(on: boolean) {
  designMode.value = on;
  writeOfficeDesignMode(on);
}

function toggleDesignMode() {
  const next = !designMode.value;
  setDesignMode(next);
  showOfficeMenu.value = false;
  void fouAlert(
    next
      ? "已进入设计办公室：可摆放家具、调整工位分区/装扮/品牌，并可编辑员工档案。退出后恢复锁定。"
      : "已退出设计模式：员工档案与布局装扮已锁定，仅可查看大厅与派活。",
    next ? "设计办公室" : "日常模式",
  );
}

function openHallLayout() {
  if (!designMode.value) {
    void fouAlert("请先打开「设计办公室」，再调整工位与分区。", "设计模式");
    return;
  }
  showHallLayout.value = true;
}

function openDeskDecor(deskIndex = 0) {
  if (!designMode.value) {
    void fouAlert("请先打开「设计办公室」，再装扮工位。", "设计模式");
    return;
  }
  decorDeskIndex.value = deskIndex;
  showDeskDecor.value = true;
}

function openHallDisplay() {
  if (!designMode.value) {
    void fouAlert("请先打开「设计办公室」，再改大厅品牌/屏风。", "设计模式");
    return;
  }
  showHallDisplay.value = true;
}

function restoreFactoryHallDefaults() {
  if (!designMode.value) {
    void fouAlert("请先打开「设计办公室」，再恢复出厂默认布局。", "设计模式");
    return;
  }
  writeDeskCount(OFFICE_DESK_DEFAULT);
  writeOfficeHallLayout({
    ...DEFAULT_OFFICE_HALL_LAYOUT,
    deskCount: OFFICE_DESK_DEFAULT,
  });
  deskCount.value = OFFICE_DESK_DEFAULT;
  showOfficeMenu.value = false;
  void fouAlert(
    `已恢复出厂默认：标准大厅 · ${OFFICE_DESK_DEFAULT} 工位。可继续在设计模式下微调。`,
    "默认布局",
  );
}

function openDesignStudio() {
  if (!requireDesignMode("摆放家具")) return;
  showOfficeMenu.value = false;
  showDesignStudio.value = true;
}

function openBatchHire() {
  if (!requireDesignMode("批量入职")) return;
  showBatchHire.value = true;
}

function closeBatchHire() {
  showBatchHire.value = false;
}
const assigning = ref<Employee | null>(null);
const driveReady = ref(canUseInputDrive());
const capturing = ref(false);
const reviewing = ref(false);
const showOfficeMenu = ref(false);
const showHallDisplay = ref(false);
const showHallLayout = ref(false);
const showDeskDecor = ref(false);
const decorDeskIndex = ref(0);
const staffingRecommend = ref<string | null>(null);
const staffingSyncing = ref(false);
const expandingDesks = ref(false);
const chatFloatingRef = ref<InstanceType<typeof OfficeChatFloating> | null>(null);

function openSwitchProject() {
  chatFloatingRef.value?.openSwitchProject();
}

function openOfficeMenu() {
  showOfficeMenu.value = true;
}

function runOfficeAction(fn: () => void | Promise<unknown>) {
  showOfficeMenu.value = false;
  void Promise.resolve(fn());
}

const PANEL_MODE_KEY = "xu.officeChatPanelMode";
type ChatPanelMode = "normal" | "maximized" | "minimized";
const chatPanelMode = ref<ChatPanelMode>("normal");
const stageRef = ref<HTMLElement | null>(null);

function loadChatPanelPrefs() {
  try {
    const mode = localStorage.getItem(PANEL_MODE_KEY);
    if (mode === "maximized" || mode === "minimized" || mode === "normal") {
      chatPanelMode.value = mode;
    }
  } catch {
    /* ignore */
  }
}

function persistChatPanelMode(mode: ChatPanelMode) {
  chatPanelMode.value = mode;
  try {
    localStorage.setItem(PANEL_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function onChatPanelAction(action: "minimize" | "maximize" | "restore") {
  if (action === "minimize") persistChatPanelMode("minimized");
  else if (action === "maximize") persistChatPanelMode("maximized");
  else persistChatPanelMode("normal");
}

function loadImmersivePref() {
  try {
    officeImmersive.value = localStorage.getItem(IMMERSIVE_KEY) === "1";
    if (officeImmersive.value) {
      setCollapsed(true);
      void applyWindowFullscreen(true);
    }
  } catch {
    officeImmersive.value = false;
  }
}

/** 同步沉浸 UI 与系统全屏（隐藏任务栏） */
async function applyWindowFullscreen(on: boolean) {
  if (immersiveSyncing) return;
  immersiveSyncing = true;
  try {
    if (on) {
      await enterWindowFullscreen();
      if (!unbindFullscreenExit) {
        unbindFullscreenExit = bindWindowFullscreenExit(() => {
          if (!officeImmersive.value) return;
          void setOfficeImmersive(false, { skipWindow: true });
        });
      }
    } else {
      unbindFullscreenExit?.();
      unbindFullscreenExit = null;
      await exitWindowFullscreen();
    }
  } catch (e) {
    console.warn("[xu] office fullscreen", e);
  } finally {
    immersiveSyncing = false;
  }
}

function setOfficeImmersive(on: boolean, opts?: { skipWindow?: boolean }) {
  officeImmersive.value = on;
  try {
    if (on) localStorage.setItem(IMMERSIVE_KEY, "1");
    else localStorage.removeItem(IMMERSIVE_KEY);
  } catch {
    /* ignore */
  }
  try {
    if (on) setCollapsed(true);
    document.documentElement.classList.toggle("office-immersive", on);
  } catch {
    document.documentElement.classList.remove("office-immersive");
  }
  if (!opts?.skipWindow) void applyWindowFullscreen(on);
}

function toggleImmersive() {
  void setOfficeImmersive(!officeImmersive.value);
}

function onImmersiveKey(e: KeyboardEvent) {
  if (e.key === "Escape" && officeImmersive.value) {
    e.preventDefault();
    e.stopPropagation();
    void setOfficeImmersive(false);
  }
}

const showDeskExpandCta = computed(
  () => employees.value.length > deskCount.value && deskCount.value < 16,
);

async function onExpandDesksClick() {
  if (expandingDesks.value) return;
  expandingDesks.value = true;
  try {
    deskCount.value = await expandDesksToRoster(employees.value.length);
    await refresh();
  } finally {
    expandingDesks.value = false;
  }
}

async function applyStaffingRecommend() {
  const p = activeXuProject.value;
  if (!p?.employeeIds?.length || staffingSyncing.value) return;
  staffingSyncing.value = true;
  try {
    const result = await syncOfficeToProjectTeam({
      employeeIds: p.employeeIds,
      project: p,
      autoAssignDesks: true,
    });
    deskCount.value = result.deskCount;
    staffingRecommend.value = null;
    await refresh();
  } finally {
    staffingSyncing.value = false;
  }
}

function dismissStaffingRecommend() {
  staffingRecommend.value = null;
}

function maybeOfferStaffingSync() {
  const p = activeXuProject.value;
  if (!p?.employeeIds?.length || !readAutoSyncDesk()) return;
  const size = p.employeeIds.length;
  if (size <= deskCount.value) return;
  staffingRecommend.value = staffingRecommendText(size, zoneModeForProject(p));
}

const seated = computed(() => employees.value.filter((e) => e.deskIndex != null).length);
const seatDenom = computed(() => deskCount.value || seated.value);

async function refresh() {
  deskCount.value = readDeskCount();
  try {
    employees.value = await loadEmployees();
  } catch {
    employees.value = readEmployees();
  }
  driveReady.value = canUseInputDrive();
  await clearStaleWorkingFlags();
  await refreshOfficeProject();
}

/** 崩溃/假成功后花名册仍卡在 working：无新鲜 live 则改回休息（批量写库） */
async function clearStaleWorkingFlags() {
  const now = Date.now();
  const changed: Employee[] = [];
  const next = employees.value.map((e) => {
    if (e.status !== "working" && e.status !== "meeting") return e;
    const live = getLivePatch(e.id);
    const liveBusy =
      live &&
      (live.state === "working" ||
        live.state === "running" ||
        live.state === "meeting" ||
        live.state === "need_confirm") &&
      now - live.at < 180_000;
    if (liveBusy) return e;
    const idle = { ...e, status: "idle" as const };
    changed.push(idle);
    return idle;
  });
  if (!changed.length) return;
  employees.value = next;
  try {
    await saveEmployeesBatch(changed);
  } catch {
    /* ignore */
  }
}

let settingsTimer: number | null = null;

function onSettings() {
  if (settingsTimer != null) window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => {
    settingsTimer = null;
    void refresh();
  }, 450);
}

/** Push status to 3D/2D dots — throttled to avoid 31× event storm */
const livePatchAt = new Map<string, number>();
function onEmployeeLive(e: Event) {
  const ev = (e as CustomEvent<EmployeeLiveEvent>).detail;
  if (!ev?.employeeId) return;
  const st = mapEventState(ev.state);
  if (!st) return;
  const now = Date.now();
  const prev = livePatchAt.get(ev.employeeId) ?? 0;
  if (now - prev < 350) return;
  livePatchAt.set(ev.employeeId, now);
  const i = employees.value.findIndex((x) => x.id === ev.employeeId);
  if (i < 0 || employees.value[i].status === st) return;
  // 原地改 status，避免换数组触发 3D 全员重建
  employees.value[i].status = st;
}

function openAssignFirst() {
  void requireCapability("dispatch")
    .then(() => {
      const withRoot = employees.value.find((e) => e.workspaceRoot);
      if (withRoot) {
        assigning.value = withRoot;
        return;
      }
      if (employees.value[0]) {
        assigning.value = employees.value[0];
        return;
      }
      window.alert("还没有员工，请先点「添加员工」完成花名册与工作区设置。");
    })
    .catch((e) => window.alert(toUserError(e)));
}

async function captureAndChat() {
  if (capturing.value) return;
  capturing.value = true;
  try {
    const shot = await captureScreenToDataUrl("monitor");
    attachImageToChat(shot.dataUrl, shot.filename);
    await router.push("/home");
  } catch (e) {
    window.alert(toUserError(e));
  } finally {
    capturing.value = false;
  }
}

async function assistConfirm() {
  if (reviewing.value) return;
  reviewing.value = true;
  try {
    const result = await runReviewerConfirmAssist();
    if (result.phase === "error") {
      window.alert(result.message);
      return;
    }
    await router.push("/home");
  } finally {
    reviewing.value = false;
  }
}

async function onEmployeeSaved() {
  closeAddDialog();
  await refresh();
}

async function onBatchHireDone() {
  closeBatchHire();
  deskCount.value = readDeskCount();
  await refresh();
}

onMounted(() => {
  showAdd.value = false;
  showBatchHire.value = false;
  assigning.value = null;
  loadChatPanelPrefs();
  loadImmersivePref();
  document.body.style.overflow = "";
  document.querySelectorAll(".emp-modal-mask").forEach((el) => el.remove());

  void (async () => {
    await refresh();
    try {
      const { ensureFeishuWs } = await import("../utils/channelConnections");
      await ensureFeishuWs();
    } catch (e) {
      console.warn("[xu] feishu-ws ensure", e);
    }
  })();
  window.addEventListener("xu-office-settings", onSettings);
  window.addEventListener("xu-employees-changed", onSettings);
  window.addEventListener("xu-employee-live", onEmployeeLive);
  window.addEventListener("xu-drive-settings", onSettings);
  window.addEventListener("xu-office-display", onSettings);
  window.addEventListener("xu-office-layout", onSettings);
  window.addEventListener("storage", onSettings);
  window.addEventListener("xu-open-office-menu", openOfficeMenu);
  window.addEventListener("xu-project-changed", onSettings);
  window.addEventListener("xu-projects-changed", onSettings);
  window.addEventListener("keydown", onImmersiveKey);
  void ensureEmployeeLiveBridge();
});

onUnmounted(() => {
  if (settingsTimer != null) window.clearTimeout(settingsTimer);
  window.removeEventListener("keydown", onImmersiveKey);
  officeImmersive.value = false;
  try {
    localStorage.removeItem(IMMERSIVE_KEY);
  } catch {
    /* ignore */
  }
  document.documentElement.classList.remove("office-immersive");
  unbindFullscreenExit?.();
  unbindFullscreenExit = null;
  void exitWindowFullscreen();
  window.removeEventListener("xu-office-settings", onSettings);
  window.removeEventListener("xu-employees-changed", onSettings);
  window.removeEventListener("xu-employee-live", onEmployeeLive);
  window.removeEventListener("xu-drive-settings", onSettings);
  window.removeEventListener("xu-office-display", onSettings);
  window.removeEventListener("xu-office-layout", onSettings);
  window.removeEventListener("storage", onSettings);
  window.removeEventListener("xu-open-office-menu", openOfficeMenu);
  window.removeEventListener("xu-project-changed", onSettings);
  window.removeEventListener("xu-projects-changed", onSettings);
});
</script>

<template>
  <div class="vue-page office-page" :class="{ 'is-immersive': officeImmersive }">
    <header v-show="!officeImmersive" class="vue-page-header">
      <div>
        <h1 class="ui-font">办公室</h1>
        <p class="ui-font muted">
          3D 大厅 · 工位 {{ deskCount }} · 在岗 {{ seated }}/{{ seatDenom }}
          <span class="muted">（花名册 {{ employees.length }} 人）</span>
        </p>
      </div>
      <div class="vue-page-actions">
        <FouButton
          icon="fullscreen-line"
          native-type="button"
          title="沉浸模式（全屏，隐藏任务栏）"
          @click="toggleImmersive"
        >
          沉浸模式
        </FouButton>
        <PageHelpButton topic="office.overview" label="帮助" />
      </div>
    </header>

    <FouDialog
      v-model="showOfficeMenu"
      title="办公室设置"
      width="420px"
      append-to-body
      destroy-on-close
    >
      <div class="office-menu-grid">
        <FouButton
          :icon="designMode ? 'lock-unlock-line' : 'tools-line'"
          :type="designMode ? 'primary' : 'default'"
          native-type="button"
          @click="toggleDesignMode"
        >
          {{ designMode ? "退出设计模式" : "设计办公室" }}
        </FouButton>
        <FouButton
          icon="building-line"
          native-type="button"
          :disabled="!designMode"
          @click="runOfficeAction(() => openDesignStudio())"
        >
          摆放家具
        </FouButton>
        <FouButton
          icon="history-line"
          native-type="button"
          :disabled="!designMode"
          @click="runOfficeAction(() => restoreFactoryHallDefaults())"
        >
          恢复出厂默认布局
        </FouButton>
        <FouButton
          icon="layout-grid-line"
          native-type="button"
          :disabled="!designMode"
          @click="runOfficeAction(() => openHallLayout())"
        >
          工位与分区
        </FouButton>
        <FouButton
          icon="palette-line"
          native-type="button"
          :disabled="!designMode"
          @click="runOfficeAction(() => openDeskDecor(0))"
        >
          工位装扮
        </FouButton>
        <FouButton
          icon="image-edit-line"
          native-type="button"
          :disabled="!designMode"
          @click="runOfficeAction(() => openHallDisplay())"
        >
          大厅品牌/屏风
        </FouButton>
        <FouButton
          icon="dashboard-line"
          native-type="button"
          @click="runOfficeAction(() => router.push('/monitor'))"
        >
          工作监控
        </FouButton>
        <FouButton
          icon="contacts-book-2-line"
          native-type="button"
          @click="runOfficeAction(() => router.push('/contacts'))"
        >
          员工往来
        </FouButton>
        <FouButton
          icon="share-forward-line"
          native-type="button"
          @click="runOfficeAction(() => router.push('/connections'))"
        >
          多端连接
        </FouButton>
        <FouButton
          icon="settings-3-line"
          native-type="button"
          @click="runOfficeAction(() => router.push('/settings'))"
        >
          工位/驾驶设置
        </FouButton>
        <FouButton
          icon="checkbox-circle-line"
          native-type="button"
          :disabled="reviewing"
          @click="runOfficeAction(() => assistConfirm())"
        >
          {{ reviewing ? "代确认中…" : "代点确认" }}
        </FouButton>
        <FouButton
          icon="camera-line"
          native-type="button"
          :disabled="capturing"
          @click="runOfficeAction(() => captureAndChat())"
        >
          {{ capturing ? "截屏中…" : "截屏去对话" }}
        </FouButton>
        <FouButton
          icon="arrow-left-right-line"
          native-type="button"
          @click="runOfficeAction(() => openSwitchProject())"
        >
          切换项目
        </FouButton>
        <FouButton
          icon="send-plane-line"
          native-type="button"
          @click="runOfficeAction(() => openAssignFirst())"
        >
          派活
        </FouButton>
        <FouButton
          icon="user-add-line"
          native-type="button"
          @click="runOfficeAction(() => openAddDialog())"
        >
          添加员工
        </FouButton>
        <FouButton
          icon="group-line"
          native-type="button"
          @click="runOfficeAction(() => openBatchHire())"
        >
          批量入职
        </FouButton>
      </div>
    </FouDialog>

    <p v-if="!driveReady && !officeImmersive" class="office-drive-warn ui-font">
      键鼠控 IDE 未启用：请到设置勾选同意并开启「键鼠驾驶」组合能力。
    </p>

    <div v-if="capacityBanner && !officeImmersive" class="office-capacity-warn ui-font">
      <span>{{ capacityBanner }}</span>
      <FouButton
        v-if="showDeskExpandCta"
        icon="add-line"
        size="small"
        native-type="button"
        :loading="expandingDesks"
        @click="onExpandDesksClick"
      >
        一键补齐工位
      </FouButton>
    </div>

    <div v-if="staffingRecommend && !officeImmersive" class="office-staffing-bar ui-font">
      <span>{{ staffingRecommend }}</span>
      <FouButton
        icon="check-line"
        size="small"
        type="primary"
        native-type="button"
        :loading="staffingSyncing"
        @click="applyStaffingRecommend"
      >
        应用
      </FouButton>
      <FouButton
        icon="close-line"
        size="small"
        native-type="button"
        @click="dismissStaffingRecommend"
      >
        忽略
      </FouButton>
    </div>

    <div v-if="workflowBar && !officeImmersive" class="office-workflow-bar ui-font">
      <span class="owf-label">流程：{{ workflowBar.label }}</span>
      <span v-if="workflowBar.hint" class="owf-hint">{{ workflowBar.hint }}</span>
      <FouButton
        icon="shield-check-line"
        size="small"
        native-type="button"
        :disabled="releaseChecking"
        @click="onReleaseGateClick"
      >
        {{ releaseChecking ? "检查中…" : "结项检查" }}
      </FouButton>
    </div>

    <div ref="stageRef" class="office-stage" :class="{ 'is-immersive': officeImmersive }">
      <div class="office-viewport office-viewport--full">
        <VirmoorOfficeHall
          embed
          :employees="employees"
          :desk-count="deskCount"
          @edit-employee="onEditEmployee"
          @decorate-desk="openDeskDecor"
        />
        <p v-if="!officeImmersive" class="office-hint ui-font">
          {{
            designMode
              ? "设计模式 · 拖拽旋转 · 滚轮缩放 · 点击员工可编辑 · 点击空桌装扮 · 菜单可摆放家具"
              : "日常模式 · 拖拽旋转 · 滚轮缩放 · 员工档案已锁定（办公室设置 → 设计办公室）"
          }}
        </p>
        <div v-if="officeImmersive" class="office-immersive-hud ui-font">
          <span>工位 {{ deskCount }} · 在岗 {{ seated }}/{{ seatDenom }}</span>
          <FouButton
            icon="fullscreen-exit-line"
            size="small"
            text
            native-type="button"
            title="退出沉浸全屏（Esc）"
            @click="setOfficeImmersive(false)"
          />
        </div>
      </div>
      <OfficeChatFloating
        v-if="chatPanelMode !== 'minimized'"
        ref="chatFloatingRef"
        :employees="employees"
        :panel-mode="chatPanelMode"
        :stage-el="stageRef"
        :immersive="officeImmersive"
        @panel-action="onChatPanelAction"
      />
      <OfficeChatFloatLauncher
        v-if="chatPanelMode === 'minimized'"
        @open="() => persistChatPanelMode('normal')"
      />
    </div>

    <OfficeTokenBar v-if="!officeImmersive" class="office-token-dock" />

    <OfficeHallDisplayDialog v-model:open="showHallDisplay" />
    <OfficeHallLayoutDialog v-model:open="showHallLayout" />
    <OfficeDeskDecorDialog
      v-model:open="showDeskDecor"
      :desk-index="decorDeskIndex"
      :employees="employees"
    />
    <OfficeDesignStudioDialog v-model:open="showDesignStudio" :employees="employees" />

    <OfficeActivityDrawer
      :employees="employees"
      :project-id="activeXuProject?.id"
    />

    <AddEmployeeDialog
      :is-open="showAdd"
      :employee="editingEmployee"
      @close="closeAddDialog"
      @saved="onEmployeeSaved"
      @batch="openBatchHire"
    />
    <BatchHireDialog :is-open="showBatchHire" @close="closeBatchHire" @done="onBatchHireDone" />
    <AssignTaskDialog :open="Boolean(assigning)" :employee="assigning" @close="assigning = null" />
  </div>
</template>

<style scoped>
.office-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px 14px 10px;
  overflow: hidden;
  background: var(--canvas);
}
.vue-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  position: relative;
  z-index: 5;
}
.vue-page-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
}
.vue-page-header p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.vue-page-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  position: relative;
  z-index: 6;
  pointer-events: auto;
}
.office-menu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 4px 0 8px;
}
.office-menu-grid :deep(.fou-button) {
  width: 100%;
  justify-content: flex-start;
}
.office-drive-warn {
  margin: 0;
  font-size: 12px;
  color: #b45309;
  background: rgba(180, 83, 9, 0.08);
  border: 1px solid rgba(180, 83, 9, 0.25);
  border-radius: 8px;
  padding: 6px 10px;
  flex-shrink: 0;
}
.office-page.is-immersive {
  padding: 0;
  gap: 0;
}
.office-capacity-warn {
  margin: 0;
  font-size: 12px;
  color: #1d4ed8;
  background: rgba(37, 99, 235, 0.06);
  border: 1px solid rgba(37, 99, 235, 0.2);
  border-radius: 8px;
  padding: 6px 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.office-staffing-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(15, 118, 110, 0.25);
  background: rgba(15, 118, 110, 0.06);
  flex-shrink: 0;
  font-size: 13px;
}
.office-stage.is-immersive {
  position: fixed;
  inset: 0;
  z-index: 200;
  border-radius: 0;
  border: none;
  width: 100vw;
  height: 100vh;
  background: #07080c;
}
.office-page.is-immersive .office-viewport--full :deep(.hero3d.is-embed) {
  border-radius: 0 !important;
  border: none !important;
}
.office-immersive-hud {
  position: absolute;
  left: 12px;
  top: 10px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 12px;
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.62);
  color: rgba(240, 244, 248, 0.9);
  font-size: 12px;
}
.office-workflow-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--fou-border-color, #e2e8f0);
  background: var(--fou-fill-color-light, #f8fafc);
  flex-shrink: 0;
  font-size: 13px;
}
.owf-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.owf-hint {
  flex: 1;
  min-width: 120px;
  opacity: 0.85;
}
.office-token-dock {
  margin: 8px 12px 10px;
}
.office-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  border-radius: 12px;
}
.office-viewport {
  position: absolute;
  inset: 0;
  min-height: 0;
  min-width: 0;
}
.office-viewport--full :deep(.hero3d) {
  width: 100%;
  height: 100%;
}
.office-hint {
  position: absolute;
  left: 12px;
  bottom: 10px;
  margin: 0;
  font-size: 11px;
  color: rgba(240, 244, 248, 0.72);
  background: rgba(8, 12, 18, 0.55);
  border-radius: 999px;
  padding: 3px 10px;
  pointer-events: none;
  z-index: 2;
}
</style>
