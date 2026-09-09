<script setup lang="ts">
/**
 * @file 桌面端设置中心与分组配置入口
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-08
 * @version 1.1.4
 * @category Layout
 * @algo grouped-settings-navigation
 */
import { onApiCatch, sanitizeUserMessage, toUserError, sanitizeUserDisplayText, formatPathForUser } from "../utils/userFacingError";
import { formatToolApprovalLabel } from "../utils/toolApprovalLabels";
import { computed, nextTick, onMounted, onUnmounted, ref, watch, defineAsyncComponent } from "vue";
import { useRoute, useRouter } from "vue-router";
import { FouButton, FouCheckbox, FouInput, fouAlert, fouMsg } from "foucui";
/** FouIcon 由 setupFoucui 全局注册；2.3.3 类型未导出，模板内直接使用 */
import ShortcutCaptureInput from "../components/ShortcutCaptureInput.vue";
import OfficeHallDisplayDialog from "../components/OfficeHallDisplayDialog.vue";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import {
  readOfficeHallDisplay,
  type OfficeHallDisplay,
} from "../utils/officeHallDisplay";
import {
  readMeetingFuseSettings,
  writeMeetingFuseSettings,
  type MeetingFuseSettings,
} from "../utils/meetingFuse";
import {
  readBossReplyWatchSettings,
  writeBossReplyWatchSettings,
  type BossReplyWatchSettings,
} from "../utils/bossReplyWatch";
import {
  clearWritingQuotaBossLock,
  readBossConfirmPolicy,
  readWritingQuotaBossLock,
  syncWritingPerModelQuotaToDb,
  writeBossConfirmPolicy,
  type BossConfirmPolicy,
} from "../utils/bossConfirmPolicy";
import {
  readOfficeTopology,
  writeOfficeTopology,
  type OfficeTopology,
} from "../utils/officeTopology";
import { clearStuckUiBlockers } from "../utils/clearStuckUiBlockers";
import { invoke } from "@tauri-apps/api/core";
import {
  activityLogToJsonl,
  filterActivityLog,
  listActivityLog,
  type ActivityLogEntry,
  type ActivityLogFilter,
} from "../utils/activityLog";
import { THEMES, useTheme, type Theme } from "../composables/useTheme";
import { TERMINAL_BGS, type TerminalBg } from "../composables/useTerminalBg";
import {
  FONT_SIZES,
  FONT_SIZE_LABELS,
  type FontSize,
} from "../composables/useFontSize";
import { readLs, writeLs } from "../utils/xuStorage";
import {
  OFFICE_DESK_DEFAULT,
  OFFICE_DESK_MAX,
  OFFICE_DESK_MIN,
  readDeskCount,
  writeDeskCount,
} from "../utils/officeSettings";
import { readAutoSyncDesk, writeAutoSyncDesk } from "../utils/officeStaffingSync";
import {
  NAME_TRUNCATE_OPTIONS,
  PRIMARY_FORMAT_OPTIONS,
  SECONDARY_LINE_OPTIONS,
  readOfficeDisplayPrefs,
  writeOfficeDisplayPrefs,
  type OfficeDisplayPrefs,
} from "../utils/officeDisplayPrefs";
import {
  readDriveSettings,
  writeDriveSettings,
  type DriveSettings,
} from "../utils/driveSettings";
import {
  CURSOR_API_KEY_ENV,
  probeCursorSdk,
  syncDriveUseSdkToDb,
  type CursorSdkProbe,
} from "../utils/cursorSdkBridge";
import { isApiKeyConfigured, setStoredApiKey } from "../utils/apiKeys";
import { readIdeCliOverride, writeIdeCliOverride, IDE_OPTIONS } from "../utils/ideCli";
import {
  readCodingSurfacePrefs,
  writeCodingSurfacePrefs,
  type CodingSurfacePrefs,
} from "../utils/codingSurfacePrefs";
import {
  emptyIdeProbe,
  firstInstalledIde,
  idePickerOptions,
  isIdeCliInstalled,
  probeInstalledIdes,
  probeSummary,
  type IdeProbeResult,
} from "../utils/ideProbe";
import {
  applyAutoEmployeeSlots,
  formatHostProbeTime,
  hostProfileToCapacity,
  loadConcurrencyConfig,
  loadHostProfile,
  saveConcurrencyConfig,
  type ConcurrencyConfig,
  type HostCapacity,
} from "../utils/concurrencySlots";
import {
  loadFeishuSyncLevel,
  saveFeishuSyncLevel,
  type FeishuSyncLevel,
} from "../utils/feishuSync";
import {
  armGuiInputMonitor,
  emergencyStopGui,
  readGuiConsentLocal,
  readGuiExperimentalLocal,
  resetGuiEmergencyStop,
  writeGuiConsent,
  writeGuiExperimental,
} from "../utils/guiConsent";
import {
  EXEC_POLICY_OPTIONS,
  installPlaywright,
  loadAgentPrefs,
  probePlaywrightStatus,
  saveAgentPrefs,
  undoAgentWorkspace,
  type AgentPrefs,
  type ExecPolicy,
  type PlaywrightStatus,
} from "../utils/agentPrefs";
import {
  defaultCodeExecPrefs,
  loadCodeExecPrefs,
  saveCodeExecPrefs,
  type CodeExecPrefs,
} from "../utils/codeExecPrefs";
import {
  defaultSoftwareAutopilotPrefs,
  loadSoftwareAutopilotPrefs,
  saveSoftwareAutopilotPrefs,
  type SoftwareAutopilotPrefs,
} from "../utils/softwareAutopilot";
import {
  SOFTWARE_AUTOPILOT_RISK_BANNER,
  SOFTWARE_AUTOPILOT_RISK_SECTIONS,
  SOFTWARE_AUTOPILOT_RISK_TITLE,
} from "../utils/softwareAutopilotHelpCopy";
import {
  getChatRetentionDays,
  getDefaultReviewerId,
  listOccupiedDeskIndices,
  loadEmployees,
  readEmployees,
  setChatRetentionDays,
  setDefaultReviewerId,
  unbindEmployeesFromDesks,
  type Employee,
} from "../utils/employees";
import { buildDefaultOfficeLayout, syncDeskCount } from "../office/defaultLayout";
import { buildThreeBayOfficeLayout, isThreeBayOffice } from "../office/threeBayLayout";
import type { OfficeLayout } from "../office/catalog";
import { saveOfficeLayout } from "../utils/officeLayout";
import {
  applyScreenshotShortcut,
  DEFAULT_SCREENSHOT_SHORTCUT,
  readScreenshotShortcut,
  syncScreenshotShortcutFromRust,
  type ShortcutSpec,
} from "../utils/shortcutSettings";
import {
  readScreenshotAutoAttachChat,
  writeScreenshotAutoAttachChat,
} from "../utils/screenshotPrefs";
import {
  formatSnapshotTime,
  getOfficeUserDefaultMeta,
  restoreOfficeUserDefault,
  saveOfficeUserDefault,
  type OfficeSnapshotMeta,
} from "../utils/officeSnapshot";
import {
  loadEmployeeWorkApiSource,
  saveEmployeeWorkApiSource,
  type GlobalEmployeeApiSource,
} from "../utils/opsBrains";
import { loadGlobalModelProfiles } from "../utils/globalModelProfiles";
import ModelProfileEditor from "../components/ModelProfileEditor.vue";
import OpsBrainsSettingsSection from "../components/settings/OpsBrainsSettingsSection.vue";
import SettingsBillingSection from "../components/settings/SettingsBillingSection.vue";
const VoiceSettingsSection = defineAsyncComponent(
  () => import("../components/settings/VoiceSettingsSection.vue"),
);
import {
  BRAND_NAME,
  COMPANY_NAME_MAX,
  DEFAULT_COMPANY_NAME,
  TRIAL_POLICY,
  readCompanyName,
  writeCompanyName,
} from "../utils/brandSettings";
import { loadAppIdentity, type AppIdentity } from "../utils/appIdentity";
import {
  checkAppUpdate,
  downloadAndInstallAppUpdate,
  type AppUpdateResult,
} from "../utils/appUpdateCheck";
import {
  DEFAULT_USER_ADDRESS,
  readUserAddressRaw,
  USER_ADDRESS_MAX,
  writeUserAddress,
} from "../utils/userAddressPrefs";
import { showCommerceUi } from "../utils/v1ProductSurface";
import {
  DRIVE_HELP_SECTIONS,
  DRIVE_HELP_TITLE,
  DRIVE_RISK_SECTIONS,
  DRIVE_RISK_TITLE,
} from "../utils/driveHelpCopy";
import {
  USER_AGREEMENT_TITLE,
  SOFTWARE_LICENSE_TITLE,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_VERSION,
  buildUserAgreementSections,
  buildSoftwareLicenseSections,
} from "../utils/legalAgreements";
import {
  setTokenPackage,
  tokenPackageStatus,
  type TokenPackageStatus,
} from "../employee/memory";
import {
  activateRolePack,
  checkRolePackUpdates,
  downloadRolePackFromUrl,
  getRolePackLicenseStatus,
  importRolePack,
  listRolePackInstalled,
  reloadRolePacks,
  ROLE_PACK_STORE_URL,
  type InstalledRolePack,
  type LicenseStatus,
} from "../office/rolePackApi";
import {
  fetchRolePackDownloadEntries,
  requireCloudLoginForRolePackDownload,
  resolveRolePackTicketUrl,
  type RolePackDownloadEntry,
} from "../utils/rolePackDownloadApi";
import {
  isCloudEnterpriseSession,
  restoreSession,
} from "../utils/auth";
import { getAccountServerUrl, getLocalBrainDefaultUrl } from "../utils/appEnv";
import {
  getEditionPrefs,
  listAllRolesForPicker,
  maybeRenewSessionKeys,
  resolveLicenseEndpoint,
  sessionLogin,
  sessionLogout,
  sessionRenew,
  setEditionPrefs,
  type EditionPrefs,
} from "../license/edition";
import type { RolePackMeta } from "../office/rolePackApi";
import { reloadAgencyCatalog } from "../office/agencyRoles";
import {
  loadCapabilityPackState,
  setCapabilityPackEnabled,
  type InstalledCapabilityPack,
} from "../capabilities";
import {
  clearSkillsDataDir,
  pickAndImportUserSkill,
  pickSkillsDataDir,
  readCustomSkillsDataDir,
  skillsDataRootLabel,
  openSkillsFolder,
} from "../skills/userSkillsDir";
import { detectEslintInfo } from "../utils/workspaceLint";
import {
  invalidateEntitlementCache,
  isTrainingOptIn,
  listCommercialPlugins,
  listLicenseEntitlements,
  setTrainingOptIn,
  openWorkflowStudio,
  openTrainingStudio,
  ensureBuiltinCommercePlugins,
  type XuCommercialPlugin,
} from "../commerce";
import { openSimpleTraining } from "../training/openSimpleTraining";
import {
  clearTrainingDataDir,
  pickTrainingDataDir,
  readCustomTrainingDataDir,
  trainingDataRootLabel,
} from "../training/trainingDirPrefs";
import { openTrainingDataFolder } from "../training/trainingTemplates";
import { openHelp } from "../composables/useHelp";
import { useUiLocale } from "../composables/useUiLocale";

const THEME_LABELS: Record<Theme, { name: string; description: string; icon: string }> = {
  xu: { name: "虚募阁清爽", description: "冷灰白底、青绿强调（品牌默认）", icon: "leaf-line" },
  mist: { name: "浅雾", description: "冷灰雾面、偏灰的天空蓝", icon: "cloud-line" },
  ink: { name: "墨夜", description: "深色画布、薄荷绿强调", icon: "moon-clear-line" },
  warm: { name: "暖色", description: "暖纸色底、琥珀橙强调", icon: "sun-line" },
  fresh: { name: "清爽", description: "白灰为主、中性强调", icon: "contrast-line" },
  sky: { name: "天蓝", description: "亮天蓝底、饱和天蓝强调（区别于浅雾）", icon: "cloudy-line" },
};

const TERMINAL_BG_LABELS: Record<TerminalBg, { name: string; description: string }> = {
  dark: { name: "暗夜", description: "经典深色，对比度最佳" },
  glass: { name: "毛玻璃", description: "半透明霜化效果" },
  ocean: { name: "深海", description: "蓝紫渐变星云感" },
  sunset: { name: "暮色", description: "深红紫幽暗渐变" },
  forest: { name: "暗林", description: "深邃祖母绿渐变" },
};

const FONT_SIZE_ROW_LABELS = {
  ui: "界面",
  terminal: "终端",
  fileTree: "文件管理器",
} as const;

const TERMINAL_BG_KEY = "xu.terminal.bg";
const TERMINAL_BG_KEY_LEGACY = "hermes-terminal-bg";

type SettingsGroupId =
  | "appearance"
  | "drive"
  | "models"
  | "billing"
  | "concurrency"
  | "agent"
  | "confirm"
  | "memory"
  | "mcp"
  | "security"
  | "role-packs"
  | "voice"
  | "shortcuts"
  | "plugins"
  | "legal"
  | "about"
  | "system";

const SETTINGS_GROUPS: Array<{ id: SettingsGroupId; label: string; icon: string }> = [
  { id: "appearance", label: "公司与外观", icon: "palette-line" },
  { id: "drive", label: "编码驾驶", icon: "code-box-line" },
  { id: "models", label: "模型", icon: "cpu-line" },
  { id: "billing", label: "账单", icon: "money-cny-box-line" },
  { id: "concurrency", label: "并发", icon: "stack-line" },
  { id: "agent", label: "Agent", icon: "robot-line" },
  { id: "confirm", label: "协作护栏", icon: "shield-star-line" },
  { id: "memory", label: "记忆", icon: "mind-map" },
  { id: "mcp", label: "MCP", icon: "plug-line" },
  { id: "role-packs", label: "岗位数据", icon: "team-line" },
  { id: "voice", label: "语音与朗读", icon: "voiceprint-line" },
  { id: "shortcuts", label: "快捷操作", icon: "keyboard-line" },
  { id: "security", label: "安全与审计", icon: "shield-check-line" },
  { id: "plugins", label: "组件市场", icon: "store-2-line" },
  { id: "legal", label: "法律与协议", icon: "scales-3-line" },
  { id: "about", label: "关于与更新", icon: "information-line" },
  { id: "system", label: "系统", icon: "settings-3-line" },
];

const visibleSettingsGroups = computed(() => {
  // 账单/用量始终可见；购买类「组件市场」仍随商务开关隐藏
  if (showCommerceUi()) return SETTINGS_GROUPS;
  return SETTINGS_GROUPS.filter((g) => g.id !== "plugins");
});

const props = withDefaults(
  defineProps<{
    /** Embedded in IDE editor tab (no route navigation). */
    embedded?: boolean;
    /** Initial settings group when embedded. */
    group?: string;
  }>(),
  { embedded: false },
);

const activeSettingsGroup = ref<SettingsGroupId>("appearance");
const settingsMainEl = ref<HTMLElement | null>(null);

const meetingFuseSettings = ref<MeetingFuseSettings>(readMeetingFuseSettings());
const bossReplyWatchSettings = ref<BossReplyWatchSettings>(readBossReplyWatchSettings());
const bossConfirmPolicy = ref<BossConfirmPolicy>(readBossConfirmPolicy());
const officeTopology = ref<OfficeTopology>(readOfficeTopology());
const writingQuotaLock = ref("");
const writingQuotaUnlockBusy = ref(false);

function persistMeetingFuse(patch: Partial<MeetingFuseSettings>) {
  meetingFuseSettings.value = writeMeetingFuseSettings(patch);
}

function persistBossReplyWatch(patch: Partial<BossReplyWatchSettings>) {
  bossReplyWatchSettings.value = writeBossReplyWatchSettings(patch);
}

function persistBossConfirmPolicy(patch: Partial<BossConfirmPolicy>) {
  bossConfirmPolicy.value = writeBossConfirmPolicy(patch);
  if (patch.amountThresholdYuan != null) {
    void syncWritingPerModelQuotaToDb(bossConfirmPolicy.value.amountThresholdYuan);
  }
}

async function refreshWritingQuotaLock() {
  writingQuotaLock.value = await readWritingQuotaBossLock();
}

async function unlockWritingQuotaByBoss() {
  writingQuotaUnlockBusy.value = true;
  try {
    await clearWritingQuotaBossLock();
    writingQuotaLock.value = "";
    fouMsg.success("已解除额度断连锁，可继续调用模型");
  } catch (e) {
    void onApiCatch(e, undefined, { fallback: "解除失败" });
  } finally {
    writingQuotaUnlockBusy.value = false;
  }
}

function persistOfficeTopology(next: OfficeTopology) {
  officeTopology.value = writeOfficeTopology(next);
}

const router = useRouter();
const route = useRoute();

function parseSettingsGroup(raw: unknown): SettingsGroupId | null {
  const id = String(raw ?? "");
  const mapped =
    id === "model" ? "models" : id === "license" ? "role-packs" : id;
  return SETTINGS_GROUPS.some((g) => g.id === mapped) ? (mapped as SettingsGroupId) : null;
}

function applySettingsGroupFromRoute() {
  const g = parseSettingsGroup(props.group ?? route.query.group);
  if (g) activeSettingsGroup.value = g;
}

/** 切换设置分组（阻止冒泡，避免 Tauri drag / 遮罩吞点击） */
function selectSettingsGroup(id: SettingsGroupId) {
  if (activeSettingsGroup.value === id) return;
  activeSettingsGroup.value = id;
  if (!props.embedded) {
    const query = id === "appearance" ? {} : { group: id };
    void router.replace({ path: "/settings", query });
  }
  void nextTick(() => {
    settingsMainEl.value?.scrollTo({ top: 0 });
  });
}

watch(visibleSettingsGroups, (groups) => {
  if (!groups.some((g) => g.id === activeSettingsGroup.value)) {
    activeSettingsGroup.value = "appearance";
  }
}, { immediate: true });

watch(
  () => [props.group, route.query.group] as const,
  () => applySettingsGroupFromRoute(),
);
const { theme, setTheme } = useTheme();
const { locale: uiLocale, options: uiLocaleOptions, setLocale: setUiLocale, hydrateLocale } =
  useUiLocale();

const terminalBg = ref<TerminalBg>("dark");
const screenshotShortcut = ref<ShortcutSpec>(readScreenshotShortcut());
const screenshotShortcutDraft = ref<ShortcutSpec>(readScreenshotShortcut());
const screenshotShortcutSaving = ref(false);
const screenshotAutoAttachChat = ref(readScreenshotAutoAttachChat());
const ideShellMenuRegistered = ref(false);
const ideShellMenuLoading = ref(false);
const ideShellMenuMsg = ref("");
const uiFontSize = ref<FontSize>("medium");
const terminalFontSize = ref<FontSize>("medium");
const fileTreeFontSize = ref<FontSize>("medium");

const deskCount = ref(readDeskCount());
const autoSyncDesk = ref(readAutoSyncDesk());
const officeSnapshotMeta = ref<OfficeSnapshotMeta | null>(null);
const officeSnapshotBusy = ref(false);
const officeSnapshotMsg = ref("");
const officeDisplayPrefs = ref<OfficeDisplayPrefs>(readOfficeDisplayPrefs());
const drive = ref<DriveSettings>(readDriveSettings());
const cursorSdkProbe = ref<CursorSdkProbe | null>(null);
const cursorApiKeyDraft = ref("");
const cursorApiKeyConfigured = ref(false);
const cursorApiKeySaving = ref(false);
const ideCliOverride = ref(readIdeCliOverride());
const codingSurface = ref<CodingSurfacePrefs>(readCodingSurfacePrefs());
const ideProbe = ref<IdeProbeResult>(emptyIdeProbe());
const probingIde = ref(false);
const ideCliInputRef = ref<{ focus?: () => void } | null>(null);
const concurrency = ref<ConcurrencyConfig>({
  mode: "auto",
  globalSlots: 1,
  perProjectSlots: 1,
  kickoffParallel: 1,
  kickoffMaxEmployees: 0,
  remoteUnlimited: false,
  remoteSlots: 2,
});
const savingConcurrency = ref(false);
const hostCap = ref<HostCapacity | null>(null);
const probingCap = ref(false);
const feishuSyncLevel = ref<FeishuSyncLevel>("all");
const bossVerbalDelegate = ref(false);

function patchOfficeDisplay(patch: Partial<OfficeDisplayPrefs>) {
  officeDisplayPrefs.value = writeOfficeDisplayPrefs({ ...officeDisplayPrefs.value, ...patch });
}

function patchCodingSurface(patch: Partial<CodingSurfacePrefs>) {
  const next = { ...codingSurface.value, ...patch };
  codingSurface.value = next;
  writeCodingSurfacePrefs(next);
  if (next.defaultSurface === "external") {
    ideCliOverride.value = readIdeCliOverride();
  }
}

function setCodingSurfaceMode(mode: "builtin" | "external") {
  if (mode === "external") {
    let ide = codingSurface.value.externalIde;
    if (!isIdeCliInstalled(ide, ideProbe.value)) {
      ide = firstInstalledIde(ideProbe.value) || ide;
    }
    patchCodingSurface({ defaultSurface: mode, externalIde: ide });
    const cli = IDE_OPTIONS.find((o) => o.id === ide)?.cli || "cursor";
    ideCliOverride.value = cli;
    writeIdeCliOverride(cli);
    return;
  }
  patchCodingSurface({ defaultSurface: mode });
}

function setBossVerbalDelegate(v: boolean) {
  bossVerbalDelegate.value = v;
  try {
    localStorage.setItem("xu.boss.verbalDelegate", v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
const guiConsent = ref(readGuiConsentLocal());
const guiExperimental = ref(readGuiExperimentalLocal());
const guiEmergencyStopped = ref(false);
const agentPrefs = ref<AgentPrefs>({
  localStream: true,
  llmCompact: false,
  execPolicy: "standard",
  chatMode: "agent",
  temperature: 0.2,
  bulkReadWarnEnabled: true,
  bulkReadFileThreshold: 40,
  bulkReadBytesThreshold: 1_572_864,
  ideReleaseGateEnabled: false,
});
const codeExecPrefs = ref<CodeExecPrefs>(defaultCodeExecPrefs());
const softwareAutopilot = ref<SoftwareAutopilotPrefs>(defaultSoftwareAutopilotPrefs());
const softwareAutopilotRiskOpen = ref(false);
const playwrightStatus = ref<PlaywrightStatus | null>(null);
const playwrightInstalling = ref(false);
const playwrightMsg = ref("");
const undoMsg = ref("");
const undoLoading = ref(false);
const retentionDays = ref(0);
const retentionNever = ref(true);
const employeeWorkApi = ref<GlobalEmployeeApiSource>("follow");
const employees = ref<Employee[]>([]);
const driveHelpOpen = ref(false);
const driveRiskOpen = ref(false);
const userAgreementOpen = ref(false);
const softwareLicenseOpen = ref(false);

const userAgreementSections = computed(() => buildUserAgreementSections(companyName.value));
const softwareLicenseSections = computed(() => buildSoftwareLicenseSections(companyName.value));
const companyName = ref(readCompanyName());
const showHallDisplay = ref(false);
const hallDisplaySummary = ref<OfficeHallDisplay>(readOfficeHallDisplay());

function refreshHallDisplaySummary() {
  hallDisplaySummary.value = readOfficeHallDisplay();
}

const hallDisplaySummaryText = computed(() => {
  const h = hallDisplaySummary.value;
  const logo = h.logoDataUrl?.trim() ? "自定义 Logo" : "默认 Logo";
  return `${h.mainTitle} · 前台「${h.foldingTitle}」 · ${logo}`;
});

function openHallDisplayFromSettings() {
  refreshHallDisplaySummary();
  showHallDisplay.value = true;
}
const appIdentity = ref<AppIdentity>({
  productName: "虚募阁",
  productNameEn: "Virmoor",
  version: "",
  copyrightHolder: "玖咖科技",
});
const productBrandLabel = computed(() =>
  appIdentity.value.productNameEn
    ? `${appIdentity.value.productName}｜${appIdentity.value.productNameEn}`
    : appIdentity.value.productName || BRAND_NAME,
);
const userAddress = ref(readUserAddressRaw());
const tokenStatus = ref<TokenPackageStatus | null>(null);
const tokenHardLimit = ref(2_000_000);
const tokenSaving = ref(false);
const rolePacks = ref<InstalledRolePack[]>([]);
const rolePackKeyHex = ref("");
const rolePackLicense = ref("");
const rolePackMsg = ref("");
const rolePackBusy = ref(false);
const appUpdateBusy = ref(false);
const appUpdateInstalling = ref(false);
const appUpdateResult = ref<AppUpdateResult | null>(null);
const rolePackActivatePath = ref("");
const rolePackLicenseStatus = ref<LicenseStatus | null>(null);
const rolePackUpdates = ref<Array<{ packId: string; contentVersion: string; downloadUrl?: string | null }>>([]);
const cloudRolePackEntries = ref<RolePackDownloadEntry[]>([]);
const cloudRolePackHint = ref("");
const editionPrefs = ref<EditionPrefs>({
  edition: "solo",
  endpointMode: "auto",
  localBaseUrl: getLocalBrainDefaultUrl(),
  cloudBaseUrl: getAccountServerUrl(),
  activeRoleIds: [],
});
const editionEndpointHint = ref("");
const enterpriseRoleCatalog = ref<RolePackMeta[]>([]);
const enterpriseRoleFilter = ref("");

const capabilityPacks = ref<InstalledCapabilityPack[]>([]);
const capabilityPackBusy = ref(false);
const capabilityPackMsg = ref("");
const commercePlugins = ref<XuCommercialPlugin[]>([]);
const commerceEntitlements = ref<string[]>([]);
const commerceBusy = ref(false);
const commerceMsg = ref("");
const trainingOptIn = ref(false);
const eslintInfo = ref<{ installed: boolean; hasConfig: boolean; plugins: string[] } | null>(null);
const eslintInfoMsg = ref("");

type McpServerConfig = {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  timeoutMs: number;
  toolRisk: Record<string, "low" | "medium" | "high">;
  allowedRoleIds?: string[];
};

type SecurityAuditEntry = {
  ts: number;
  kind: string;
  toolName?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  employeeId?: string | null;
  detail: string;
  outcome: string;
};

const memoryAutoExtract = ref(true);
const mcpServers = ref<McpServerConfig[]>([]);
const hasEnabledMcp = computed(() => mcpServers.value.some((s) => s.enabled));
const advancedTrainingOpen = ref(false);
const mcpDraftName = ref("");
const mcpDraftCommand = ref("");
const mcpDraftArgs = ref("");
const trainingDataDirLabel = ref("");
const trainingDirCustom = ref(false);
const trainingDirBusy = ref(false);
const skillsDataDirLabel = ref("");
const skillsDirCustom = ref(false);
const skillsDirBusy = ref(false);
const mcpSaving = ref(false);
const securityAudit = ref<SecurityAuditEntry[]>([]);
const securityAuditLoading = ref(false);
const activityLog = ref<ActivityLogEntry[]>([]);
const activityLogLoading = ref(false);
const activityLogFilter = ref<ActivityLogFilter>("all");
const activityLogExpanded = ref<number | null>(null);

const filteredActivityLog = computed(() =>
  filterActivityLog(activityLog.value, activityLogFilter.value),
);

const reviewers = computed(() => employees.value.filter((e) => e.roleKind === "reviewer"));
const ideSelectOptions = computed(() => {
  void ideCliOverride.value;
  return idePickerOptions(ideProbe.value);
});

async function refreshIdeProbe() {
  probingIde.value = true;
  try {
    const p = await probeInstalledIdes();
    ideProbe.value = p;
    fouMsg.success(probeSummary(p));
    if (
      codingSurface.value.defaultSurface === "external" &&
      !isIdeCliInstalled(codingSurface.value.externalIde, p)
    ) {
      const hit = firstInstalledIde(p);
      if (hit) patchCodingSurface({ externalIde: hit });
    }
  } catch (e) {
    void onApiCatch(e);
  } finally {
    probingIde.value = false;
  }
}

watch(
  () => codingSurface.value.externalIde,
  (ide) => {
    if (ide === "other") {
      void nextTick(() => ideCliInputRef.value?.focus?.());
    }
  },
);
const cursorSdkAllowed = computed(
  () =>
    codingSurface.value.defaultSurface === "external" && codingSurface.value.externalIde === "cursor",
);
const sdkDriveHint = computed(() => {
  if (!cursorSdkAllowed.value) {
    return "仅 Cursor 有官方 SDK。VS Code / Trae / Qoder 无对等 SDK，深度操控请用键鼠驾驶。";
  }
  if (cursorSdkProbe.value?.detail) {
    return cursorSdkProbe.value.detail;
  }
  return "通过 Cursor 命令行打开工作区（原生 SDK 桥接后续接入）";
});
const reviewerSelectOptions = computed(() => [
  { value: "", label: "自动（首个 reviewer）" },
  ...reviewers.value.map((r) => ({ value: r.id, label: r.name })),
]);
const nameTruncateSelectOptions = computed(() =>
  NAME_TRUNCATE_OPTIONS.map((o) => ({ value: String(o.value), label: o.label })),
);

async function saveScreenshotShortcut() {
  screenshotShortcutSaving.value = true;
  try {
    await applyScreenshotShortcut(screenshotShortcutDraft.value);
    screenshotShortcut.value = readScreenshotShortcut();
    fouMsg.success("截图快捷键已保存");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    screenshotShortcutSaving.value = false;
  }
}

async function resetScreenshotShortcut() {
  screenshotShortcutDraft.value = { ...DEFAULT_SCREENSHOT_SHORTCUT };
  await saveScreenshotShortcut();
}

/** Toggle whether finishing a screenshot auto-fills the chat composer. */
function onScreenshotAutoAttachChange(v: boolean) {
  screenshotAutoAttachChat.value = v;
  writeScreenshotAutoAttachChat(v);
}

async function refreshIdeShellMenuStatus() {
  try {
    const s = await invoke<{ registered: boolean }>("xu_shell_is_ide_menu_registered");
    ideShellMenuRegistered.value = s.registered;
  } catch {
    ideShellMenuRegistered.value = false;
  }
}

async function registerIdeShellMenu() {
  ideShellMenuLoading.value = true;
  ideShellMenuMsg.value = "";
  try {
    await invoke("xu_shell_register_ide_menu");
    ideShellMenuRegistered.value = true;
    ideShellMenuMsg.value = "已注册「用 虚募阁 IDE 打开」右键菜单（当前用户）";
    fouMsg.success("右键菜单已注册");
  } catch (e) {
    ideShellMenuMsg.value = toUserError(e);
    void onApiCatch(e);
  } finally {
    ideShellMenuLoading.value = false;
  }
}

async function unregisterIdeShellMenu() {
  ideShellMenuLoading.value = true;
  ideShellMenuMsg.value = "";
  try {
    await invoke("xu_shell_unregister_ide_menu");
    ideShellMenuRegistered.value = false;
    ideShellMenuMsg.value = "已取消注册";
    fouMsg.success("右键菜单已移除");
  } catch (e) {
    ideShellMenuMsg.value = toUserError(e);
    void onApiCatch(e);
  } finally {
    ideShellMenuLoading.value = false;
  }
}

function setTerminalBg(bg: TerminalBg) {
  terminalBg.value = bg;
  writeLs(TERMINAL_BG_KEY, bg, TERMINAL_BG_KEY_LEGACY);
}

function applyUiFont(size: FontSize) {
  uiFontSize.value = size;
  if (size === "medium") document.documentElement.removeAttribute("data-ui-size");
  else document.documentElement.setAttribute("data-ui-size", size);
  writeLs("xu.ui.fontSize", size, "hermes-ui-font-size");
}

function applyTerminalFont(size: FontSize) {
  terminalFontSize.value = size;
  writeLs("xu.terminal.fontSize", size, "hermes-terminal-font-size");
}

function applyFileTreeFont(size: FontSize) {
  fileTreeFontSize.value = size;
  const px = { small: 11, medium: 12, large: 14 }[size];
  document.documentElement.style.setProperty("--file-tree-font-size", `${px}px`);
  writeLs("xu.fileTree.fontSize", size, "hermes-file-tree-font-size");
}

function patchDrive(patch: Partial<DriveSettings>) {
  const next = { ...drive.value, ...patch };
  if (patch.useInputControl && !next.consentAccepted) {
    next.enabled = next.enabled && next.consentAccepted;
  }
  if (next.useSdk) next.mode = "sdk";
  else if (next.useInputControl) next.mode = "input_control";
  else next.mode = "off";
  drive.value = next;
  writeDriveSettings(next);
  void syncDriveUseSdkToDb(next.useSdk);
  if ("defaultReviewerId" in patch) {
    void setDefaultReviewerId(next.defaultReviewerId);
  }
  if ("windowWhitelist" in patch && guiExperimental.value) {
    void writeGuiExperimental(true, currentGuiWorkspace(), next.windowWhitelist);
  }
}

const GUI_WHITELIST_PRESETS = ["Cursor", "Visual Studio Code", "Code"] as const;

function addGuiWhitelistPreset(label: string) {
  const set = new Set(drive.value.windowWhitelist);
  set.add(label);
  patchDrive({ windowWhitelist: [...set] });
}

async function saveRetention(never: boolean, days: number) {
  retentionNever.value = never;
  const v = never ? 0 : Math.max(1, days);
  retentionDays.value = v;
  await setChatRetentionDays(v);
}

async function modelHintForCapacity(): Promise<string> {
  const p = await loadGlobalModelProfiles();
  return p.local.textModel || p.remotePresets.find((r) => r.isDefault)?.textModel || "";
}

async function onModelProfilesSaved() {
  await saveEmployeeWorkApiSource(employeeWorkApi.value);
}

async function persistConcurrency() {
  savingConcurrency.value = true;
  try {
    await saveConcurrencyConfig(concurrency.value);
    concurrency.value = await loadConcurrencyConfig();
    try {
      const profile = await loadHostProfile();
      if (profile) hostCap.value = hostProfileToCapacity(profile);
    } catch {
      /* ignore */
    }
  } finally {
    savingConcurrency.value = false;
  }
}

async function runAutoSlots() {
  probingCap.value = true;
  try {
    hostCap.value = await applyAutoEmployeeSlots(await modelHintForCapacity());
    concurrency.value = {
      ...concurrency.value,
      mode: "auto",
      globalSlots: hostCap.value.recommendedGlobalSlots,
      perProjectSlots: hostCap.value.recommendedPerProject,
      remoteSlots: hostCap.value.recommendedRemoteSlots ?? 2,
      kickoffParallel: hostCap.value.recommendedKickoffParallel ?? 1,
      kickoffMaxEmployees: hostCap.value.recommendedKickoffMax ?? 8,
    };
  } catch (e) {
    void onApiCatch(e);
  } finally {
    probingCap.value = false;
  }
}

async function onGuiConsent(v: boolean) {
  try {
    guiConsent.value = v;
    await writeGuiConsent(v, currentGuiWorkspace());
  } catch (e) {
    guiConsent.value = false;
    void onApiCatch(e);
  }
}

function currentGuiWorkspace(): string | null {
  return (
    employees.value.find((e) => e.workspaceRoot)?.workspaceRoot ||
    employees.value[0]?.workspaceRoot ||
    null
  );
}

async function onGuiExperimental(v: boolean) {
  try {
    guiExperimental.value = v;
    await writeGuiExperimental(v, currentGuiWorkspace(), drive.value.windowWhitelist);
    if (v) await armGuiInputMonitor();
    if (!v) {
      guiConsent.value = false;
      await writeGuiConsent(false, currentGuiWorkspace());
    }
  } catch (e) {
    guiExperimental.value = false;
    void onApiCatch(e);
  }
}

async function stopGuiNow() {
  try {
    await emergencyStopGui();
    guiEmergencyStopped.value = true;
    fouMsg.success("GUI 驾驶已急停");
  } catch (e) {
    void onApiCatch(e);
  }
}

async function resetGuiStop() {
  try {
    await resetGuiEmergencyStop();
    guiEmergencyStopped.value = false;
    fouMsg.success("GUI 急停已人工复位");
  } catch (e) {
    void onApiCatch(e);
  }
}

async function persistAgentPrefs(patch: Partial<AgentPrefs>) {
  agentPrefs.value = { ...agentPrefs.value, ...patch };
  try {
    await saveAgentPrefs(agentPrefs.value);
  } catch {
    /* ignore */
  }
}

async function persistSoftwareAutopilot(patch: Partial<SoftwareAutopilotPrefs>) {
  const next = { ...softwareAutopilot.value, ...patch };
  if (patch.enabled === true && !next.riskAcknowledged) {
    softwareAutopilotRiskOpen.value = true;
    return;
  }
  if (!next.riskAcknowledged) {
    next.enabled = false;
  }
  softwareAutopilot.value = next;
  try {
    await saveSoftwareAutopilotPrefs(next);
  } catch (e) {
    void onApiCatch(e);
  }
}

async function persistCodeExecPrefs(patch: Partial<CodeExecPrefs>) {
  codeExecPrefs.value = { ...codeExecPrefs.value, ...patch };
  if (patch.enhancedCodeLoop === false) {
    codeExecPrefs.value.backend = "native";
  } else if (patch.enhancedCodeLoop === true) {
    codeExecPrefs.value.backend = "native_enhanced";
  }
  try {
    await saveCodeExecPrefs(codeExecPrefs.value);
  } catch {
    /* ignore */
  }
}

async function refreshPlaywrightStatus() {
  try {
    playwrightStatus.value = await probePlaywrightStatus();
  } catch {
    playwrightStatus.value = null;
  }
}

async function runPlaywrightInstall() {
  playwrightInstalling.value = true;
  playwrightMsg.value = "";
  try {
    playwrightMsg.value = await installPlaywright();
    await refreshPlaywrightStatus();
    void fouAlert(playwrightMsg.value, "Playwright 安装完成");
  } catch (e) {
    const msg = toUserError(e);
    playwrightMsg.value = msg;
    void fouAlert(msg, "Playwright 安装失败");
  } finally {
    playwrightInstalling.value = false;
  }
}

async function runWorkspaceUndo() {
  const ws =
    employees.value.find((e) => e.workspaceRoot)?.workspaceRoot ||
    employees.value[0]?.workspaceRoot;
  if (!ws) {
    undoMsg.value = "请先配置员工工作区路径";
    return;
  }
  undoLoading.value = true;
  undoMsg.value = "";
  try {
    undoMsg.value = await undoAgentWorkspace(ws);
  } catch (e) {
    undoMsg.value = toUserError(e);
  } finally {
    undoLoading.value = false;
  }
}

async function refreshOfficeSnapshotMeta() {
  officeSnapshotMeta.value = await getOfficeUserDefaultMeta();
}

async function handleSaveOfficeDefault() {
  if (
    !window.confirm(
      "将当前办公室（工位、员工、布局、三脑）保存为「我的默认」？之后可随时一键恢复。",
    )
  ) {
    return;
  }
  officeSnapshotBusy.value = true;
  officeSnapshotMsg.value = "";
  try {
    officeSnapshotMeta.value = await saveOfficeUserDefault();
    officeSnapshotMsg.value = "已保存为办公室默认";
  } catch (e) {
    officeSnapshotMsg.value = `保存失败：${toUserError(e)}`;
  } finally {
    officeSnapshotBusy.value = false;
  }
}

async function handleRestoreOfficeDefault() {
  if (
    !window.confirm(
      "恢复「我的办公室默认」？将覆盖当前工位、员工名单、布局与模型配置。",
    )
  ) {
    return;
  }
  officeSnapshotBusy.value = true;
  officeSnapshotMsg.value = "";
  try {
    await restoreOfficeUserDefault();
    deskCount.value = readDeskCount();
    await loadGlobalModelProfiles(true);
    employees.value = await loadEmployees();
    officeSnapshotMeta.value = await getOfficeUserDefaultMeta();
    officeSnapshotMsg.value = "已恢复办公室默认";
  } catch (e) {
    officeSnapshotMsg.value = toUserError(e);
  } finally {
    officeSnapshotBusy.value = false;
  }
}

async function handleDeskCount(value: number) {
  const next = Math.max(OFFICE_DESK_MIN, Math.min(OFFICE_DESK_MAX, Math.floor(Number(value))));
  if (!Number.isFinite(next) || next === deskCount.value) return;

  let layout: OfficeLayout = buildDefaultOfficeLayout(deskCount.value);
  try {
    const raw = await invoke<string | null>("xu_get_office_layout");
    if (raw) {
      const parsed = JSON.parse(raw) as OfficeLayout;
      if (parsed?.version === 1 && Array.isArray(parsed.props)) layout = parsed;
    }
  } catch {
    /* use default */
  }

  if (isThreeBayOffice(layout) && !layout.meta?.projectId) {
    if (next < deskCount.value) {
      const affected = readEmployees().filter(
        (e) => e.deskIndex != null && e.deskIndex >= next,
      );
      if (affected.length > 0) {
        const ok = window.confirm(
          `三开间将减至 ${next} 席，解除 ${affected.length} 名员工工位绑定。继续？`,
        );
        if (!ok) return;
      }
    }
    deskCount.value = writeDeskCount(next);
    const rebuilt = buildThreeBayOfficeLayout({
      headcount: next,
      companyName: readCompanyName(),
    });
    const removedSeats = readEmployees()
      .map((e) => e.deskIndex)
      .filter((s): s is number => s != null && s >= next);
    if (removedSeats.length > 0) await unbindEmployeesFromDesks(removedSeats);
    try {
      await saveOfficeLayout(rebuilt);
    } catch (e) {
      console.warn("saveOfficeLayout after deskCount", e);
    }
    return;
  }

  const occupied = new Set(listOccupiedDeskIndices(readEmployees()));
  const { layout: synced, removedSeats } = syncDeskCount(layout, next, occupied);

  if (next < deskCount.value && removedSeats.length > 0) {
    const affected = readEmployees().filter(
      (e) => e.deskIndex != null && removedSeats.includes(e.deskIndex),
    );
    if (affected.length > 0) {
      const ok = window.confirm(
        `将解除 ${affected.length} 名员工的工位绑定（员工不会被删除，可在团队页重新指定席号）。继续？`,
      );
      if (!ok) return;
    }
  }

  deskCount.value = writeDeskCount(next);
  if (removedSeats.length > 0) await unbindEmployeesFromDesks(removedSeats);
  try {
    await saveOfficeLayout(synced);
  } catch (e) {
    console.warn("saveOfficeLayout after deskCount", e);
  }
}

function commitCompanyName() {
  companyName.value = writeCompanyName(companyName.value);
}

function commitUserAddress() {
  userAddress.value = writeUserAddress(userAddress.value);
  fouMsg.success("已保存称呼设置");
}

async function refreshTokenStatus() {
  try {
    tokenStatus.value = await tokenPackageStatus();
    tokenHardLimit.value = tokenStatus.value.hardLimit;
  } catch {
    /* ignore */
  }
}

async function saveTokenPackage(reset = false) {
  tokenSaving.value = true;
  try {
    tokenStatus.value = await setTokenPackage({
      hardLimit: Math.max(1000, Number(tokenHardLimit.value) || 2_000_000),
      softRatio: 0.8,
      resetUsage: reset,
    });
    tokenHardLimit.value = tokenStatus.value.hardLimit;
  } finally {
    tokenSaving.value = false;
  }
}

async function refreshRolePacks() {
  try {
    rolePacks.value = await listRolePackInstalled();
    rolePackLicenseStatus.value = await getRolePackLicenseStatus();
    editionPrefs.value = await getEditionPrefs();
    if (editionPrefs.value.edition === "enterprise") {
      const session = await restoreSession();
      if (!isCloudEnterpriseSession(session)) {
        editionPrefs.value = { ...editionPrefs.value, edition: "solo" };
        try {
          editionPrefs.value = await setEditionPrefs({ ...editionPrefs.value });
        } catch {
          /* ignore */
        }
        enterpriseRoleCatalog.value = [];
      } else {
        enterpriseRoleCatalog.value = await listAllRolesForPicker();
      }
    } else {
      enterpriseRoleCatalog.value = [];
    }
    void maybeRenewSessionKeys();
  } catch {
    rolePacks.value = [];
    rolePackLicenseStatus.value = null;
  }
}

async function saveEditionPrefs() {
  rolePackBusy.value = true;
  rolePackMsg.value = "";
  try {
    if (editionPrefs.value.edition === "enterprise") {
      const session = await restoreSession();
      if (!isCloudEnterpriseSession(session)) {
        await fouAlert("企业版需使用云端企业账号登录，当前已保持单独版。", "无法切换版本");
        editionPrefs.value = { ...editionPrefs.value, edition: "solo" };
      }
    }
    editionPrefs.value = await setEditionPrefs({ ...editionPrefs.value });
    const ep = await resolveLicenseEndpoint();
    editionEndpointHint.value =
      ep.source === "local"
        ? "当前服务：本地服务"
        : ep.source === "cloud_fallback"
          ? "本地服务不可用，已切换云端服务"
          : "当前服务：云端服务";
    rolePackMsg.value = "版本与端点偏好已保存";
    await refreshRolePacks();
  } catch (e) {
    rolePackMsg.value = sanitizeUserMessage(e, "版本偏好保存失败");
    await fouAlert(rolePackMsg.value, "保存失败");
  } finally {
    rolePackBusy.value = false;
  }
}

async function sessionLoginAction() {
  rolePackBusy.value = true;
  rolePackMsg.value = "";
  try {
    let path = rolePackActivatePath.value.trim() || undefined;
    if (!path && !rolePackLicense.value.trim()) {
      rolePackMsg.value = "请填写许可证，或选择本地 .xupack";
      return;
    }
    if (!path) {
      /* allow download_url one-shot pull */
    }
    const res = await sessionLogin({
      license: rolePackLicense.value.trim(),
      path,
    });
    if (!res.ok) {
      rolePackMsg.value = res.message;
      return;
    }
    await reloadAgencyCatalog();
    await refreshRolePacks();
    const src = (res as { endpointSource?: string }).endpointSource || "";
    rolePackMsg.value = `${res.message}${src ? ` · ${src}` : ""}`;
  } catch (e) {
    rolePackMsg.value = toUserError(e);
  } finally {
    rolePackBusy.value = false;
  }
}

async function sessionRenewAction() {
  rolePackBusy.value = true;
  try {
    const res = await sessionRenew();
    rolePackMsg.value = res.message;
  } catch (e) {
    rolePackMsg.value = toUserError(e);
  } finally {
    rolePackBusy.value = false;
  }
}

async function sessionLogoutAction() {
  rolePackBusy.value = true;
  try {
    await sessionLogout();
    await reloadAgencyCatalog();
    await refreshRolePacks();
    rolePackMsg.value = showCommerceUi()
      ? "已登出：临时密钥已清除，商业岗位已卸下（加密包仍在本机）"
      : "已登出：临时密钥已清除，扩展岗位已卸下（加密包仍在本机）";
  } catch (e) {
    rolePackMsg.value = toUserError(e);
  } finally {
    rolePackBusy.value = false;
  }
}

function toggleEnterpriseRole(id: string) {
  const set = new Set(editionPrefs.value.activeRoleIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  editionPrefs.value = { ...editionPrefs.value, activeRoleIds: [...set] };
}

const filteredEnterpriseRoles = computed(() => {
  const q = enterpriseRoleFilter.value.trim().toLowerCase();
  if (!q) return enterpriseRoleCatalog.value.slice(0, 80);
  return enterpriseRoleCatalog.value
    .filter(
      (r) =>
        r.nameZh?.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.divisionZh?.toLowerCase().includes(q),
    )
    .slice(0, 80);
});

function openRolePackStore() {
  void import("@tauri-apps/plugin-shell").then(({ open }) => open(ROLE_PACK_STORE_URL));
}

async function checkRolePackUpdatesAction() {
  rolePackBusy.value = true;
  rolePackMsg.value = "";
  try {
    const updates = await checkRolePackUpdates();
    rolePackUpdates.value = updates;
    if (!updates.length) {
      rolePackMsg.value = "当前岗位数据包已是最新版本";
    } else {
      rolePackMsg.value = `发现 ${updates.length} 个可更新数据包，请下载后重新导入`;
    }
  } catch (e) {
    rolePackMsg.value = toUserError(e);
    rolePackUpdates.value = [];
  } finally {
    rolePackBusy.value = false;
  }
}

/** Duty: 仅检查桌面端版本，不下载安装包 */
async function checkAppUpdateAction() {
  if (appUpdateBusy.value || appUpdateInstalling.value) return;
  appUpdateBusy.value = true;
  try {
    const result = await checkAppUpdate();
    appUpdateResult.value = result;
    if (result.status !== "available") {
      await fouAlert(result.message, "检查更新");
    }
  } catch (e) {
    appUpdateResult.value = null;
    void onApiCatch(e, undefined, { fallback: "检查更新失败" });
  } finally {
    appUpdateBusy.value = false;
  }
}

/** Duty: 确认后关闭业务窗并打开更新进度窗下载安装 */
async function downloadAppUpdateAction() {
  const result = appUpdateResult.value;
  if (!result || result.status !== "available") return;
  if (appUpdateInstalling.value || appUpdateBusy.value) return;
  appUpdateInstalling.value = true;
  try {
    await downloadAndInstallAppUpdate(result);
  } catch (e) {
    void onApiCatch(e, undefined, { fallback: "下载安装失败" });
  } finally {
    appUpdateInstalling.value = false;
  }
}

async function pickRolePackFile(): Promise<string | null> {
  const selected = await openFileDialog({
    multiple: false,
    filters: [{ name: "岗位数据包", extensions: ["xupack"] }],
  });
  if (!selected) return null;
  return typeof selected === "string" ? selected : selected[0] || null;
}

async function importRolePackFile() {
  rolePackBusy.value = true;
  rolePackMsg.value = "";
  try {
    const path = await pickRolePackFile();
    if (!path) return;
    const info = await importRolePack(path, rolePackKeyHex.value.trim() || undefined);
    await reloadAgencyCatalog();
    await refreshRolePacks();
    rolePackMsg.value = `已导入「${info.packId}」共 ${info.roleCount} 岗`;
  } catch (e) {
    rolePackMsg.value = toUserError(e);
  } finally {
    rolePackBusy.value = false;
  }
}

async function refreshCloudRolePackCatalog() {
  cloudRolePackHint.value = "";
  try {
    const { entries, error } = await fetchRolePackDownloadEntries();
    cloudRolePackEntries.value = entries;
    if (error) {
      cloudRolePackHint.value = error;
      void fouAlert(error, "岗位包目录");
    } else if (!entries.length) {
      cloudRolePackHint.value =
        "暂无已上架的岗位包，请稍后再试或联系管理员";
    }
  } catch (e) {
    const msg = sanitizeUserMessage(e, "无法拉取岗位包目录");
    cloudRolePackHint.value = msg;
    void fouAlert(msg, "岗位包目录");
  }
}

async function downloadCloudRolePack(entry: RolePackDownloadEntry) {
  rolePackBusy.value = true;
  rolePackMsg.value = "";
  try {
    requireCloudLoginForRolePackDownload();
    const url = await resolveRolePackTicketUrl(entry.fileId);
    const path = await downloadRolePackFromUrl(url, entry.slug);
    const info = await importRolePack(path, rolePackKeyHex.value.trim() || undefined);
    await reloadAgencyCatalog();
    await refreshRolePacks();
    rolePackMsg.value = `已下载并导入「${info.packId || entry.name}」共 ${info.roleCount} 岗`;
  } catch (e) {
    rolePackMsg.value = sanitizeUserMessage(e, "下载岗位包失败");
    await fouAlert(rolePackMsg.value, "下载失败");
  } finally {
    rolePackBusy.value = false;
  }
}

async function activateRolePackFile() {
  rolePackBusy.value = true;
  rolePackMsg.value = "";
  try {
    let path = rolePackActivatePath.value.trim();
    if (!path) {
      const picked = await pickRolePackFile();
      if (!picked) return;
      path = picked;
      rolePackActivatePath.value = picked;
    }
    const res = await activateRolePack(rolePackLicense.value.trim(), path);
    if (!res.ok) {
      rolePackMsg.value = res.message;
      return;
    }
    const extra = [res.contentVersion ? `版本 ${res.contentVersion}` : "", res.downloadUrl ? "已返回下载地址" : ""]
      .filter(Boolean)
      .join(" · ");
    await reloadAgencyCatalog();
    await refreshRolePacks();
    rolePackMsg.value = extra ? `${res.message}（${extra}）` : res.message || "激活成功";
  } catch (e) {
    rolePackMsg.value = toUserError(e);
  } finally {
    rolePackBusy.value = false;
  }
}

async function reloadRolePackCatalog() {
  rolePackBusy.value = true;
  rolePackMsg.value = "";
  try {
    const n = await reloadRolePacks();
    await reloadAgencyCatalog();
    await refreshRolePacks();
    rolePackMsg.value = `已重载岗位库（${n} 岗）`;
  } catch (e) {
    rolePackMsg.value = toUserError(e);
  } finally {
    rolePackBusy.value = false;
  }
}

async function refreshCapabilityPacks() {
  try {
    const state = await loadCapabilityPackState(true);
    capabilityPacks.value = state.installed;
  } catch {
    capabilityPacks.value = [];
  }
  await refreshEslintInfo();
}

async function refreshCommercePlugins() {
  commerceBusy.value = true;
  commerceMsg.value = "";
  try {
    ensureBuiltinCommercePlugins();
    invalidateEntitlementCache();
    commercePlugins.value = listCommercialPlugins();
    const info = await listLicenseEntitlements(true);
    commerceEntitlements.value = info.entitlements;
    trainingOptIn.value = isTrainingOptIn();
  } catch (e) {
    commerceMsg.value = sanitizeUserMessage(e, "商业插件信息读取失败");
    commercePlugins.value = [];
    commerceEntitlements.value = [];
    await fouAlert(commerceMsg.value, "读取失败");
  } finally {
    commerceBusy.value = false;
  }
}

function onTrainingOptIn(v: boolean) {
  setTrainingOptIn(v);
  trainingOptIn.value = v;
  const hasEnt = commerceEntitlements.value.includes("training.ingest");
  if (v && !hasEnt) {
    commerceMsg.value =
      "已开启偏好，但当前无 training.ingest 授权 — 样本不会上传（可本地浏览需训练工作室）。";
    void fouAlert("当前账号没有训练采集授权，已保留偏好但不会采集或上传样本。", "授权不足");
  } else {
    commerceMsg.value = v ? "已开启训练样本（需授权与插件钩子才会落盘/上传）" : "已关闭训练样本";
  }
}

function goCanvasIde() {
  void router.push("/canvas");
}

function stubImportFoubiz() {
  fouMsg.info(
    "当前版本尚未提供 .xubiz 动态加载器。流程/训练工作室走内置 SPI（需对应 entitlement）；基础 Canvas 已内置，见帮助「Canvas 画板」。",
  );
  openHelp("settings.commerce-plugins");
}

async function refreshEslintInfo() {
  eslintInfoMsg.value = "";
  const ws = readLs("xu.chat.workingDir", "hermes_working_dir");
  if (!ws?.trim()) {
    eslintInfo.value = null;
    eslintInfoMsg.value = "请先在对话页选择工作目录，以检测 ESLint。";
    return;
  }
  try {
    eslintInfo.value = await detectEslintInfo(ws);
  } catch (e) {
    eslintInfo.value = null;
    eslintInfoMsg.value = toUserError(e);
  }
}

async function toggleCapabilityPack(id: string, enabled: boolean) {
  capabilityPackBusy.value = true;
  capabilityPackMsg.value = "";
  try {
    await setCapabilityPackEnabled(id, enabled);
    await refreshCapabilityPacks();
    capabilityPackMsg.value = enabled ? "已启用能力包" : "已禁用能力包";
  } catch (e) {
    capabilityPackMsg.value = toUserError(e);
  } finally {
    capabilityPackBusy.value = false;
  }
}

async function importCapabilityPackFile() {
  capabilityPackBusy.value = true;
  capabilityPackMsg.value = "";
  try {
    const row = await pickAndImportUserSkill();
    if (!row) {
      capabilityPackBusy.value = false;
      return;
    }
    await refreshCapabilityPacks();
    capabilityPackMsg.value = `已复制到本机技能目录：「${row.manifest.name}」（卸载软件不会删除，不上传）`;
  } catch (e) {
    capabilityPackMsg.value = toUserError(e);
  } finally {
    capabilityPackBusy.value = false;
  }
}

async function refreshSkillsDataDir() {
  skillsDataDirLabel.value = await skillsDataRootLabel();
  skillsDirCustom.value = !!readCustomSkillsDataDir();
}

async function pickSkillsDataDirSetting() {
  skillsDirBusy.value = true;
  try {
    const path = await pickSkillsDataDir();
    if (path) {
      fouMsg.success(`技能目录已设为：${path}`);
      await refreshSkillsDataDir();
      await refreshCapabilityPacks();
    }
  } catch (e) {
    void onApiCatch(e);
  } finally {
    skillsDirBusy.value = false;
  }
}

async function resetSkillsDataDirSetting() {
  skillsDirBusy.value = true;
  try {
    await clearSkillsDataDir();
    fouMsg.success("已恢复默认技能目录（文档/虚募阁技能）");
    await refreshSkillsDataDir();
    await refreshCapabilityPacks();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    skillsDirBusy.value = false;
  }
}

async function loadMemorySettings() {
  try {
    const raw = await invoke<string | null>("xu_get_setting", { key: "xu.memory.autoExtract" });
    memoryAutoExtract.value = raw !== "0" && raw !== "false";
  } catch {
    memoryAutoExtract.value = true;
  }
}

async function saveMemoryAutoExtract(v: boolean) {
  memoryAutoExtract.value = v;
  await invoke("xu_set_setting", { key: "xu.memory.autoExtract", value: v ? "1" : "0" });
}

async function refreshMcpServers() {
  try {
    mcpServers.value = await invoke<McpServerConfig[]>("xu_mcp_list_servers");
  } catch {
    mcpServers.value = [];
  }
}

async function refreshTrainingDataDir() {
  trainingDataDirLabel.value = await trainingDataRootLabel();
  trainingDirCustom.value = !!readCustomTrainingDataDir();
}

async function pickTrainingDataDirSetting() {
  trainingDirBusy.value = true;
  try {
    const path = await pickTrainingDataDir();
    if (path) {
      fouMsg.success(`训练目录已设为：${path}`);
      await refreshTrainingDataDir();
    }
  } catch (e) {
    void onApiCatch(e);
  } finally {
    trainingDirBusy.value = false;
  }
}

async function resetTrainingDataDirSetting() {
  trainingDirBusy.value = true;
  try {
    await clearTrainingDataDir();
    await refreshTrainingDataDir();
    fouMsg.success("已恢复默认训练目录");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    trainingDirBusy.value = false;
  }
}

async function openTrainingDataDirSetting() {
  trainingDirBusy.value = true;
  try {
    await openTrainingDataFolder();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    trainingDirBusy.value = false;
  }
}

async function saveMcpServers() {
  mcpSaving.value = true;
  try {
    await invoke("xu_mcp_save_servers", { servers: mcpServers.value });
  } finally {
    mcpSaving.value = false;
  }
}

async function refreshCursorApiKeyStatus() {
  cursorApiKeyConfigured.value = await isApiKeyConfigured(CURSOR_API_KEY_ENV);
}

async function saveCursorApiKey() {
  cursorApiKeySaving.value = true;
  try {
    await setStoredApiKey(CURSOR_API_KEY_ENV, cursorApiKeyDraft.value);
    cursorApiKeyDraft.value = "";
    await refreshCursorApiKeyStatus();
    await refreshCursorSdkProbe();
    fouMsg.success("Cursor API Key 已保存");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    cursorApiKeySaving.value = false;
  }
}

async function addDesignMcpPreset() {
  mcpSaving.value = true;
  try {
    const script = await invoke<string>("xu_bundled_tool_script", { folder: "design-mcp-bridge" });
    if (mcpServers.value.some((s) => s.id === "design-delivery")) {
      fouMsg.info("设计交付助手已存在");
      return;
    }
    mcpServers.value = [
      ...mcpServers.value,
      {
        id: "design-delivery",
        name: "设计交付助手",
        command: "node",
        args: [script],
        enabled: true,
        timeoutMs: 120_000,
        toolRisk: {
          run_ps_script: "high",
          run_corel_macro: "high",
          generate_and_run_ps_export: "high",
        },
        allowedRoleIds: ["design-", "marketing-", "ui-", "product-"],
      },
    ];
    await saveMcpServers();
    fouMsg.success("已添加设计交付助手");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    mcpSaving.value = false;
  }
}

async function addBlenderMcpPreset() {
  mcpSaving.value = true;
  try {
    const script = await invoke<string>("xu_bundled_tool_script", { folder: "mcp-blender-host" });
    if (mcpServers.value.some((s) => s.id === "blender-host")) {
      fouMsg.info("Blender 三维宿主已存在");
      return;
    }
    mcpServers.value = [
      ...mcpServers.value,
      {
        id: "blender-host",
        name: "Blender 三维宿主",
        command: "node",
        args: [script],
        enabled: true,
        timeoutMs: 180_000,
        toolRisk: {
          blender_ping: "low",
          blender_open: "medium",
          blender_eval: "high",
          blender_save: "high",
          blender_export: "high",
          blender_render_preview: "high",
        },
        allowedRoleIds: ["design-", "3d-", "blender-", "game-", "gis-", "engineering-"],
      },
    ];
    await saveMcpServers();
    fouMsg.success("已添加 Blender 三维宿主");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    mcpSaving.value = false;
  }
}

async function addMaxMcpPreset() {
  mcpSaving.value = true;
  try {
    const script = await invoke<string>("xu_bundled_tool_script", { folder: "mcp-max-host" });
    if (mcpServers.value.some((s) => s.id === "max-host")) {
      fouMsg.info("3ds Max 三维宿主已存在");
      return;
    }
    mcpServers.value = [
      ...mcpServers.value,
      {
        id: "max-host",
        name: "3ds Max 三维宿主",
        command: "node",
        args: [script],
        enabled: true,
        timeoutMs: 300_000,
        toolRisk: {
          max_ping: "low",
          max_open: "medium",
          max_eval: "high",
          max_save: "high",
          max_export_fbx: "high",
          max_render_preview: "high",
        },
        allowedRoleIds: ["design-", "3d-", "max-", "game-", "gis-", "engineering-"],
      },
    ];
    await saveMcpServers();
    fouMsg.success("已添加 3ds Max 三维宿主");
  } catch (e) {
    void onApiCatch(e);
  } finally {
    mcpSaving.value = false;
  }
}

function addMcpServer() {
  const name = mcpDraftName.value.trim();
  const command = mcpDraftCommand.value.trim();
  if (!name || !command) return;
  mcpServers.value = [
    ...mcpServers.value,
    {
      id: `mcp_${Date.now().toString(36)}`,
      name,
      command,
      args: mcpDraftArgs.value
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
      enabled: true,
      timeoutMs: 30_000,
      toolRisk: {},
    },
  ];
  mcpDraftName.value = "";
  mcpDraftCommand.value = "";
  mcpDraftArgs.value = "";
  void saveMcpServers();
}

function removeMcpServer(id: string) {
  mcpServers.value = mcpServers.value.filter((s) => s.id !== id);
  void saveMcpServers();
}

async function refreshSecurityAudit() {
  securityAuditLoading.value = true;
  try {
    securityAudit.value = await invoke<SecurityAuditEntry[]>("xu_list_security_audit", { limit: 80 });
  } catch {
    securityAudit.value = [];
  } finally {
    securityAuditLoading.value = false;
  }
}

async function refreshActivityLog() {
  activityLogLoading.value = true;
  try {
    activityLog.value = await listActivityLog(300);
  } catch {
    activityLog.value = [];
  } finally {
    activityLogLoading.value = false;
  }
}

async function exportActivityLog() {
  const rows = filteredActivityLog.value;
  if (!rows.length) {
    await fouAlert("暂无活动日志可导出。", "无法导出");
    return;
  }
  const text = activityLogToJsonl(rows);
  try {
    await navigator.clipboard.writeText(text);
    fouMsg.success(`已复制 ${rows.length} 条活动日志到剪贴板`);
  } catch (e) {
    void onApiCatch(e, undefined, { fallback: "导出失败，请检查剪贴板权限" });
  }
}

function auditToolLabel(toolName?: string | null, detail?: string | null): string {
  if (toolName?.trim()) return formatToolApprovalLabel(toolName, detail || undefined);
  return sanitizeUserDisplayText(detail, "");
}

function auditPathNames(paths?: string[] | null): string {
  if (!paths?.length) return "";
  return paths.map((p) => formatPathForUser(p)).join("、");
}

function toggleActivityDetail(ts: number) {
  activityLogExpanded.value = activityLogExpanded.value === ts ? null : ts;
}

function onOpenActivityLogEvent() {
  activeSettingsGroup.value = "security";
  void nextTick(() => {
    document.getElementById("activity-log-section")?.scrollIntoView({ behavior: "smooth" });
    void refreshActivityLog();
  });
}

watch(cursorSdkAllowed, (ok) => {
  if (!ok && drive.value.useSdk) patchDrive({ useSdk: false });
  if (ok) void refreshCursorSdkProbe();
});

async function refreshCursorSdkProbe() {
  if (!cursorSdkAllowed.value) {
    cursorSdkProbe.value = null;
    return;
  }
  try {
    cursorSdkProbe.value = await probeCursorSdk(true);
    if (drive.value.useSdk && !cursorSdkProbe.value.sdkReady) {
      patchDrive({ useSdk: false });
    }
  } catch {
    cursorSdkProbe.value = null;
  }
}

watch(
  () => activeSettingsGroup.value,
  (g) => {
    if (g === "role-packs") void refreshCloudRolePackCatalog();
    if (g === "confirm") void refreshWritingQuotaLock();
    if (g === "drive") {
      void refreshCursorSdkProbe();
      void refreshCursorApiKeyStatus();
    }
  },
);

onMounted(() => {
  clearStuckUiBlockers();
  hydrateLocale();
  applySettingsGroupFromRoute();
  window.addEventListener("xu-open-activity-log", onOpenActivityLogEvent);
  window.addEventListener("xu-office-display", refreshHallDisplaySummary);
  refreshHallDisplaySummary();
  if (activeSettingsGroup.value === "role-packs") void refreshCloudRolePackCatalog();
  if (activeSettingsGroup.value === "confirm") void refreshWritingQuotaLock();
  void syncWritingPerModelQuotaToDb(bossConfirmPolicy.value.amountThresholdYuan);
  void probeInstalledIdes().then((p) => {
    ideProbe.value = p;
    if (
      codingSurface.value.defaultSurface === "external" &&
      !isIdeCliInstalled(codingSurface.value.externalIde, p)
    ) {
      const hit = firstInstalledIde(p);
      if (hit) patchCodingSurface({ externalIde: hit });
    }
  });
  void syncScreenshotShortcutFromRust().then((spec) => {
    screenshotShortcut.value = spec;
    screenshotShortcutDraft.value = { ...spec };
  });
  void refreshIdeShellMenuStatus();
  writeIdeCliOverride(ideCliOverride.value);
  try {
    const bg = readLs(TERMINAL_BG_KEY, TERMINAL_BG_KEY_LEGACY) as TerminalBg | null;
    if (bg && TERMINAL_BGS.includes(bg)) terminalBg.value = bg;
  } catch {
    /* ignore */
  }
  try {
    const ui = readLs("xu.ui.fontSize", "hermes-ui-font-size") as FontSize | null;
    if (ui && FONT_SIZES.includes(ui)) applyUiFont(ui);
    const term = readLs("xu.terminal.fontSize", "hermes-terminal-font-size") as FontSize | null;
    if (term && FONT_SIZES.includes(term)) applyTerminalFont(term);
    const ft = readLs("xu.fileTree.fontSize", "hermes-file-tree-font-size") as FontSize | null;
    if (ft && FONT_SIZES.includes(ft)) applyFileTreeFont(ft);
  } catch {
    /* ignore */
  }

  void (async () => {
    void refreshTokenStatus();
    void refreshRolePacks();
    void refreshCapabilityPacks();
    void refreshCommercePlugins();
    void refreshOfficeSnapshotMeta();
    void loadMemorySettings();
    void refreshMcpServers();
    void refreshTrainingDataDir();
    void refreshSkillsDataDir();
    void refreshSecurityAudit();
    void refreshActivityLog();
    void loadAppIdentity().then((id) => {
      appIdentity.value = id;
    });
    try {
      employeeWorkApi.value = await loadEmployeeWorkApiSource();
      await loadGlobalModelProfiles();
    } catch {
      /* ignore */
    }
    try {
      concurrency.value = await loadConcurrencyConfig();
      const profile = await loadHostProfile();
      if (profile) {
        hostCap.value = hostProfileToCapacity(profile);
        if (concurrency.value.mode === "auto") {
          concurrency.value = {
            ...concurrency.value,
            globalSlots: profile.recommendedGlobalSlots,
            perProjectSlots: profile.recommendedPerProject,
            remoteSlots: profile.recommendedRemoteSlots,
          };
        }
      }
    } catch {
      /* local */
    }
    try {
      feishuSyncLevel.value = await loadFeishuSyncLevel();
    } catch {
      /* ignore */
    }
    try {
      bossVerbalDelegate.value = localStorage.getItem("xu.boss.verbalDelegate") === "1";
    } catch {
      /* ignore */
    }
    guiConsent.value = readGuiConsentLocal();
    try {
      agentPrefs.value = await loadAgentPrefs();
    } catch {
      /* ignore */
    }
    try {
      codeExecPrefs.value = await loadCodeExecPrefs();
    } catch {
      /* ignore */
    }
    try {
      softwareAutopilot.value = await loadSoftwareAutopilotPrefs();
    } catch {
      /* ignore */
    }
    void refreshPlaywrightStatus();
    try {
      const days = await getChatRetentionDays();
      retentionDays.value = days;
      retentionNever.value = days <= 0;
    } catch {
      /* ignore */
    }
    try {
      employees.value = await loadEmployees();
      const fromDb = await getDefaultReviewerId();
      if (fromDb) patchDrive({ defaultReviewerId: fromDb });
    } catch {
      /* ignore */
    }
  })();
});

onUnmounted(() => {
  window.removeEventListener("xu-open-activity-log", onOpenActivityLogEvent);
  window.removeEventListener("xu-office-display", refreshHallDisplaySummary);
});
</script>

<template>
  <div class="settings-page fou-settings" :class="{ 'settings-embedded': props.embedded }">
    <div v-if="!props.embedded" class="settings-page-header">
      <div>
        <div class="settings-page-title ui-font">设置</div>
        <div class="settings-page-subtitle">{{ productBrandLabel }} · {{ companyName }}</div>
      </div>
      <PageHelpButton topic="settings.overview" label="帮助" />
    </div>

    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分组">
        <FouButton
          v-for="g in visibleSettingsGroups"
          :key="g.id"
          class="settings-nav-item ui-font qiu-settings-nav-item"
          :class="{ active: activeSettingsGroup === g.id }"
          :icon="g.icon"
          text
          native-type="button"
          @mousedown.stop
          @click.stop="selectSettingsGroup(g.id)"
        >
          {{ g.label }}
        </FouButton>
      </nav>

      <div ref="settingsMainEl" class="settings-main">
        <div class="settings-main-inner settings-form-grid">
          <div v-if="activeSettingsGroup === 'appearance'" class="settings-group">
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">品牌与公司</h2>
            <p class="settings-section-desc">
              产品品牌固定为「{{ BRAND_NAME }}」；运营主体默认「{{ DEFAULT_COMPANY_NAME }}」。公司显示名可改。{{ TRIAL_POLICY.summary }}
            </p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">品牌</span>
            <span class="settings-row-desc">不可修改</span>
          </div>
          <span class="ui-font" style="font-weight: 600">{{ BRAND_NAME }}</span>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">公司名称</span>
            <span class="settings-row-desc">标题栏与欢迎语等处展示</span>
          </div>
          <FouInput
            v-model="companyName"
            :maxlength="COMPANY_NAME_MAX"
            :placeholder="DEFAULT_COMPANY_NAME"
            style="width: 220px"
            @blur="commitCompanyName"
            @keydown.enter="commitCompanyName"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">{{ $t("settings.userAddress") }}</span>
            <span class="settings-row-desc">{{ $t("settings.userAddressDesc") }}</span>
          </div>
          <FouInput
            v-model="userAddress"
            :maxlength="USER_ADDRESS_MAX"
            :placeholder="DEFAULT_USER_ADDRESS"
            style="width: 220px"
            @blur="commitUserAddress"
            @keydown.enter="commitUserAddress"
          />
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">AI 办公室外观</h2>
            <p class="settings-section-desc">
              自定义 3D 大厅远墙大屏（Logo / 墙字）与前台屏风文案；与办公室页「大厅品牌/屏风」共用同一配置。
            </p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">当前文案</span>
            <span class="settings-row-desc">{{ hallDisplaySummaryText }}</span>
          </div>
          <FouButton
            icon="image-edit-line"
            size="small"
            type="primary"
            @click="openHallDisplayFromSettings"
          >
            编辑大厅 Logo / 墙字 / 前台屏风
          </FouButton>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">{{ $t("settings.uiLanguage") }}</h2>
            <p class="settings-section-desc">{{ $t("settings.uiLanguageDesc") }}</p>
          </div>
        </div>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">{{ $t("settings.uiLanguage") }}</span>
          </div>
          <FouSelect
            class="settings-row-control"
            :model-value="uiLocale"
            :options="uiLocaleOptions"
            style="max-width: 280px"
            @update:model-value="(v: string) => setUiLocale(v as 'zh-CN' | 'en-US')"
          />
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">外观风格</h2>
            <p class="settings-section-desc">选择 {{ BRAND_NAME }} 桌面端的整体视觉语言。</p>
          </div>
        </div>
        <div class="theme-card-grid">
          <FouButton
            v-for="item in THEMES"
            :key="item"
            class="theme-card"
            :class="[`theme-card-${item}`, { selected: theme === item }]"
            :icon="THEME_LABELS[item].icon"
            text
            native-type="button"
            :type="theme === item ? 'primary' : 'default'"
            :aria-label="`选择外观风格：${THEME_LABELS[item].name}`"
            @click="setTheme(item)"
          >
            <span class="theme-card-preview"><span /><span /><span /></span>
            <span class="theme-card-body">
              <span class="theme-card-name ui-font">{{ THEME_LABELS[item].name }}</span>
              <span class="theme-card-desc">{{ THEME_LABELS[item].description }}</span>
            </span>
          </FouButton>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">终端背景</h2>
            <p class="settings-section-desc">自定义 TUI 终端面板的背景风格。</p>
          </div>
        </div>
        <div class="terminal-bg-grid">
          <button
            v-for="bg in TERMINAL_BGS"
            :key="bg"
            type="button"
            class="terminal-bg-card"
            :class="[`terminal-bg-card-${bg}`, { selected: terminalBg === bg }]"
            :aria-label="`选择终端背景：${TERMINAL_BG_LABELS[bg].name}`"
            @click="setTerminalBg(bg)"
          >
            <FouIcon icon="terminal-box-line" size="18" />
            <span class="terminal-bg-swatch" />
            <span class="terminal-bg-body">
              <span class="terminal-bg-name ui-font">{{ TERMINAL_BG_LABELS[bg].name }}</span>
              <span class="terminal-bg-desc">{{ TERMINAL_BG_LABELS[bg].description }}</span>
            </span>
          </button>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">字体大小</h2>
            <p class="settings-section-desc">调整界面、终端和文件管理器的文字大小。</p>
          </div>
        </div>
        <div class="font-size-rows">
          <div class="font-size-row">
            <span class="font-size-row-label ui-font">{{ FONT_SIZE_ROW_LABELS.ui }}</span>
            <div class="font-size-chips">
              <FouButton
                v-for="s in FONT_SIZES"
                :key="s"
                :type="uiFontSize === s ? 'primary' : 'default'"
                :icon="s === 'small' ? 'font-size-2' : s === 'large' ? 'font-size' : 'text'"
                size="small"
                @click="applyUiFont(s)"
              >
                {{ FONT_SIZE_LABELS[s] }}
              </FouButton>
            </div>
          </div>
          <div class="font-size-row">
            <span class="font-size-row-label ui-font">{{ FONT_SIZE_ROW_LABELS.terminal }}</span>
            <div class="font-size-chips">
              <FouButton
                v-for="s in FONT_SIZES"
                :key="s"
                :type="terminalFontSize === s ? 'primary' : 'default'"
                icon="terminal-box-line"
                size="small"
                @click="applyTerminalFont(s)"
              >
                {{ FONT_SIZE_LABELS[s] }}
              </FouButton>
            </div>
          </div>
          <div class="font-size-row">
            <span class="font-size-row-label ui-font">{{ FONT_SIZE_ROW_LABELS.fileTree }}</span>
            <div class="font-size-chips">
              <FouButton
                v-for="s in FONT_SIZES"
                :key="s"
                :type="fileTreeFontSize === s ? 'primary' : 'default'"
                icon="folder-line"
                size="small"
                @click="applyFileTreeFont(s)"
              >
                {{ FONT_SIZE_LABELS[s] }}
              </FouButton>
            </div>
          </div>
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'drive'" class="settings-group">
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">编码驾驶（IDE）</h2>
            <p class="settings-section-desc">
              SDK / 键鼠 / 截图投 Cursor 可组合勾选。键鼠必须先同意。
            </p>
          </div>
          <FouButton icon="question-line" size="small" @click="driveHelpOpen = true">说明</FouButton>
        </div>

        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">启用编码驾驶</span>
            <span class="settings-row-desc">总开关；关闭后无法发起驾驶或代点确认</span>
          </div>
          <FouCheckbox
            class="settings-row-toggle"
            :model-value="drive.enabled"
            :disabled="drive.useInputControl && !drive.consentAccepted"
            @update:model-value="(v: boolean) => patchDrive({ enabled: v })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">Cursor SDK</span>
            <span class="settings-row-desc">{{ sdkDriveHint }}</span>
          </div>
          <FouCheckbox
            class="settings-row-toggle"
            :model-value="drive.useSdk"
            :disabled="!cursorSdkAllowed || cursorSdkProbe?.sdkReady === false"
            @update:model-value="(v: boolean) => patchDrive({ useSdk: v })"
          />
        </div>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">Cursor API Key</span>
            <span class="settings-row-desc">
              用于 @cursor/sdk sidecar 派活；仅存本机，不进 git。
              {{ cursorApiKeyConfigured ? "（已配置）" : "（未配置）" }}
            </span>
          </div>
          <div class="settings-row-control look-grid">
            <FouInput
              v-model="cursorApiKeyDraft"
              type="password"
              autocomplete="new-password"
              placeholder="CURSOR_API_KEY"
            />
            <FouButton
              icon="key-2-line"
              size="small"
              native-type="button"
              :loading="cursorApiKeySaving"
              @click="saveCursorApiKey"
            >
              保存 Key
            </FouButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">键鼠驾驶</span>
            <span class="settings-row-desc">实验灰度；须先完成下方风险知情同意</span>
          </div>
          <FouCheckbox
            class="settings-row-toggle"
            :model-value="drive.useInputControl"
            :disabled="!drive.consentAccepted"
            @update:model-value="(v: boolean) => patchDrive({ useInputControl: v })"
          />
        </div>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">写码方式</span>
            <span class="settings-row-desc">
              开工前必须指定。内置：应用内看过程。本机：仅列出 PATH 上已检测到的 CLI；开发开始时打开该 IDE。
            </span>
          </div>
          <div class="settings-row-control look-grid">
            <FouButton
              icon="code-box-line"
              size="small"
              native-type="button"
              :type="codingSurface.defaultSurface === 'builtin' ? 'primary' : 'default'"
              @click="setCodingSurfaceMode('builtin')"
            >
              内置 虚募阁 IDE
            </FouButton>
            <FouButton
              icon="terminal-window-line"
              size="small"
              native-type="button"
              :type="codingSurface.defaultSurface === 'external' ? 'primary' : 'default'"
              @click="setCodingSurfaceMode('external')"
            >
              本机 IDE
            </FouButton>
          </div>
        </div>
        <div
          v-if="codingSurface.defaultSurface === 'external'"
          class="settings-row"
        >
          <div class="settings-row-label">
            <span class="ui-font">本机 IDE</span>
            <span class="settings-row-desc">未检测到 CLI 的项会禁用；点「重新检测」刷新 PATH 探测</span>
          </div>
          <div class="settings-row-field settings-ide-row">
            <FouSelect
              class="settings-ide-select"
              :model-value="codingSurface.externalIde"
              :options="ideSelectOptions"
              @update:model-value="(v: string) => patchCodingSurface({ externalIde: v as typeof codingSurface.externalIde })"
            />
            <FouButton
              icon="refresh-line"
              size="small"
              native-type="button"
              :disabled="probingIde"
              @click="refreshIdeProbe"
            >
              {{ probingIde ? "检测中…" : "重新检测" }}
            </FouButton>
          </div>
        </div>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">IDE CLI</span>
            <span class="settings-row-desc">Agent 用 ide_open 调本机 CLI；选「其他」时必填（如 windsurf / zed）</span>
          </div>
          <FouInput
            ref="ideCliInputRef"
            v-model="ideCliOverride"
            class="settings-row-control"
            placeholder="空=按所选 IDE；其他编辑器填可执行名"
            @change="writeIdeCliOverride(ideCliOverride)"
            @blur="writeIdeCliOverride(ideCliOverride)"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">截图投 Cursor</span>
            <span class="settings-row-desc">代确认时附带 IDE 截图</span>
          </div>
          <FouCheckbox
            class="settings-row-toggle"
            :model-value="drive.useScreenshotToCursor"
            @update:model-value="(v: boolean) => patchDrive({ useScreenshotToCursor: v })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">默认审核员</span>
            <span class="settings-row-desc">代点确认时优先派给指定员工</span>
          </div>
          <FouSelect
            class="settings-row-field"
            :model-value="drive.defaultReviewerId ?? ''"
            :options="reviewerSelectOptions"
            @update:model-value="(v: string) => patchDrive({ defaultReviewerId: v || null })"
          />
        </div>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">窗口白名单</span>
            <span class="settings-row-desc">逗号分隔窗口标题关键词；优先 UIA 元素点击，坐标仅兜底</span>
          </div>
          <FouInput
            class="settings-row-control"
            :model-value="drive.windowWhitelist.join(', ')"
            @update:model-value="
              (v: string) =>
                patchDrive({
                  windowWhitelist: v
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
            "
          />
          <div class="settings-section-actions">
            <FouButton
              v-for="chip in GUI_WHITELIST_PRESETS"
              :key="chip"
              icon="add-line"
              size="small"
              @click="addGuiWhitelistPreset(chip)"
            >
              {{ chip }}
            </FouButton>
          </div>
        </div>
        <div class="settings-row settings-row--consent">
          <div class="settings-row-label">
            <span class="ui-font">键鼠风险知情同意</span>
            <span class="settings-row-desc">启用键鼠驾驶前须阅读并同意风险说明</span>
          </div>
          <div class="settings-row-consent-actions">
            <FouButton icon="alert-line" size="small" @click="driveRiskOpen = true">
              查看键鼠风险并同意
            </FouButton>
            <FouCheckbox
              class="settings-row-toggle"
              :model-value="drive.consentAccepted"
              @update:model-value="
                (v: boolean) => {
                  if (v) driveRiskOpen = true;
                  else patchDrive({ consentAccepted: false, enabled: false, useInputControl: false });
                }
              "
            >
              已同意
            </FouCheckbox>
          </div>
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'concurrency'" class="settings-group">
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">执行并发（按本机性能）</h2>
            <p class="settings-section-desc">
              首次探测会保存本机档案（CPU/内存/显卡），7 天内启动直接套用，不再跑显卡探测。
              本地模型员工与远程 API 员工分两套槽；远程不占显存，但仍限制同时流式人数以免办公室卡顿。
            </p>
          </div>
          <div class="settings-section-actions">
            <PageHelpButton topic="settings.concurrency" label="说明" />
            <FouButton
              icon="radar-line"
              size="small"
              native-type="button"
              :loading="probingCap"
              @click="runAutoSlots"
            >
              探测并自动
            </FouButton>
            <FouButton
              type="primary"
              icon="save-line"
              size="small"
              :loading="savingConcurrency"
              @click="persistConcurrency"
            >
              保存
            </FouButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">模式</span>
            <span class="settings-row-desc">自动=按已保存的本机档案；点「探测并自动」才重新测。手动=固定槽位</span>
          </div>
          <div class="brain-source-row">
            <FouButton
              icon="magic-line"
              size="small"
              native-type="button"
              :type="concurrency.mode === 'auto' ? 'primary' : 'default'"
              @click="concurrency.mode = 'auto'"
            >
              自动
            </FouButton>
            <FouButton
              icon="equalizer-line"
              size="small"
              native-type="button"
              :type="concurrency.mode === 'manual' ? 'primary' : 'default'"
              @click="concurrency.mode = 'manual'"
            >
              手动
            </FouButton>
          </div>
        </div>
        <p v-if="hostCap" class="settings-row-desc" style="margin: 0 0 8px">
          上次探测：{{ formatHostProbeTime(hostCap.probedAtMs ?? 0) }}。{{ hostCap.rationale }}
        </p>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">本地员工槽</span>
            <span class="settings-row-desc">同时跑本地模型（Ollama / 本机地址）的人数，受显存/内存限制</span>
          </div>
          <div class="brain-source-row">
            <FouButton
              v-for="n in [1, 2, 3, 4]"
              :key="n"
              :icon="concurrency.globalSlots === n ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'"
              size="small"
              native-type="button"
              :disabled="concurrency.mode === 'auto'"
              :type="concurrency.globalSlots === n ? 'primary' : 'default'"
              @click="concurrency.globalSlots = n"
            >
              {{ n }}
            </FouButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">每项目上限</span>
            <span class="settings-row-desc">同一项目最多同时跑几个员工</span>
          </div>
          <div class="brain-source-row">
            <FouButton
              v-for="n in [1, 2, 3, 4]"
              :key="'p' + n"
              :icon="concurrency.perProjectSlots === n ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'"
              size="small"
              native-type="button"
              :disabled="concurrency.mode === 'auto'"
              :type="concurrency.perProjectSlots === n ? 'primary' : 'default'"
              @click="concurrency.perProjectSlots = n"
            >
              {{ n }}
            </FouButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">远程流式槽</span>
            <span class="settings-row-desc">同时跑远程 API 员工的人数；不占显存，但人一多办公室会卡</span>
          </div>
          <div class="brain-source-row">
            <FouButton
              v-for="n in [1, 2, 3, 4]"
              :key="'r' + n"
              :icon="concurrency.remoteSlots === n ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'"
              size="small"
              native-type="button"
              :disabled="concurrency.mode === 'auto'"
              :type="concurrency.remoteSlots === n ? 'primary' : 'default'"
              @click="concurrency.remoteSlots = n"
            >
              {{ n }}
            </FouButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">开工并行数</span>
            <span class="settings-row-desc">全体开工时每批同时派活人数（1–128；自动探测写入 1–2）</span>
          </div>
          <FouInput
            :model-value="String(concurrency.kickoffParallel)"
            type="number"
            min="1"
            max="128"
            style="width: 120px"
            @update:model-value="
              (v: string) => {
                const n = Math.min(128, Math.max(1, Math.floor(Number(v) || 1)));
                concurrency.kickoffParallel = n;
              }
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">单次开工人数上限</span>
            <span class="settings-row-desc">自动探测按内存写入（约 8GB→4、16GB→8、32GB+→12）；0 = 不限制</span>
          </div>
          <FouInput
            :model-value="String(concurrency.kickoffMaxEmployees)"
            type="number"
            min="0"
            max="999"
            style="width: 120px"
            @update:model-value="
              (v: string) => {
                const n = Math.floor(Number(v) || 0);
                concurrency.kickoffMaxEmployees = n <= 0 ? 0 : Math.min(999, n);
              }
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">远程 API 不限流（高级）</span>
            <span class="settings-row-desc">默认关闭。开启后远程跳过流式槽；人一多办公室仍会卡，请慎用</span>
          </div>
          <FouSwitch
            :model-value="concurrency.remoteUnlimited"
            @update:model-value="(v: boolean) => (concurrency.remoteUnlimited = v)"
          />
        </div>
        <div v-if="hostCap" class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">本地模型 QPS</span>
            <span class="settings-row-desc">
              按 CPU/RAM/GPU 与模型体量自动估算；并发 HTTP {{ hostCap.recommendedLocalLlmSlots }} 路
            </span>
          </div>
          <div class="brain-source-row ui-font">
            ≈ {{ hostCap.recommendedLocalQps }} req/s
            <span v-if="hostCap.gpuVramGb" class="settings-row-desc">
              · GPU {{ hostCap.gpuVramGb }}GB
            </span>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">飞书同步级别</span>
            <span class="settings-row-desc">员工交付/回复是否镜像到飞书群</span>
          </div>
          <div class="brain-source-row">
            <FouButton
              v-for="opt in [
                { id: 'all', label: '全部' },
                { id: 'boss_only', label: '拍板+交付' },
                { id: 'meeting_only', label: '仅开会' },
              ]"
              :key="opt.id"
              icon="chat-upload-line"
              size="small"
              native-type="button"
              :type="feishuSyncLevel === opt.id ? 'primary' : 'default'"
              @click="
                feishuSyncLevel = opt.id as FeishuSyncLevel;
                void saveFeishuSyncLevel(feishuSyncLevel);
              "
            >
              {{ opt.label }}
            </FouButton>
          </div>
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'agent'" class="settings-group">
      <section class="settings-section settings-section--highlight">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">软件自动驾驶</h2>
            <p class="settings-section-desc">
              软件项目各波次自动推进（少经 Boss 逐步确认）。<strong>默认关闭</strong>。
            </p>
          </div>
        </div>
        <div class="software-autopilot-risk ui-font" role="alert">
          <FouIcon icon="error-warning-fill" class="software-autopilot-risk-icon" />
          <p class="software-autopilot-risk-text">
            {{ SOFTWARE_AUTOPILOT_RISK_BANNER }}
          </p>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">开启软件自动驾驶</span>
            <span class="settings-row-desc">默认关闭；须先完成下方风险知情同意</span>
          </div>
          <FouCheckbox
            class="settings-row-control"
            :model-value="softwareAutopilot.enabled"
            :disabled="!softwareAutopilot.riskAcknowledged"
            @update:model-value="(v: boolean) => void persistSoftwareAutopilot({ enabled: Boolean(v) })"
          />
        </div>
        <div class="settings-row settings-row--stacked settings-row--consent">
          <div class="settings-row-label">
            <span class="ui-font">风险知情同意</span>
            <span class="settings-row-desc">启用前须阅读并同意风险说明</span>
          </div>
          <div class="settings-row-consent-actions">
            <FouButton
              icon="alert-line"
              size="small"
              native-type="button"
              @click="softwareAutopilotRiskOpen = true"
            >
              查看风险并同意
            </FouButton>
            <FouCheckbox
              class="settings-row-control"
              :model-value="softwareAutopilot.riskAcknowledged"
              @update:model-value="
                (v: boolean) => {
                  if (v) softwareAutopilotRiskOpen = true;
                  else void persistSoftwareAutopilot({ riskAcknowledged: false, enabled: false });
                }
              "
            />
          </div>
        </div>
      </section>
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">Agent 策略</h2>
            <p class="settings-section-desc">执行审批、压缩、Playwright QA 与工作区撤销</p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">Agent 执行策略</span>
            <span class="settings-row-desc">只读看文件；标准可改本项目（危险操作仍要你点头）；信任少打断仍不出项目目录</span>
          </div>
          <div class="brain-source-row">
            <FouButton
              v-for="opt in EXEC_POLICY_OPTIONS"
              :key="opt.id"
              icon="shield-check-line"
              size="small"
              native-type="button"
              :type="agentPrefs.execPolicy === opt.id ? 'primary' : 'default'"
              :title="opt.description"
              @click="void persistAgentPrefs({ execPolicy: opt.id as ExecPolicy })"
            >
              {{ opt.label }}
            </FouButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">本地模型流式输出</span>
            <span class="settings-row-desc">Ollama 逐 token 推送；失败时自动回退非流式</span>
          </div>
          <FouCheckbox
            :model-value="agentPrefs.localStream"
            @update:model-value="(v: boolean) => void persistAgentPrefs({ localStream: Boolean(v) })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">LLM 上下文摘要压缩</span>
            <span class="settings-row-desc">上下文过长时先调模型摘要，再回退内置压缩</span>
          </div>
          <FouCheckbox
            :model-value="agentPrefs.llmCompact"
            @update:model-value="(v: boolean) => void persistAgentPrefs({ llmCompact: Boolean(v) })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">IDE 安全完成门禁（实验，已暂停）</span>
            <span class="settings-row-desc">
              曾导致日常写码被「缺少 patch/typecheck…」硬拦；1.0.2 起已停用硬拦截，开关不会再生效。
            </span>
          </div>
          <FouCheckbox
            :model-value="false"
            :disabled="true"
            @update:model-value="() => undefined"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">高级代码环（Codex 能力对齐）</span>
            <span class="settings-row-desc"
              >对代码岗加强 apply_patch / Skills / 验收自检提示（走虚募阁内置智能体，非外挂 CLI 主路径）</span>
            >
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.enhancedCodeLoop"
            @update:model-value="(v: boolean) => void persistCodeExecPrefs({ enhancedCodeLoop: Boolean(v) })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">交活后验收速检</span>
            <span class="settings-row-desc">员工完成后对照 Brief 验收抽样落盘，结果写入办公室</span>
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.acceptanceReviewOnDone"
            @update:model-value="
              (v: boolean) => void persistCodeExecPrefs({ acceptanceReviewOnDone: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">弱项自动返工</span>
            <span class="settings-row-desc"
              >验收速检发现弱项时自动派 QA 返工（每项目 15 分钟冷却；默认关）</span
            >
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.acceptanceAutoReworkOnMiss"
            @update:model-value="
              (v: boolean) => void persistCodeExecPrefs({ acceptanceAutoReworkOnMiss: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">派活本地预检索</span>
            <span class="settings-row-desc"
              >派活前按 Brief 关键词 grep 工作区，注入 LOCAL_CONTEXT_PACK（非向量 RAG）</span
            >
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.projectContextRetrievalOnDispatch"
            @update:model-value="
              (v: boolean) =>
                void persistCodeExecPrefs({ projectContextRetrievalOnDispatch: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">语义-lite 索引（PoC）</span>
            <span class="settings-row-desc"
              >确认 Brief 时建 TF 余弦索引；派活注入 SEMANTIC_CONTEXT_PACK（默认关，非 embedding API）</span
            >
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.projectSemanticIndexEnabled"
            @update:model-value="
              (v: boolean) => void persistCodeExecPrefs({ projectSemanticIndexEnabled: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">向量 Embedding 索引</span>
            <span class="settings-row-desc"
              >走工作脑 /embeddings（Ollama nomic-embed-text 等）；确认 Brief 建索引，派活注入 EMBEDDING_CONTEXT_PACK（默认关）</span
            >
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.projectEmbeddingIndexEnabled"
            @update:model-value="
              (v: boolean) => void persistCodeExecPrefs({ projectEmbeddingIndexEnabled: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">Embedding 模型（可选）</span>
            <span class="settings-row-desc">留空则按 baseUrl 自动选（Ollama→nomic-embed-text）</span>
          </div>
          <FouInput
            :model-value="codeExecPrefs.embeddingModel"
            placeholder="如 nomic-embed-text"
            class="settings-input-narrow"
            @update:model-value="
              (v: string) => void persistCodeExecPrefs({ embeddingModel: String(v || '') })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">确认需求生成架构草稿</span>
            <span class="settings-row-desc"
              >软件项目确认 Brief 后写入 .xu/ARCHITECTURE_BRIEF.md（含 XU_ARCHITECTURE_BRIEF）</span
            >
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.architectureBriefOnConfirm"
            @update:model-value="
              (v: boolean) => void persistCodeExecPrefs({ architectureBriefOnConfirm: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">架构草稿自动派规划岗审阅</span>
            <span class="settings-row-desc"
              >生成架构草稿后自动派规划/产品岗 read_file 审阅（默认开）</span
            >
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.architectureReviewOnConfirm"
            @update:model-value="
              (v: boolean) => void persistCodeExecPrefs({ architectureReviewOnConfirm: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">提示可用本机 codex 命令</span>
            <span class="settings-row-desc">仅提示 shell 可选用；不作为产品默认执行器</span>
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.hintExternalCodexCli"
            @update:model-value="
              (v: boolean) => void persistCodeExecPrefs({ hintExternalCodexCli: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">代码岗放权提示</span>
            <span class="settings-row-desc">代码岗默认提示：本项目内可连续改文件；删文件、危险命令、Git 推送仍要你点头</span>
          </div>
          <FouCheckbox
            :model-value="codeExecPrefs.codeRoleRelaxedApproval"
            @update:model-value="
              (v: boolean) => void persistCodeExecPrefs({ codeRoleRelaxedApproval: Boolean(v) })
            "
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">Playwright QA 环境</span>
            <span class="settings-row-desc">
              <template v-if="playwrightStatus?.ready">
                浏览器自动化环境已就绪
              </template>
              <template v-else-if="playwrightStatus">
                未就绪（需本机安装 Node LTS 后点「安装 Playwright」）
              </template>
              <template v-else>检测中…</template>
            </span>
          </div>
          <div class="brain-source-row">
            <FouButton
              icon="refresh-line"
              size="small"
              native-type="button"
              @click="void refreshPlaywrightStatus()"
            >
              检测
            </FouButton>
            <FouButton
              icon="download-cloud-line"
              size="small"
              native-type="button"
              type="primary"
              :loading="playwrightInstalling"
              @click="void runPlaywrightInstall()"
            >
              安装
            </FouButton>
          </div>
        </div>
        <p v-if="playwrightMsg" class="settings-row-desc">{{ playwrightMsg }}</p>
        <p
          v-if="playwrightStatus?.qaHome"
          class="settings-row-desc"
        >
          脚本与浏览器目录：{{ playwrightStatus.qaHome }}（browsers：{{ playwrightStatus.browsersPath || "…/browsers" }}）
        </p>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">撤销上一批工具改动</span>
            <span class="settings-row-desc">恢复员工工作区 `.xu/snapshots` 最近一批写盘快照</span>
          </div>
          <FouButton
            icon="arrow-go-back-line"
            size="small"
            native-type="button"
            :loading="undoLoading"
            @click="void runWorkspaceUndo()"
          >
            撤销
          </FouButton>
        </div>
        <p v-if="undoMsg" class="settings-row-desc">{{ undoMsg }}</p>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">Boss 口头授权即放权</span>
            <span class="settings-row-desc">办公室/飞书说「可以操作电脑」后，规则内免逐次审批</span>
          </div>
          <FouCheckbox
            :model-value="bossVerbalDelegate"
            @update:model-value="(v: boolean) => setBossVerbalDelegate(Boolean(v))"
          />
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'confirm'" class="settings-group">
            <section class="settings-section">
              <div class="settings-section-header">
                <div>
                  <h2 class="settings-section-title ui-font">开会熔断</h2>
                  <p class="settings-section-desc">
                    防止 AI 员工开会无限辩论。触发后强制升级老板拍板，并写入可追溯系统结论。
                  </p>
                </div>
                <PageHelpButton topic="settings.confirm-policy" label="说明" />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">启用开会熔断</span>
                  <span class="settings-row-desc">默认开启；关闭后仅保留经理→老板升级链</span>
                </div>
                <FouCheckbox
                  :model-value="meetingFuseSettings.enabled"
                  @update:model-value="(v: boolean) => persistMeetingFuse({ enabled: Boolean(v) })"
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">最大辩论轮次</span>
                  <span class="settings-row-desc">默认 6；达到后强制老板拍板</span>
                </div>
                <FouInput
                  type="number"
                  class="settings-input-narrow"
                  :model-value="String(meetingFuseSettings.maxRounds)"
                  @update:model-value="
                    (v: string) => persistMeetingFuse({ maxRounds: Number(v) || 6 })
                  "
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">墙钟超时（秒）</span>
                  <span class="settings-row-desc">默认 900（15 分钟）</span>
                </div>
                <FouInput
                  type="number"
                  class="settings-input-narrow"
                  :model-value="String(meetingFuseSettings.timeoutSec)"
                  @update:model-value="
                    (v: string) => persistMeetingFuse({ timeoutSec: Number(v) || 900 })
                  "
                />
              </div>
            </section>
            <section class="settings-section">
              <div class="settings-section-header">
                <div>
                  <h2 class="settings-section-title ui-font">老板未答复提醒</h2>
                  <p class="settings-section-desc">
                    员工开会等您拍板超过设定时间后：本机提示音 + 飞书/企微等已连接通道再次通知。可选本机语音朗读（非外呼电话）。
                  </p>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">启用未答复提醒</span>
                  <span class="settings-row-desc">默认开启；关闭后仅保留首次开会通知</span>
                </div>
                <FouCheckbox
                  :model-value="bossReplyWatchSettings.enabled"
                  @update:model-value="(v: boolean) => persistBossReplyWatch({ enabled: Boolean(v) })"
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">未答复超时（秒）</span>
                  <span class="settings-row-desc">默认 600（10 分钟）</span>
                </div>
                <FouInput
                  type="number"
                  class="settings-input-narrow"
                  :model-value="String(bossReplyWatchSettings.noReplySec)"
                  @update:model-value="
                    (v: string) => persistBossReplyWatch({ noReplySec: Number(v) || 600 })
                  "
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">重复提醒间隔（秒）</span>
                  <span class="settings-row-desc">默认 300；同一员工在此间隔内不重复催</span>
                </div>
                <FouInput
                  type="number"
                  class="settings-input-narrow"
                  :model-value="String(bossReplyWatchSettings.repeatSec)"
                  @update:model-value="
                    (v: string) => persistBossReplyWatch({ repeatSec: Number(v) || 300 })
                  "
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">本机提示音</span>
                </div>
                <FouCheckbox
                  :model-value="bossReplyWatchSettings.playSound"
                  @update:model-value="(v: boolean) => persistBossReplyWatch({ playSound: Boolean(v) })"
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">本机语音朗读</span>
                  <span class="settings-row-desc">系统朗读一句提醒；不是拨打手机或 IM 语音电话</span>
                </div>
                <FouCheckbox
                  :model-value="bossReplyWatchSettings.voicePrompt"
                  @update:model-value="(v: boolean) => persistBossReplyWatch({ voicePrompt: Boolean(v) })"
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">IM 再次通知</span>
                  <span class="settings-row-desc">飞书/企微等首选通道；办公室协作条可手动点「催老板」</span>
                </div>
                <FouCheckbox
                  :model-value="bossReplyWatchSettings.imNotify"
                  @update:model-value="(v: boolean) => persistBossReplyWatch({ imNotify: Boolean(v) })"
                />
              </div>
            </section>
            <section class="settings-section">
              <div class="settings-section-header">
                <div>
                  <h2 class="settings-section-title ui-font">协作拓扑</h2>
                  <p class="settings-section-desc">
                    hierarchical：员工→经理→老板。mesh：同级互评，经理裁决延后至熔断或显式升级。
                  </p>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">拓扑模式</span>
                </div>
                <div class="settings-inline-actions">
                  <FouButton
                    icon="organization-chart"
                    size="small"
                    :type="officeTopology === 'hierarchical' ? 'primary' : 'default'"
                    @click="persistOfficeTopology('hierarchical')"
                  >
                    层级
                  </FouButton>
                  <FouButton
                    icon="share-line"
                    size="small"
                    :type="officeTopology === 'mesh' ? 'primary' : 'default'"
                    @click="persistOfficeTopology('mesh')"
                  >
                    同级互评
                  </FouButton>
                </div>
              </div>
              <p class="settings-row-desc" style="margin: 8px 0 0">
                岗位扩展工具：由角色包声明可用范围（空=禁止；全部；或指定工具列表）。项目须另开扩展工具总闸。
              </p>
            </section>
            <section class="settings-section">
              <div class="settings-section-header">
                <div>
                  <h2 class="settings-section-title ui-font">老板确认策略</h2>
                  <p class="settings-section-desc">
                    决定 XU_NEED_CONFIRM 由经理审还是必须老板拍板。设计确认、发版门禁等硬闸不会被绕过。
                  </p>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">单模型额度（元）</span>
                  <span class="settings-row-desc"
                    >途中写作：单个模型累计费用 ≥ 此值 → 直接断开；重开须老板确认。默认 5000（文案含金额亦用此阈值升级老板）</span
                  >
                </div>
                <FouInput
                  type="number"
                  class="settings-input-narrow"
                  :model-value="String(bossConfirmPolicy.amountThresholdYuan)"
                  @update:model-value="
                    (v: string) =>
                      persistBossConfirmPolicy({ amountThresholdYuan: Number(v) || 0 })
                  "
                />
              </div>
              <div v-if="writingQuotaLock" class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">额度已断连</span>
                  <span class="settings-row-desc"
                    >模型「{{ writingQuotaLock }}」已触顶断开。老板确认后可重开连接。</span
                  >
                </div>
                <FouButton
                  type="primary"
                  icon="shield-check-line"
                  size="small"
                  :loading="writingQuotaUnlockBusy"
                  @click="unlockWritingQuotaByBoss"
                >
                  老板确认并重开
                </FouButton>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">跨模块必老板</span>
                </div>
                <FouCheckbox
                  :model-value="bossConfirmPolicy.requireBossForCrossModule"
                  @update:model-value="
                    (v: boolean) =>
                      persistBossConfirmPolicy({ requireBossForCrossModule: Boolean(v) })
                  "
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">发布/上线必老板</span>
                </div>
                <FouCheckbox
                  :model-value="bossConfirmPolicy.requireBossForRelease"
                  @update:model-value="
                    (v: boolean) => persistBossConfirmPolicy({ requireBossForRelease: Boolean(v) })
                  "
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">付款/合规类必老板</span>
                  <span class="settings-row-desc">匹配付款、合规、等保、开票、删库等关键词</span>
                </div>
                <FouCheckbox
                  :model-value="bossConfirmPolicy.requireBossForPaymentOrCompliance"
                  @update:model-value="
                    (v: boolean) =>
                      persistBossConfirmPolicy({
                        requireBossForPaymentOrCompliance: Boolean(v),
                      })
                  "
                />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">低风险可由经理裁决</span>
                  <span class="settings-row-desc">无上述命中且有经理时不强制老板</span>
                </div>
                <FouCheckbox
                  :model-value="bossConfirmPolicy.lowRiskAutoManagerDecide"
                  @update:model-value="
                    (v: boolean) =>
                      persistBossConfirmPolicy({ lowRiskAutoManagerDecide: Boolean(v) })
                  "
                />
              </div>
            </section>
          </div>

          <div v-if="activeSettingsGroup === 'memory'" class="settings-group">
      <section class="settings-section settings-section--highlight">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">让虚募阁更懂您</h2>
            <p class="settings-section-desc">
              本地模型权重不会变；变的是虚募阁记住的内容和派活方式。按下面三步即可越用越贴您。
            </p>
          </div>
          <PageHelpButton topic="settings.get-smarter" label="说明" />
        </div>
        <ol class="get-smarter-steps ui-font">
          <li>
            <strong>换更强模型</strong> — 设置 → 模型，选快 / 均衡 / 强并测通
            <FouButton
              icon="brain-line"
              size="small"
              native-type="button"
              style="margin-left: 8px"
              @click="selectSettingsGroup('models')"
            >
              打开模型
            </FouButton>
          </li>
          <li>
            <strong>记住重要规则</strong> — 对话或办公室点「记住」、发送 /记住，并保持下方「回合末自动抽取」开启
            <FouButton
              icon="mind-map"
              size="small"
              native-type="button"
              style="margin-left: 8px"
              @click="router.push('/memory')"
            >
              打开记忆页
            </FouButton>
          </li>
          <li>
            <strong>反复用同一岗位</strong> — 任务成功后「模式」与常用手法会沉淀，下次派活自动带上
          </li>
        </ol>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">进阶训练</h2>
            <p class="settings-section-desc">
              教员工做事 / 扩展工具用法，<strong>不训练模型权重</strong>；评测并晋级后才会影响派活
            </p>
          </div>
          <FouButton
            :icon="advancedTrainingOpen ? 'arrow-up-s-line' : 'arrow-down-s-line'"
            size="small"
            native-type="button"
            @click="advancedTrainingOpen = !advancedTrainingOpen"
          >
            {{ advancedTrainingOpen ? "收起" : "展开" }}
          </FouButton>
        </div>
        <div v-show="advancedTrainingOpen" class="advanced-training-actions">
          <FouButton
            icon="plug-line"
            size="small"
            native-type="button"
            :disabled="!hasEnabledMcp"
            :title="hasEnabledMcp ? '' : '请先在设置 → MCP 添加并启用扩展工具'"
            @click="openSimpleTraining('mcp')"
          >
            扩展工具用法（进阶）
          </FouButton>
          <FouButton
            icon="user-star-line"
            size="small"
            native-type="button"
            @click="openSimpleTraining('employee')"
          >
            岗位示例与评分（进阶）
          </FouButton>
          <p v-if="!hasEnabledMcp" class="settings-row-desc ui-font">
            扩展工具用法须先配置并启用 MCP Server；未配置时可先使用岗位示例与评分。
          </p>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">超长记忆</h2>
            <p class="settings-section-desc">
              对话或派活结束后结构化抽取偏好/决策/约束写入记忆库；上下文压缩时写入滚动会话摘要
            </p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">回合末自动抽取</span>
            <span class="settings-row-desc"
              >长回合结束后写入本机记忆库（智能抽取，失败则简化保存；可用「记住」或 /记住 手动写入）</span
            >
          </div>
          <FouCheckbox
            :model-value="memoryAutoExtract"
            @update:model-value="(v: boolean) => void saveMemoryAutoExtract(Boolean(v))"
          />
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'mcp'" class="settings-group">
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">MCP Server</h2>
            <p class="settings-section-desc">stdio 子进程；Agent 工具名前缀 mcp__{server}__{tool}，受项目 toolPolicy.mcp 约束</p>
          </div>
          <FouButton icon="refresh-line" size="small" @click="void refreshMcpServers()">刷新</FouButton>
          <FouButton
            icon="graduation-cap-line"
            size="small"
            :disabled="!hasEnabledMcp"
            :title="hasEnabledMcp ? '' : '请先添加并启用 MCP Server'"
            @click="openSimpleTraining('mcp')"
          >
            扩展工具用法（进阶）
          </FouButton>
        </div>
        <p class="settings-row-desc ui-font" style="margin-top: 4px">
          MCP 是工具扩展，不调聪明度。进阶用法库写何时用 / 勿用 / 场景，永久保存在本机；须评测并晋级后才注入派活。
          <template v-if="!hasEnabledMcp"> 尚未启用 MCP 时此按钮不可用。</template>
        </p>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">训练数据目录</span>
            <span class="settings-row-desc">
              读写与导出/导入均使用此目录（非软件安装目录，升级不覆盖）。当前：<code>{{ trainingDataDirLabel }}</code>
            </span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <FouButton
              icon="folder-open-line"
              size="small"
              :loading="trainingDirBusy"
              @click="void pickTrainingDataDirSetting()"
            >
              选择目录
            </FouButton>
            <FouButton
              icon="folder-3-line"
              size="small"
              :loading="trainingDirBusy"
              @click="void openTrainingDataDirSetting()"
            >
              打开目录
            </FouButton>
            <FouButton
              v-if="trainingDirCustom"
              icon="restart-line"
              size="small"
              :loading="trainingDirBusy"
              @click="void resetTrainingDataDirSetting()"
            >
              恢复默认
            </FouButton>
          </div>
        </div>
        <ul v-if="mcpServers.length" class="settings-audit-list">
          <li v-for="s in mcpServers" :key="s.id" class="settings-audit-item">
            <strong>{{ s.name }}</strong>
            <span class="settings-row-desc">{{ s.command }} {{ s.args.join(" ") }}</span>
            <span class="settings-row-desc">
              超时 {{ s.timeoutMs || 30000 }}ms · 工具默认高风险逐次审批 · 进程按 Server 复用
            </span>
            <FouButton icon="delete-bin-line" size="small" @click="removeMcpServer(s.id)">删除</FouButton>
          </li>
        </ul>
        <p v-else class="settings-row-desc">尚未配置 MCP Server</p>
        <div class="settings-row settings-row--stacked">
          <FouButton icon="palette-line" size="small" :loading="mcpSaving" @click="addDesignMcpPreset">
            添加设计交付助手
          </FouButton>
          <FouButton icon="box-3-line" size="small" :loading="mcpSaving" @click="addBlenderMcpPreset">
            添加 Blender 三维宿主
          </FouButton>
          <FouButton icon="shape-line" size="small" :loading="mcpSaving" @click="addMaxMcpPreset">
            添加 3ds Max 三维宿主
          </FouButton>
          <p class="settings-row-desc">
            批导出脚本会启动本机 Photoshop（须逐步审批）。若 PS 不在默认路径，可在系统环境变量中设置
            XU_PS_EXE；Corel 可设置 XU_COREL_PROG_ID。
          </p>
          <FouInput v-model="mcpDraftName" placeholder="显示名称" />
          <FouInput v-model="mcpDraftCommand" placeholder="启动命令（如 npx）" />
          <FouInput v-model="mcpDraftArgs" placeholder="参数（空格分隔）" />
          <FouButton icon="add-line" :loading="mcpSaving" @click="addMcpServer">添加</FouButton>
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'security'" class="settings-group">
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">安全与审计</h2>
            <p class="settings-section-desc">Shell 命令、写盘、审批与策略拒绝等安全事件</p>
          </div>
          <FouButton icon="refresh-line" size="small" :loading="securityAuditLoading" @click="void refreshSecurityAudit()">
            刷新
          </FouButton>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">GUI 驾驶实验灰度</span>
            <span class="settings-row-desc">
              默认关闭。含 UIA 元素点击与坐标 fallback，均标记 experimental，非正式发布。
            </span>
          </div>
          <FouCheckbox
            :model-value="guiExperimental"
            @update:model-value="(v: boolean) => void onGuiExperimental(Boolean(v))"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">桌面 GUI 自动化同意</span>
            <span class="settings-row-desc">仅灰度开启后可同意；每个输入步骤仍需审批和目标窗口绑定</span>
          </div>
          <FouCheckbox
            :model-value="guiConsent"
            :disabled="!guiExperimental"
            @update:model-value="(v: boolean) => onGuiConsent(Boolean(v))"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">GUI 急停</span>
            <span class="settings-row-desc">
              检测到真实键鼠时会锁停；人工检查目标窗口后才能复位，不自动恢复。
            </span>
          </div>
          <div class="settings-section-actions">
            <FouButton type="danger" icon="stop-circle-line" @click="void stopGuiNow()">
              立即急停
            </FouButton>
            <FouButton
              icon="restart-line"
              :disabled="!guiEmergencyStopped"
              @click="void resetGuiStop()"
            >
              人工复位
            </FouButton>
          </div>
        </div>
        <ul v-if="securityAudit.length" class="settings-audit-list">
          <li v-for="(e, i) in securityAudit" :key="i" class="settings-audit-item">
            <span class="ui-font">{{ new Date(e.ts).toLocaleString() }}</span>
            <strong>{{ e.kind }}</strong>
            <span v-if="e.toolName">{{ auditToolLabel(e.toolName, e.detail) }}</span>
            <span class="settings-row-desc">{{ sanitizeUserDisplayText(e.detail) }}</span>
            <span>{{ e.outcome }}</span>
          </li>
        </ul>
        <p v-else class="settings-row-desc">暂无审计记录</p>
      </section>

      <section id="activity-log-section" class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">活动日志</h2>
            <p class="settings-section-desc">
              澄清、写文件、模型读取、整仓警告与中止记录
            </p>
          </div>
          <div class="settings-section-actions">
            <FouButton icon="refresh-line" size="small" :loading="activityLogLoading" @click="void refreshActivityLog()">
              刷新
            </FouButton>
            <FouButton icon="download-line" size="small" @click="void exportActivityLog()">
              导出
            </FouButton>
          </div>
        </div>
        <div class="psc-mode-row settings-activity-filters">
          <FouButton
            icon="list-check-2"
            size="small"
            :type="activityLogFilter === 'all' ? 'primary' : 'default'"
            @click="activityLogFilter = 'all'"
          >
            全部
          </FouButton>
          <FouButton
            icon="file-edit-line"
            size="small"
            :type="activityLogFilter === 'file_change' ? 'primary' : 'default'"
            @click="activityLogFilter = 'file_change'"
          >
            本软件改动
          </FouButton>
          <FouButton
            icon="file-search-line"
            size="small"
            :type="activityLogFilter === 'bulk_read' ? 'primary' : 'default'"
            @click="activityLogFilter = 'bulk_read'"
          >
            模型读取
          </FouButton>
          <FouButton
            icon="stop-circle-line"
            size="small"
            :type="activityLogFilter === 'halt' ? 'primary' : 'default'"
            @click="activityLogFilter = 'halt'"
          >
            已中止
          </FouButton>
        </div>
        <ul v-if="filteredActivityLog.length" class="settings-audit-list">
          <li
            v-for="(e, i) in filteredActivityLog"
            :key="`${e.ts}-${i}`"
            class="settings-audit-item settings-activity-item"
          >
            <button
              type="button"
              class="settings-activity-head ui-font"
              :aria-label="`${activityLogExpanded === e.ts ? '收起' : '展开'}活动：${e.title}`"
              @click="toggleActivityDetail(e.ts)"
            >
              <FouIcon :icon="activityLogExpanded === e.ts ? 'arrow-up-s-line' : 'arrow-down-s-line'" size="16" />
              <span>{{ new Date(e.ts).toLocaleString() }}</span>
              <strong>{{ e.title }}</strong>
              <span class="settings-row-desc">{{ e.kind }}</span>
              <span v-if="e.outcome">{{ e.outcome }}</span>
            </button>
            <div v-if="activityLogExpanded === e.ts" class="settings-activity-detail ui-font">
              <p v-if="e.detail">{{ sanitizeUserDisplayText(e.detail) }}</p>
              <p v-if="e.paths?.length">相关文件：{{ auditPathNames(e.paths) }}</p>
              <p v-if="e.bytes">约 {{ Math.round((e.bytes || 0) / 1024) }} KB</p>
            </div>
          </li>
        </ul>
        <p v-else class="settings-row-desc">暂无活动记录</p>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'models'" class="settings-group">
      <OpsBrainsSettingsSection
        v-model:employee-work-api="employeeWorkApi"
        @saved="onModelProfilesSaved"
      />
      <ModelProfileEditor
        v-model:employee-work-api="employeeWorkApi"
        @saved="onModelProfilesSaved"
      />

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">Token 套餐</h2>
            <p class="settings-section-desc">
              统计对话与派活消耗；达到硬限后禁止继续调用模型，并提示补充额度或暂停工作。
            </p>
          </div>
          <div class="settings-section-actions">
            <FouButton icon="refresh-line" size="small" @click="refreshTokenStatus">刷新</FouButton>
          </div>
        </div>
        <p v-if="tokenStatus" class="settings-row-desc ui-font" :class="{ 'token-warn': tokenStatus.softHit || tokenStatus.hardHit }">
          {{ tokenStatus.message }}
        </p>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">硬限 tokens</span>
            <span class="settings-row-desc">默认 200 万；软限约为 80%</span>
          </div>
          <FouInput
            class="settings-row-control"
            type="number"
            :model-value="String(tokenHardLimit)"
            style="width: 160px; max-width: 200px"
            @update:model-value="(v: string) => (tokenHardLimit = Number(v) || 0)"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">已用 / 剩余</span>
          </div>
          <span class="ui-font">
            {{ tokenStatus?.usedTokens?.toLocaleString?.() ?? "—" }}
            /
            {{ tokenStatus?.remaining?.toLocaleString?.() ?? "—" }}
          </span>
        </div>
        <div class="settings-row settings-row--actions">
          <FouButton icon="save-line" :loading="tokenSaving" @click="saveTokenPackage(false)">
            保存套餐
          </FouButton>
          <FouButton icon="restart-line" :loading="tokenSaving" @click="saveTokenPackage(true)">
            清零用量
          </FouButton>
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'billing'" class="settings-group">
            <SettingsBillingSection />
          </div>

          <div v-if="activeSettingsGroup === 'role-packs'" class="settings-group">
      <section class="settings-section settings-section--highlight">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">岗位数据包</h2>
            <p class="settings-section-desc">
              <template v-if="showCommerceUi()">
                商业包使用<strong>临时会话密钥</strong>在内存解包，密钥不落盘。企业版优先从<strong>本地 License 服</strong>一次性拉加密包，不可达时回落云端。业务项目数据始终在本机。
              </template>
              <template v-else>
                岗位数据包在本机解包使用，密钥不落盘；业务项目数据始终在本机。
              </template>
            </p>
          </div>
          <div class="settings-section-actions">
            <PageHelpButton topic="settings.edition-license" label="说明" />
            <FouButton icon="refresh-line" size="small" :loading="rolePackBusy" @click="reloadRolePackCatalog">
              重载
            </FouButton>
            <FouButton icon="download-cloud-line" size="small" :loading="rolePackBusy" @click="checkRolePackUpdatesAction">
              检查更新
            </FouButton>
            <FouButton
              icon="cloud-line"
              size="small"
              :loading="rolePackBusy"
              @click="void refreshCloudRolePackCatalog()"
            >
              云端目录
            </FouButton>
            <FouButton
              v-if="showCommerceUi()"
              icon="shopping-bag-line"
              size="small"
              @click="openRolePackStore"
            >
              购买
            </FouButton>
          </div>
        </div>

        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">登录后下载全量包</span>
            <span class="settings-row-desc">
              正式包（zh-CN-virmoor）与旧版包托管于账号服，换临时链接（约 5 分钟）；安装包仅含演示 5 岗，语音包不进 exe
            </span>
          </div>
          <p v-if="cloudRolePackHint" class="settings-row-desc">{{ cloudRolePackHint }}</p>
          <div v-if="cloudRolePackEntries.length" style="display: flex; flex-direction: column; gap: 8px">
            <div
              v-for="entry in cloudRolePackEntries"
              :key="entry.id"
              style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap"
            >
              <span class="ui-font">{{ entry.name }}</span>
              <span v-if="entry.shortDesc" class="settings-row-desc">{{ entry.shortDesc }}</span>
              <FouButton
                icon="download-2-line"
                size="small"
                type="primary"
                :loading="rolePackBusy"
                @click="void downloadCloudRolePack(entry)"
              >
                登录下载
              </FouButton>
            </div>
          </div>
          <FouButton
            v-else
            icon="refresh-line"
            size="small"
            @click="void refreshCloudRolePackCatalog()"
          >
            刷新云端列表
          </FouButton>
        </div>

        <div v-if="showCommerceUi()" class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">产品版本</span>
            <span class="settings-row-desc">单独版：单账号唯一界面；企业版：多机 + 本机选角色</span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <FouButton
              icon="user-line"
              size="small"
              :type="editionPrefs.edition === 'solo' ? 'primary' : 'default'"
              native-type="button"
              @click="editionPrefs.edition = 'solo'"
            >
              单独版
            </FouButton>
            <FouButton
              icon="building-line"
              size="small"
              :type="editionPrefs.edition === 'enterprise' ? 'primary' : 'default'"
              native-type="button"
              @click="editionPrefs.edition = 'enterprise'"
            >
              企业版
            </FouButton>
          </div>
        </div>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">License 端点</span>
            <span class="settings-row-desc">{{ editionEndpointHint || "auto：先探本地服 /health，失败走云端" }}</span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px">
            <FouButton
              icon="magic-line"
              size="small"
              :type="editionPrefs.endpointMode === 'auto' ? 'primary' : 'default'"
              @click="editionPrefs.endpointMode = 'auto'"
            >
              自动
            </FouButton>
            <FouButton
              icon="server-line"
              size="small"
              :type="editionPrefs.endpointMode === 'local' ? 'primary' : 'default'"
              @click="editionPrefs.endpointMode = 'local'"
            >
              仅本地
            </FouButton>
            <FouButton
              icon="cloud-line"
              size="small"
              :type="editionPrefs.endpointMode === 'cloud' ? 'primary' : 'default'"
              @click="editionPrefs.endpointMode = 'cloud'"
            >
              仅云端
            </FouButton>
          </div>
          <FouInput
            v-model="editionPrefs.localBaseUrl"
            class="settings-row-control"
            :placeholder="`本地服 ${getLocalBrainDefaultUrl()}`"
          />
          <FouInput
            v-model="editionPrefs.cloudBaseUrl"
            class="settings-row-control"
            style="margin-top: 8px"
            :placeholder="`云端 ${getAccountServerUrl()}`"
          />
          <FouButton
            icon="save-line"
            size="small"
            style="margin-top: 8px"
            :loading="rolePackBusy"
            @click="saveEditionPrefs"
          >
            保存版本与端点
          </FouButton>
        </div>

        <p v-if="rolePackLicenseStatus?.machineId" class="settings-row-desc ui-font">
          设备 ID：{{ rolePackLicenseStatus.machineId }}
        </p>
        <p v-if="rolePackMsg" class="settings-row-desc ui-font">{{ rolePackMsg }}</p>
        <ul v-if="rolePacks.length" class="settings-row-desc ui-font">
          <li v-for="p in rolePacks" :key="`${p.packId}-${p.locale}`">
            {{ p.packId }} · {{ p.locale }} · {{ p.roleCount }} 岗
            <span v-if="p.contentVersion"> · v{{ p.contentVersion }}</span>
            <span v-if="p.expiresAt"> · 到期 {{ p.expiresAt.slice(0, 10) }}</span>
            <span v-if="p.demo">（演示）</span>
          </li>
        </ul>
        <ul v-if="rolePackUpdates.length" class="settings-row-desc ui-font">
          <li v-for="u in rolePackUpdates" :key="u.packId">
            可更新：{{ u.packId }} → v{{ u.contentVersion }}
            <a v-if="u.downloadUrl" href="#" @click.prevent="openRolePackStore">下载</a>
          </li>
        </ul>
        <p v-if="!rolePacks.length" class="settings-row-desc ui-font">
          暂无已登记数据包（将自动加载内置演示包）。
        </p>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">离线解密密钥（可选，仅本会话内存）</span>
            <span class="settings-row-desc">不再写入 installed.json；演示包留空</span>
          </div>
          <FouInput
            v-model="rolePackKeyHex"
            class="settings-row-control"
            placeholder="64 位十六进制密钥"
          />
        </div>
        <div class="settings-row settings-row--actions">
          <FouButton icon="folder-open-line" :loading="rolePackBusy" @click="importRolePackFile">
            导入 .xupack
          </FouButton>
        </div>
        <div class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">会话登录（临时密钥）</span>
            <span class="settings-row-desc">许可证换内存密钥；可附带本地包路径，或由服务端 download_url 一次拉取</span>
          </div>
          <FouInput v-model="rolePackLicense" class="settings-row-control" placeholder="许可证" />
          <FouInput
            v-model="rolePackActivatePath"
            class="settings-row-control"
            style="margin-top: 8px"
            placeholder="可选：本机 .xupack 路径"
          />
        </div>
        <div class="settings-row settings-row--actions">
          <FouButton icon="login-box-line" :loading="rolePackBusy" type="primary" @click="sessionLoginAction">
            会话登录
          </FouButton>
          <FouButton icon="key-2-line" :loading="rolePackBusy" @click="activateRolePackFile">
            激活并导入（兼容）
          </FouButton>
          <FouButton icon="refresh-line" :loading="rolePackBusy" @click="sessionRenewAction">
            续期密钥
          </FouButton>
          <FouButton icon="logout-box-line" :loading="rolePackBusy" @click="sessionLogoutAction">
            登出清密钥
          </FouButton>
        </div>

        <div v-if="editionPrefs.edition === 'enterprise'" class="settings-row settings-row--stacked">
          <div class="settings-row-label">
            <span class="ui-font">本机运行角色（企业版）</span>
            <span class="settings-row-desc">
              勾选后办公室/入职仅展示这些角色；未选不占本机算力。数据仍在本机。已选
              {{ editionPrefs.activeRoleIds.length }} 个。
            </span>
          </div>
          <FouInput v-model="enterpriseRoleFilter" placeholder="搜索角色…" class="settings-row-control" />
          <div
            style="
              max-height: 220px;
              overflow: auto;
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
              margin-top: 8px;
            "
          >
            <FouButton
              v-for="r in filteredEnterpriseRoles"
              :key="r.id"
              size="small"
              :icon="editionPrefs.activeRoleIds.includes(r.id) ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'"
              :type="editionPrefs.activeRoleIds.includes(r.id) ? 'primary' : 'default'"
              native-type="button"
              @click="toggleEnterpriseRole(r.id)"
            >
              {{ r.nameZh || r.name || r.id }}
            </FouButton>
          </div>
          <FouButton
            icon="save-line"
            size="small"
            style="margin-top: 8px"
            :loading="rolePackBusy"
            @click="saveEditionPrefs"
          >
            保存本机角色
          </FouButton>
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'voice'" class="settings-group">
            <Suspense>
              <VoiceSettingsSection />
              <template #fallback>
                <p class="settings-row-desc ui-font">正在加载语音设置…</p>
              </template>
            </Suspense>
          </div>

          <div v-if="activeSettingsGroup === 'shortcuts'" class="settings-group">
      <section class="settings-section settings-section--highlight">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">区域截图快捷键</h2>
            <p class="settings-section-desc">
              全局快捷键触发区域截图（默认 <strong>Alt+A</strong>）。点击下方按钮后按下新组合键，再点「保存」生效。
            </p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">当前快捷键</span>
            <span class="settings-row-desc">保存后立即注册到系统全局热键</span>
          </div>
          <ShortcutCaptureInput v-model="screenshotShortcutDraft" />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">已生效</span>
            <span class="settings-row-desc">{{ screenshotShortcut.label || "Alt+A" }}</span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <FouButton
              icon="save-line"
              size="small"
              type="primary"
              :loading="screenshotShortcutSaving"
              @click="saveScreenshotShortcut"
            >
              保存快捷键
            </FouButton>
            <FouButton icon="refresh-line" size="small" text @click="resetScreenshotShortcut">
              恢复默认 Alt+A
            </FouButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">完成后自动加入对话</span>
            <span class="settings-row-desc"
              >开启后，「完成/复制」会把截图缩略图填入聊天输入框；关闭则只写入剪贴板</span
            >
          </div>
          <FouCheckbox
            class="settings-row-control"
            :model-value="screenshotAutoAttachChat"
            @update:model-value="onScreenshotAutoAttachChange"
          />
        </div>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'plugins'" class="settings-group">
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">组件市场（本机）</h2>
            <p class="settings-section-desc">
              浏览、启停与导入轻组件。您的 SKILL.md 复制到本机技能目录（默认「文档/虚募阁技能」），只在本地运行、不上传；卸载软件不会删除该文件夹。
              可同时启用多个轻组件（仅注入提示）；重型商业组件同一时刻只激活一个。
            </p>
          </div>
          <div class="settings-section-actions">
            <PageHelpButton topic="settings.capability-packs" label="说明" />
            <FouButton
              icon="refresh-line"
              size="small"
              :loading="capabilityPackBusy"
              @click="refreshCapabilityPacks"
            >
              刷新
            </FouButton>
            <FouButton
              icon="upload-2-line"
              size="small"
              :loading="capabilityPackBusy"
              @click="importCapabilityPackFile"
            >
              导入 .xucap / SKILL.md
            </FouButton>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">本机技能目录</span>
            <span class="settings-row-desc">
              自定义读取导入的 skill；不在安装目录、不进服务器。当前：<code>{{ skillsDataDirLabel }}</code>
            </span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <FouButton
              icon="folder-open-line"
              size="small"
              :loading="skillsDirBusy"
              @click="void pickSkillsDataDirSetting()"
            >
              选择目录
            </FouButton>
            <FouButton
              icon="external-link-line"
              size="small"
              :loading="skillsDirBusy"
              @click="void openSkillsFolder()"
            >
              打开文件夹
            </FouButton>
            <FouButton
              v-if="skillsDirCustom"
              icon="restart-line"
              size="small"
              :loading="skillsDirBusy"
              @click="void resetSkillsDataDirSetting()"
            >
              恢复默认
            </FouButton>
            <PageHelpButton topic="settings.user-skills" label="说明" />
          </div>
        </div>
        <p v-if="capabilityPackMsg" class="settings-row-desc ui-font">{{ capabilityPackMsg }}</p>
        <ul v-if="capabilityPacks.length" class="cap-pack-list ui-font">
          <li v-for="pack in capabilityPacks" :key="pack.manifest.id" class="cap-pack-row">
            <div class="cap-pack-info">
              <strong>{{ pack.manifest.name }}</strong>
              <span v-if="pack.bundled" class="cap-pack-tag">内置</span>
              <span v-else-if="pack.userOwned" class="cap-pack-tag">本机技能</span>
              <span v-else class="cap-pack-tag">已安装</span>
              <p class="settings-row-desc">
                {{ pack.manifest.description }}
                <template v-if="pack.manifest.roleId"> · 绑定岗 {{ pack.manifest.roleId }}</template>
              </p>
            </div>
            <FouSwitch
              :model-value="pack.enabled"
              @update:model-value="(v: boolean) => toggleCapabilityPack(pack.manifest.id, v)"
            />
          </li>
        </ul>
        <p v-else class="settings-row-desc ui-font">暂无组件，请导入 .xucap 或 SKILL.md</p>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">{{ showCommerceUi() ? "商业重组件" : "扩展工作室" }}</h2>
            <p class="settings-section-desc">
              <template v-if="showCommerceUi()">
                Canvas / 流程工作室 / 训练等付费能力（.xubiz）。与轻组件不同；无许可证时仅灰态入口；同一时刻只激活一个重组件。
              </template>
              <template v-else>
                Canvas / 流程 / 训练等扩展能力。与轻组件不同；同一时刻只激活一个扩展模块。
              </template>
            </p>
          </div>
          <div class="settings-section-actions">
            <PageHelpButton topic="settings.commerce-plugins" label="说明" />
            <FouButton
              icon="refresh-line"
              size="small"
              :loading="commerceBusy"
              @click="refreshCommercePlugins"
            >
              刷新
            </FouButton>
            <FouButton icon="upload-2-line" size="small" @click="stubImportFoubiz">
              导入 .xubiz
            </FouButton>
          </div>
        </div>
        <p v-if="commerceMsg" class="settings-row-desc ui-font">{{ commerceMsg }}</p>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">当前 entitlement</span>
            <span class="settings-row-desc">来自有效许可证（可与岗位包并列）</span>
          </div>
          <span class="settings-row-desc ui-font">
            {{ commerceEntitlements.length ? commerceEntitlements.join("、") : "无" }}
          </span>
        </div>
        <ul v-if="commercePlugins.length" class="cap-pack-list ui-font">
          <li v-for="pack in commercePlugins" :key="pack.id" class="cap-pack-row">
            <div class="cap-pack-info">
              <strong>{{ pack.id }}</strong>
              <span class="cap-pack-tag">v{{ pack.version }}</span>
              <p class="settings-row-desc">{{ pack.entitlements.join("、") }}</p>
            </div>
          </li>
        </ul>
        <p v-else class="settings-row-desc ui-font">
          暂无外部注册的 .xubiz；内置流程/训练 SPI 在 entitlement 开通后可用（见上方按钮）。
        </p>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">行业训练样本</span>
            <span class="settings-row-desc"
              >默认关闭。无 training.ingest 插件时为空操作；不会自动上传。</span
            >
          </div>
          <FouSwitch
            class="settings-row-control"
            :model-value="trainingOptIn"
            @update:model-value="onTrainingOptIn"
          />
        </div>
        <div class="settings-section-actions" style="margin-top: 8px">
          <FouButton icon="artboard-2-line" size="small" @click="goCanvasIde">
            打开 Canvas 面板
          </FouButton>
          <FouButton icon="organization-chart" size="small" @click="openWorkflowStudio">
            流程工作室
          </FouButton>
          <FouButton icon="graduation-cap-line" size="small" @click="openTrainingStudio">
            训练工作室
          </FouButton>
          <FouButton icon="user-star-line" size="small" @click="openSimpleTraining('employee')">
            岗位示例与评分（进阶）
          </FouButton>
          <FouButton
            icon="key-2-line"
            size="small"
            @click="activeSettingsGroup = 'role-packs'"
          >
            岗位数据 / 许可证
          </FouButton>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">代码检查（ESLint）</h2>
            <p class="settings-section-desc">
              虚募阁直接调用工作区内的 ESLint 与 npm 规则插件（如 eslint-plugin-vue）。不支持安装 VS Code 市场
              .vsix 扩展；与 VS Code ESLint 扩展等价的是「项目已安装 ESLint」。
            </p>
          </div>
          <FouButton icon="refresh-line" size="small" @click="refreshEslintInfo">检测</FouButton>
        </div>
        <p v-if="eslintInfoMsg" class="settings-row-desc ui-font">{{ eslintInfoMsg }}</p>
        <template v-else-if="eslintInfo">
          <p class="settings-row-desc ui-font">
            ESLint：{{ eslintInfo.installed ? "已安装" : "未安装" }} · 配置文件：{{
              eslintInfo.hasConfig ? "已找到" : "未找到"
            }}
          </p>
          <p v-if="eslintInfo.plugins.length" class="settings-row-desc ui-font">
            相关依赖：{{ eslintInfo.plugins.join("、") }}
          </p>
          <p v-else class="settings-row-desc ui-font">
            未检测到代码检查工具。可在内嵌终端安装 eslint 相关依赖后重试。
          </p>
        </template>
      </section>
          </div>

          <div v-if="activeSettingsGroup === 'legal'" class="settings-group">
            <section class="settings-section">
              <div class="settings-section-header">
                <div>
                  <h2 class="settings-section-title ui-font">法律与协议</h2>
                  <p class="settings-section-desc">
                    使用本软件即表示您已阅读并理解下列协议。协议适用中华人民共和国法律。生效：{{
                      LEGAL_EFFECTIVE_DATE
                    }}（{{ LEGAL_VERSION }}）。
                  </p>
                </div>
                <PageHelpButton topic="settings.legal" label="说明" />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">官方产品标识</span>
                  <span class="settings-row-desc">
                    由本机内核提供：{{ appIdentity.productName }}
                    <template v-if="appIdentity.version"> · {{ appIdentity.version }}</template>
                    · {{ appIdentity.copyrightHolder }}
                  </span>
                </div>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">用户服务协议</span>
                  <span class="settings-row-desc">服务范围、用户义务、AI 输出、隐私与争议解决</span>
                </div>
                <FouButton icon="file-text-line" size="small" @click="userAgreementOpen = true">
                  查看全文
                </FouButton>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">软件使用许可协议</span>
                  <span class="settings-row-desc">安装授权、商业许可、使用限制与免责</span>
                </div>
                <FouButton icon="file-shield-2-line" size="small" @click="softwareLicenseOpen = true">
                  查看全文
                </FouButton>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">禁止蒸馏与复制本软件</span>
                  <span class="settings-row-desc">
                    主人强制，不可关闭。禁止追问本软件原理，也禁止「复制一个你这样的产品」。其它软件与第三方模型可正常讨论。
                  </span>
                </div>
                <span class="ui-font settings-row-desc">强制开启</span>
              </div>
            </section>
          </div>

          <div v-if="activeSettingsGroup === 'about'" class="settings-group">
            <section class="settings-section">
              <div class="settings-section-header">
                <div>
                  <h2 class="settings-section-title ui-font">关于与更新</h2>
                  <p class="settings-section-desc">
                    查看本机版本。程序升级为完整安装包；岗位包、语音包请在对应分组单独更新。
                  </p>
                </div>
                <PageHelpButton topic="settings.about-update" label="说明" />
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <span class="ui-font">当前版本</span>
                  <span class="settings-row-desc">
                    {{ appIdentity.productName || BRAND_NAME }}
                    <template v-if="appIdentity.version"> · {{ appIdentity.version }}</template>
                    <template v-if="appIdentity.copyrightHolder">
                      · {{ appIdentity.copyrightHolder }}</template
                    >
                  </span>
                </div>
                <FouButton
                  icon="search-line"
                  size="small"
                  type="primary"
                  :loading="appUpdateBusy"
                  :disabled="appUpdateInstalling"
                  @click="checkAppUpdateAction"
                >
                  检查更新
                </FouButton>
              </div>
              <div
                v-if="appUpdateResult"
                class="settings-row"
                style="align-items: flex-start"
              >
                <div class="settings-row-label">
                  <span class="ui-font">检查结果</span>
                  <span class="settings-row-desc" style="white-space: pre-wrap">{{
                    appUpdateResult.message
                  }}</span>
                  <span
                    v-if="appUpdateResult.status === 'available'"
                    class="settings-row-desc"
                  >
                    最新 {{ appUpdateResult.latest }} · 将下载完整安装包（非增量补丁）
                  </span>
                </div>
                <FouButton
                  v-if="appUpdateResult.status === 'available'"
                  icon="download-cloud-line"
                  size="small"
                  type="primary"
                  :loading="appUpdateInstalling"
                  :disabled="appUpdateBusy"
                  @click="downloadAppUpdateAction"
                >
                  下载并安装
                </FouButton>
              </div>
              <p class="settings-section-desc ui-font" style="margin-top: 8px">
                「检查更新」只查询版本，不会下载。「下载并安装」会先关闭主界面，在更新窗口显示进度，下载完成后自动安装并重启。每天重新打开软件时也会自动检查一次。也可在系统托盘右键「检查更新」。
              </p>
            </section>
          </div>

          <div v-if="activeSettingsGroup === 'system'" class="settings-group">
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">对话保留</h2>
            <p class="settings-section-desc">虚募阁本地 messages 表清理策略（启动时 purge）。</p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="ui-font">永不清理</span></div>
          <FouCheckbox
            :model-value="retentionNever"
            @update:model-value="(v: boolean) => saveRetention(v, retentionDays || 30)"
          />
        </div>
        <div v-if="!retentionNever" class="settings-row">
          <div class="settings-row-label"><span class="ui-font">保留天数</span></div>
          <FouInput
            type="number"
            :model-value="String(retentionDays || 30)"
            style="width: 100px"
            @update:model-value="(v: string) => saveRetention(false, Number(v) || 30)"
          />
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">资源管理器右键</h2>
            <p class="settings-section-desc">
              在 Windows 资源管理器中右键文件或文件夹，使用「用 虚募阁 IDE 打开」进入 IDE 并加载路径（仅当前用户 HKCU）。
            </p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">用 虚募阁 IDE 打开</span>
            <span class="settings-row-desc">
              {{ ideShellMenuRegistered ? "已注册" : "未注册" }}
            </span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <FouButton
              v-if="!ideShellMenuRegistered"
              icon="add-circle-line"
              size="small"
              :loading="ideShellMenuLoading"
              @click="void registerIdeShellMenu()"
            >
              注册右键菜单
            </FouButton>
            <FouButton
              v-else
              icon="close-circle-line"
              size="small"
              :loading="ideShellMenuLoading"
              @click="void unregisterIdeShellMenu()"
            >
              取消注册
            </FouButton>
          </div>
        </div>
        <p v-if="ideShellMenuMsg" class="settings-row-desc">{{ ideShellMenuMsg }}</p>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">多端连接</h2>
            <p class="settings-section-desc">飞书 / 企微 / 钉钉 / Slack / Telegram：填 API + Key 即可连接。</p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="ui-font">连接中心</span></div>
          <FouButton icon="links-line" @click="router.push('/connections')">打开多端连接</FouButton>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2 class="settings-section-title ui-font">办公室工位</h2>
            <p class="settings-section-desc">
              默认三开间（老板 / 员工 / 茶水）。工位 {{ OFFICE_DESK_MIN }}–{{ OFFICE_DESK_MAX }}，减席只取消入座绑定。可保存当前为默认并一键恢复。
            </p>
          </div>
        </div>
        <div class="settings-row office-desk-row">
          <div class="settings-row-label">
            <span class="ui-font">工位数量</span>
            <span class="settings-row-desc">当前 {{ deskCount }} 席 · 默认 {{ OFFICE_DESK_DEFAULT }}</span>
          </div>
          <div class="office-desk-controls">
            <FouButton
              icon="subtract-line"
              size="small"
              :disabled="deskCount <= OFFICE_DESK_MIN"
              aria-label="减少"
              @click="handleDeskCount(deskCount - 1)"
            />
            <FouInput
              type="number"
              :model-value="String(deskCount)"
              style="width: 72px"
              @update:model-value="(v: string) => handleDeskCount(Number(v))"
            />
            <FouButton
              icon="add-line"
              size="small"
              :disabled="deskCount >= OFFICE_DESK_MAX"
              aria-label="增加"
              @click="handleDeskCount(deskCount + 1)"
            />
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">项目切换自动对齐工位</span>
            <span class="settings-row-desc">切换项目后若团队人数超过工位数，办公室页提示一键应用推荐布局</span>
          </div>
          <FouSwitch
            :model-value="autoSyncDesk"
            @update:model-value="(v: boolean) => { autoSyncDesk = v; writeAutoSyncDesk(v); }"
          />
        </div>
        <div class="settings-row office-snapshot-row">
          <div class="settings-row-label">
            <span class="ui-font">办公室默认快照</span>
            <span v-if="officeSnapshotMeta" class="settings-row-desc">
              已保存 · {{ formatSnapshotTime(officeSnapshotMeta.savedAt) }} ·
              {{ officeSnapshotMeta.employeeCount }} 人 · {{ officeSnapshotMeta.deskCount }} 席
            </span>
            <span v-else class="settings-row-desc">尚未保存；启动后会自动抓取当前办公室为默认</span>
          </div>
          <div class="office-snapshot-actions">
            <FouButton
              icon="save-3-line"
              size="small"
              :disabled="officeSnapshotBusy"
              @click="handleSaveOfficeDefault"
            >
              保存当前为默认
            </FouButton>
            <FouButton
              icon="history-line"
              size="small"
              :disabled="officeSnapshotBusy || !officeSnapshotMeta"
              @click="handleRestoreOfficeDefault"
            >
              恢复我的默认
            </FouButton>
          </div>
        </div>
        <p v-if="officeSnapshotMsg" class="settings-hint ui-font">{{ officeSnapshotMsg }}</p>

        <div class="settings-section-header" style="margin-top: 20px">
          <div>
            <h3 class="settings-section-title ui-font">员工名牌显示</h3>
            <p class="settings-section-desc">控制 2D/3D 办公室场景中员工头顶名牌的显示格式。</p>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">主行格式</span>
            <span class="settings-row-desc">名牌第一行文字</span>
          </div>
          <FouSelect
            class="settings-row-control"
            :model-value="officeDisplayPrefs.primaryFormat"
            :options="PRIMARY_FORMAT_OPTIONS"
            style="max-width: 280px"
            @update:model-value="(v: string) => patchOfficeDisplay({ primaryFormat: v as OfficeDisplayPrefs['primaryFormat'] })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">次行内容</span>
            <span class="settings-row-desc">名牌第二行（3D）或悬停提示（2D）</span>
          </div>
          <FouSelect
            class="settings-row-control"
            :model-value="officeDisplayPrefs.secondaryLine"
            :options="SECONDARY_LINE_OPTIONS"
            style="max-width: 280px"
            @update:model-value="(v: string) => patchOfficeDisplay({ secondaryLine: v as OfficeDisplayPrefs['secondaryLine'] })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">长名截断</span>
          </div>
          <FouSelect
            class="settings-row-control"
            :model-value="String(officeDisplayPrefs.nameTruncate)"
            :options="nameTruncateSelectOptions"
            style="max-width: 160px"
            @update:model-value="(v: string) => patchOfficeDisplay({ nameTruncate: Number(v) as OfficeDisplayPrefs['nameTruncate'] })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">显示状态色点</span>
            <span class="settings-row-desc">2D 头顶圆点、3D 状态行颜色</span>
          </div>
          <FouSwitch
            class="settings-row-control"
            :model-value="officeDisplayPrefs.showStatusDot"
            @update:model-value="(v: boolean) => patchOfficeDisplay({ showStatusDot: v })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">显示工号</span>
            <span class="settings-row-desc">在次行前缀显示 F0001 等工号</span>
          </div>
          <FouSwitch
            class="settings-row-control"
            :model-value="officeDisplayPrefs.showEmployeeNo"
            @update:model-value="(v: boolean) => patchOfficeDisplay({ showEmployeeNo: v })"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <span class="ui-font">显示对话气泡（3D）</span>
            <span class="settings-row-desc">员工头顶 Agent 状态气泡</span>
          </div>
          <FouSwitch
            class="settings-row-control"
            :model-value="officeDisplayPrefs.showSpeechBubbles"
            @update:model-value="(v: boolean) => patchOfficeDisplay({ showSpeechBubbles: v })"
          />
        </div>
      </section>

      <section class="settings-section settings-guide-section">
        <div>
          <h2 class="settings-section-title ui-font">使用引导</h2>
          <p class="settings-section-desc">重新查看虚募阁首次引导。</p>
        </div>
        <FouButton type="primary" icon="compass-3-line" @click="router.push('/onboarding')">
          查看引导页
        </FouButton>
      </section>
          </div>
        </div>
      </div>
    </div>

    <FouDialog v-model="driveHelpOpen" :title="DRIVE_HELP_TITLE" width="520px" append-to-body>
      <div class="drive-doc">
        <div v-for="s in DRIVE_HELP_SECTIONS" :key="s.title" class="drive-doc-block">
          <strong>{{ s.title }}</strong>
          <p>{{ s.body }}</p>
        </div>
      </div>
      <template #footer>
        <FouButton type="primary" icon="check-line" @click="driveHelpOpen = false">知道了</FouButton>
      </template>
    </FouDialog>

    <FouDialog v-model="driveRiskOpen" :title="DRIVE_RISK_TITLE" width="520px" append-to-body>
      <div class="drive-doc">
        <div v-for="s in DRIVE_RISK_SECTIONS" :key="s.title" class="drive-doc-block">
          <strong>{{ s.title }}</strong>
          <p>{{ s.body }}</p>
        </div>
      </div>
      <template #footer>
        <FouButton icon="close-line" @click="driveRiskOpen = false">取消</FouButton>
        <FouButton
          type="primary"
          icon="check-line"
          @click="
            () => {
              patchDrive({ consentAccepted: true });
              driveRiskOpen = false;
            }
          "
        >
          同意
        </FouButton>
      </template>
    </FouDialog>

    <FouDialog
      v-model="softwareAutopilotRiskOpen"
      :title="SOFTWARE_AUTOPILOT_RISK_TITLE"
      width="520px"
      append-to-body
    >
      <div class="drive-doc">
        <p class="software-autopilot-risk ui-font" style="margin-top: 0">
          <FouIcon icon="error-warning-fill" class="software-autopilot-risk-icon" />
          <span class="software-autopilot-risk-text">{{ SOFTWARE_AUTOPILOT_RISK_BANNER }}</span>
        </p>
        <div v-for="s in SOFTWARE_AUTOPILOT_RISK_SECTIONS" :key="s.title" class="drive-doc-block">
          <strong>{{ s.title }}</strong>
          <p>{{ s.body }}</p>
        </div>
      </div>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="softwareAutopilotRiskOpen = false">
          取消
        </FouButton>
        <FouButton
          type="primary"
          icon="check-line"
          native-type="button"
          @click="
            () => {
              void persistSoftwareAutopilot({ riskAcknowledged: true });
              softwareAutopilotRiskOpen = false;
            }
          "
        >
          我已知晓并同意
        </FouButton>
      </template>
    </FouDialog>

    <FouDialog v-model="userAgreementOpen" :title="USER_AGREEMENT_TITLE" width="640px" append-to-body>
      <p class="legal-doc-meta ui-font">
        运营者：{{ companyName }} · 产品 {{ appIdentity.productName }} · 生效 {{ LEGAL_EFFECTIVE_DATE }}
      </p>
      <div class="drive-doc legal-doc">
        <div v-for="s in userAgreementSections" :key="s.title" class="drive-doc-block">
          <strong>{{ s.title }}</strong>
          <p>{{ s.body }}</p>
        </div>
      </div>
      <template #footer>
        <FouButton type="primary" icon="check-line" @click="userAgreementOpen = false">我已阅读</FouButton>
      </template>
    </FouDialog>

    <FouDialog v-model="softwareLicenseOpen" :title="SOFTWARE_LICENSE_TITLE" width="640px" append-to-body>
      <p class="legal-doc-meta ui-font">
        许可方：{{ companyName }} · 产品 {{ appIdentity.productName }} · 生效 {{ LEGAL_EFFECTIVE_DATE }}
      </p>
      <div class="drive-doc legal-doc">
        <div v-for="s in softwareLicenseSections" :key="s.title" class="drive-doc-block">
          <strong>{{ s.title }}</strong>
          <p>{{ s.body }}</p>
        </div>
      </div>
      <template #footer>
        <FouButton type="primary" icon="check-line" @click="softwareLicenseOpen = false">我已阅读</FouButton>
      </template>
    </FouDialog>

    <OfficeHallDisplayDialog v-model:open="showHallDisplay" />
  </div>
</template>

<style scoped>
.settings-ide-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.settings-ide-select {
  flex: 1;
  min-width: 200px;
}
.fou-settings {
  height: 100%;
  overflow: auto;
  background: var(--canvas);
  color: var(--body);
}
.settings-embedded {
  height: 100%;
  min-height: 0;
}
.settings-embedded :deep(.settings-layout) {
  min-height: 0;
}
.brain-slot-block {
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface-card);
}
.brain-slot-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--ink);
}
.brain-slot-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.brain-source-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.software-autopilot-risk {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 0 14px;
  padding: 12px 14px;
  border-radius: var(--radius);
  border: 1px solid #f59e0b;
  background: color-mix(in srgb, #f59e0b 12%, var(--surface-card, #fff));
  color: #92400e;
}
.software-autopilot-risk-icon {
  flex-shrink: 0;
  font-size: 20px;
  color: #d97706;
  margin-top: 1px;
}
.software-autopilot-risk-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  font-weight: 600;
}
.drive-doc {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 55vh;
  overflow: auto;
}
.drive-doc-block strong {
  display: block;
  margin-bottom: 4px;
  color: var(--body-strong);
}
.settings-ide-cli {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 420px;
}
.office-desk-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.office-snapshot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.settings-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.drive-doc-block p {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}
.legal-doc-meta {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--muted);
}
.legal-doc {
  max-height: 58vh;
}
.token-warn {
  color: var(--error) !important;
  font-weight: 600;
}
.theme-card,
.terminal-bg-card {
  cursor: pointer;
  border: 1px solid var(--hairline);
  background: var(--surface-card);
  border-radius: var(--radius-lg);
  color: inherit;
  text-align: left;
  font: inherit;
  appearance: none;
  -webkit-appearance: none;
}
.theme-card-grid :deep(.theme-card.fou-button) {
  width: 100%;
  height: auto !important;
  min-height: 88px;
  padding: 10px 12px !important;
  display: grid !important;
  grid-template-columns: auto 52px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  white-space: normal;
  justify-content: stretch;
}
.theme-card-grid :deep(.theme-card.fou-button .fou-button__label) {
  display: contents;
}
.theme-card.selected,
.terminal-bg-card.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-glow);
}
@media (max-width: 900px) {
  .brain-slot-fields {
    flex-direction: column;
    align-items: stretch;
  }
}
.get-smarter-steps {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 10px;
  line-height: 1.5;
}
.get-smarter-steps li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.advanced-training-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.settings-audit-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.settings-audit-item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface-card);
  font-size: 12px;
}
.settings-activity-item {
  flex-direction: column;
  align-items: stretch;
}
.settings-activity-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 0;
  color: inherit;
  font: inherit;
}
.settings-activity-detail {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
.settings-activity-detail pre {
  margin: 0 0 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
.settings-activity-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.cap-pack-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cap-pack-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface-card);
}
.cap-pack-info {
  flex: 1;
  min-width: 0;
}
.cap-pack-info p {
  margin: 4px 0 0;
}
.cap-pack-tag {
  margin-left: 6px;
  font-size: 11px;
  color: var(--muted);
}
</style>
