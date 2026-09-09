<script setup lang="ts">
/**
 * @file 桌面应用壳、全局事件与窗口生命周期
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-04
 * @version 1.3.0
 * @category Layout
 * @algo request-id-global-voice-open
 */
import { nextTick, onMounted, onUnmounted, ref, watch, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fouAlert, fouMsg } from "foucui";
import AppTitleBar from "./components/AppTitleBar.vue";
import NavBar from "./components/NavBar.vue";
import OnboardingPage from "./pages/OnboardingPage.vue";
import KeyboardShortcutsPanel from "./components/KeyboardShortcutsPanel.vue";
import StartupSelfCheckOverlay from "./components/StartupSelfCheckOverlay.vue";
import type { AppMenuAction } from "./appMenu";
import { isIdeMenuAction } from "./appMenu";
import { useTheme } from "./composables/useTheme";
import { useFontSize } from "./composables/useFontSize";
import { detectPlatformKind } from "./utils/platform";
import { bootstrapEmployees } from "./utils/employees";
import { ensureInitialOfficeDefault } from "./utils/officeSnapshot";
import { bootstrapConcurrency } from "./utils/concurrencySlots";
import { notifyBoss, type BossNotifyKind } from "./utils/channelConnections";
import { useNavCollapse } from "./composables/useNavCollapse";
import { ensureEmployeeLiveBridge } from "./employee/events";
import { BRAND_NAME_ZH } from "./utils/brandSettings";
import { useI18n } from "vue-i18n";
import { resetAuthSessionCheck } from "./router";
import { ensureWorkflowBridge, handleBossMessage } from "./utils/workflowOrchestrator";
import { ensureDeliveryReviewBridge } from "./utils/deliveryReviewOrchestrator";
import { ensureProjectQueueBridge } from "./utils/projectQueueRunner";
import { handleBossInboundReset } from "./utils/resetReplanInbound";
import ToolApprovalDialog from "./components/ToolApprovalDialog.vue";
import HelpPanel from "./components/help/HelpPanel.vue";
import CommerceStudioDialog from "./commerce/CommerceStudioDialog.vue";
import SimpleTrainingDialog from "./components/SimpleTrainingDialog.vue";
import { ensureBuiltinCommercePlugins } from "./commerce";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openScreenshotSession, listenScreenshotHotkey, SCREENSHOT_OVERLAY_LABEL } from "./utils/screenshot";
import { bindAppRouter, focusIdeWindow, openNewIdeWindow, isMainWindow, isUpdaterWindow } from "./utils/windowManager";
import { readIdeCliOverride, writeIdeCliOverride } from "./utils/ideCli";
import { syncCodingSurfaceToRust } from "./utils/codingSurfacePrefs";
import { migrateAuthStorage, markAppOnboardingComplete, readAuthToken, syncAuthSettingsToDb } from "./utils/auth";
import { syncScreenshotShortcutFromRust, bootstrapScreenshotShortcut } from "./utils/shortcutSettings";
import { openHelp } from "./composables/useHelp";
import { helpTopicForRoute } from "./help/helpManifest";
import { ideChatPanelVisible, ideChatHistoryVisible, toggleIdeChatPanel, toggleIdeChatHistory } from "./composables/useIdeChatPanel";
import { ideSidebarVisible, toggleIdeSidebar } from "./composables/useIdeSidebarVisible";
import { hasRunStartupSelfCheck } from "./utils/startupSelfCheck";
import { ensureCosyAutostartOnce } from "./utils/cosyAutostart";
import {
  XU_VOICE_WAKE_REFRESH,
  beginVoiceWakeOpen,
  clearStaleVoiceAssistantOpen,
  forceCloseVoiceAssistantOverlay,
  isVoiceAssistantOverlayOpen,
  isVoiceWakeOpening,
  requestOpenVoiceAssistant,
  routeHasChatPage,
} from "./utils/voiceAssistantOpen";
import {
  stopVoiceWake,
  stopVoiceWakeAndWait,
  syncVoiceWake,
} from "./utils/voiceWake";
import { loadVoiceSettings } from "./stores/voiceSettings";
import { openAppSettings } from "./utils/openAppSettings";
import { clearStuckUiBlockers } from "./utils/clearStuckUiBlockers";
import { applyLoginWindowSize, restoreMainWindowSize } from "./utils/loginWindow";
import { startBossReplyWatch, stopBossReplyWatch } from "./utils/bossReplyWatch";
import { runAppUpdateCheck, maybeDailyAppUpdateCheck } from "./utils/appUpdateCheck";
import AppEditContextMenu, { type AppEditCtxAction } from "./components/AppEditContextMenu.vue";

/** Soft startup probe — 虚募阁 Native Agent needs no external CLI. */
interface EnvProbeStatus {
  installed: boolean;
  version: string;
  config_exists: boolean;
  api_key_configured: boolean;
  configured_providers: string[];
  error: string;
}

useNavCollapse();

const isMac = navigator.platform.toLowerCase().includes("mac");

function setupErrorMessage(error: unknown) {
  const message = String(error);
  if (message.includes("invoke") || message.includes("__TAURI")) {
    return "环境检测未完成（可直接进入；对话依赖三脑与 API Key）。";
  }
  return message;
}

function fouOnboardingDone(): boolean {
  try {
    return (
      window.localStorage.getItem("xu.onboarding.complete") === "true" ||
      window.localStorage.getItem("hermes.onboarding.complete") === "true"
    );
  } catch {
    return false;
  }
}

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
useTheme();
useFontSize();

const isAuthRoute = computed(
  () => route.path === "/login",
);
function isScreenshotOverlayWindow(): boolean {
  if (route.path === "/screenshot-overlay") return true;
  try {
    return getCurrentWindow().label === SCREENSHOT_OVERLAY_LABEL;
  } catch {
    return false;
  }
}

const isScreenshotOverlay = computed(() => isScreenshotOverlayWindow());
const isCosyConsole = computed(() => {
  if (route.path === "/cosy-console") return true;
  try {
    return getCurrentWindow().label === "cosy-console";
  } catch {
    return false;
  }
});
const isUpdaterShell = computed(() => {
  if (route.path === "/updater") return true;
  try {
    return isUpdaterWindow();
  } catch {
    return false;
  }
});
const hideNav = computed(() => {
  if (isScreenshotOverlay.value) return true;
  if (isUpdaterShell.value) return true;
  if (route.path === "/cosy-console") return true;
  try {
    const label = getCurrentWindow().label;
    return (
      label === "ide" ||
      label.startsWith("ide-") ||
      label === "cosy-console" ||
      label === "updater"
    );
  } catch {
    return route.path === "/cosy-console" || route.path === "/updater";
  }
});

const platformKind = detectPlatformKind();

type AppHotData = { ready?: boolean; setupChecked?: boolean };
const hot = import.meta.hot;
if (hot) {
  const saved = hot.data as AppHotData;
  if (saved.ready) {
    // HMR 时保留已就绪状态，避免闪回「正在准备虚募阁」像整页重启
  }
  hot.dispose((data) => {
    const d = data as AppHotData;
    d.ready = ready.value;
    d.setupChecked = true;
  });
}

const checkingSetup = ref(hot?.data?.setupChecked ? false : true);
const setup = ref<EnvProbeStatus | null>(null);
const ready = ref(Boolean(hot?.data?.ready) || false);
const showShortcuts = ref(false);
let setupInFlight = false;

/** 登录后主壳一次自检：用 ref 挂载，避免跑完 mark 后立刻卸掉层（须在 ready 之后） */
const showStartupSelfCheck = ref(false);
let cosyAutostartArmed = false;
let cosyAutostartTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () =>
    [
      ready.value,
      isAuthRoute.value,
      isScreenshotOverlay.value,
      isCosyConsole.value,
    ] as const,
  ([r, auth, shot, cosy]) => {
    if (r && !auth && !shot && !cosy) {
      // Cosy 自动启必须推迟：与 WebView2 抢 GPU 会导致整窗纯黑卡死
      if (!cosyAutostartArmed) {
        cosyAutostartArmed = true;
        if (cosyAutostartTimer) clearTimeout(cosyAutostartTimer);
        cosyAutostartTimer = window.setTimeout(() => {
          cosyAutostartTimer = null;
          if (disposed || isAuthRoute.value) return;
          void ensureCosyAutostartOnce().catch((e) =>
            console.warn("ensureCosyAutostartOnce", e),
          );
        }, 5_000);
      }
      if (!hasRunStartupSelfCheck() && !showStartupSelfCheck.value) {
        showStartupSelfCheck.value = true;
      }
    }
    void refreshGlobalVoiceWake();
  },
  { immediate: true },
);

/**
 * 全局前台唤醒：任意业务页可听（不依赖 ChatPage 是否挂载）。
 * 命中后回首页并打开全屏通话层（Teleport body，盖住当前页）。
 */
async function refreshGlobalVoiceWake() {
  // 无 DOM 的卡死 opening/visible 会永久挡住唤醒监听
  if (clearStaleVoiceAssistantOpen()) {
    /* recovered */
  }
  if (isVoiceWakeOpening()) {
    const hasDom =
      typeof document !== "undefined" &&
      Boolean(document.querySelector(".voice-assistant-overlay"));
    if (hasDom) {
      stopVoiceWake();
      return;
    }
    if (clearStaleVoiceAssistantOpen()) {
      /* recovered after grace */
    }
    // 宽限内且无 DOM：继续听，避免 opening 把唤醒永久掐死
  }
  const allowShell =
    ready.value &&
    !isAuthRoute.value &&
    !isScreenshotOverlay.value &&
    !isCosyConsole.value;
  // Tauri WebView 上 document.hasFocus() 经常为 false，不能当硬门槛，否则永远听不到
  const want =
    allowShell &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    loadVoiceSettings().wakeEnabled &&
    !isVoiceAssistantOverlayOpen();
  if (!want) {
    stopVoiceWake();
    return;
  }
  await syncVoiceWake({
    wantRunning: true,
    onWake: (phrase) => {
      void (async () => {
        beginVoiceWakeOpen();
        await stopVoiceWakeAndWait();
        clearStuckUiBlockers();
        // 先落 flag+事件，再导航：ChatPage onMounted 才能 consume 到 flag
        requestOpenVoiceAssistant({ phrase });
        if (!routeHasChatPage(route.path)) {
          await router.push({ path: "/home", query: { voice_wake: "1" } });
          await nextTick();
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
        } else {
          await nextTick();
        }
        const settings = loadVoiceSettings();
        fouMsg.success(`已唤醒（${phrase}）`);
        try {
          const win = getCurrentWindow();
          await win.show();
          if (await win.isMinimized()) await win.unminimize();
          if (settings.wakeMaximizeWindow !== false) await win.maximize();
          await win.setFocus();
        } catch {
          // 通话层已请求打开；窗口恢复失败不关闭通话。
        }
        const retryOpen = () => {
          if (!isVoiceWakeOpening()) return;
          const hasDom =
            typeof document !== "undefined" &&
            Boolean(document.querySelector(".voice-assistant-overlay"));
          if (hasDom) return;
          if (routeHasChatPage(route.path)) {
            requestOpenVoiceAssistant({ phrase });
            window.setTimeout(() => {
              if (!isVoiceWakeOpening()) return;
              const again =
                typeof document !== "undefined" &&
                Boolean(document.querySelector(".voice-assistant-overlay"));
              if (again) return;
              forceCloseVoiceAssistantOverlay();
              void fouAlert("语音通话未能打开，请再试一次。", "语音唤醒");
            }, 2000);
            return;
          }
          forceCloseVoiceAssistantOverlay();
          void fouAlert("语音通话未能打开，请再试一次。", "语音唤醒");
        };
        window.setTimeout(retryOpen, 4000);
      })().catch(() => {
        forceCloseVoiceAssistantOverlay();
        void fouAlert("语音通话未能打开，请再试一次。", "语音唤醒");
      });
    },
    onError: (msg) => {
      void fouAlert(msg, "语音唤醒");
    },
  });
}

function onGlobalVoiceWakeVisibility() {
  void refreshGlobalVoiceWake();
}

async function checkSetup() {
  if (setupInFlight) return;
  if (ready.value && fouOnboardingDone()) return;
  setupInFlight = true;
  checkingSetup.value = true;
  try {
    setup.value = {
      installed: true,
      version: "虚募阁",
      config_exists: true,
      api_key_configured: true,
      configured_providers: [],
      error: "",
    };
  } catch (e) {
    setup.value = {
      installed: true,
      version: "",
      config_exists: true,
      api_key_configured: true,
      configured_providers: [],
      error: setupErrorMessage(e),
    };
  } finally {
    checkingSetup.value = false;
    if (fouOnboardingDone() || readAuthToken()) {
      if (readAuthToken() && !fouOnboardingDone()) {
        markAppOnboardingComplete();
      }
      ready.value = true;
      void bootstrapEmployees()
        .then(() => ensureInitialOfficeDefault())
        .catch((err) => console.warn("bootstrapEmployees", err));
      void bootstrapConcurrency().catch((err) => console.warn("bootstrapConcurrency", err));
    } else {
      ready.value = false;
    }
    if (hot) (hot.data as AppHotData).setupChecked = true;
    setupInFlight = false;
  }
}

function continueWithoutSetup() {
  try {
    window.localStorage.setItem("xu.onboarding.complete", "true");
  } catch {
    /* ignore */
  }
  ready.value = true;
  void bootstrapEmployees()
    .then(() => ensureInitialOfficeDefault())
    .catch((err) => console.warn("bootstrapEmployees", err));
  void bootstrapConcurrency().catch((err) => console.warn("bootstrapConcurrency", err));
  if (route.path === "/onboarding") void router.replace("/home");
}

function dispatchNewSessionHotkey() {
  window.dispatchEvent(new CustomEvent("new-session-hotkey"));
}

/** 菜单「新建会话」：先进入首页再派发，否则 ChatPage 未挂载时事件丢失 */
function openNewSession() {
  if (route.path === "/home" || route.path === "/chat") {
    dispatchNewSessionHotkey();
    return;
  }
  void router.push("/home").then(() => {
    requestAnimationFrame(() => dispatchNewSessionHotkey());
  });
}

function handleTitleBarAction(action: AppMenuAction) {
  switch (action) {
    case "new-session":
      openNewSession();
      break;
    case "open-chat":
      void router.push("/home");
      break;
    case "open-office":
      void router.push("/office");
      break;
    case "open-team":
      void router.push("/team");
      break;
    case "open-memory":
      void router.push("/memory");
      break;
    case "open-connections":
      void router.push("/connections");
      break;
    case "open-dashboard":
      void router.push("/connections");
      break;
    case "open-settings":
      void openAppSettings(route.path);
      break;
    case "open-office-menu":
      if (route.path !== "/office") {
        void router.push("/office").then(() => {
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("xu-open-office-menu"));
          }, 80);
        });
      } else {
        window.dispatchEvent(new CustomEvent("xu-open-office-menu"));
      }
      break;
    case "open-files":
      void router.push("/home");
      window.dispatchEvent(new CustomEvent("toggle-file-tree"));
      break;
    case "toggle-terminal":
      if (route.path === "/ide") {
        window.dispatchEvent(new CustomEvent("xu-ide-menu", { detail: "ide-toggle-terminal" }));
      } else {
        void router.push("/home");
        window.dispatchEvent(new CustomEvent("toggle-terminal"));
      }
      break;
    case "toggle-snapshot":
      void openScreenshotSession();
      break;
    case "show-shortcuts":
      showShortcuts.value = !showShortcuts.value;
      break;
    case "stop-agent":
      window.dispatchEvent(new CustomEvent("stop-active-session"));
      break;
    case "hide-window":
      void invoke("hide_to_tray").catch(() => {});
      break;
    case "quit":
      void invoke("quit_app").catch(async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().close();
        } catch {
          /* ignore */
        }
      });
      break;
    case "ide-new-window":
      void openNewIdeWindow();
      break;
    case "open-software-docs":
      openHelp(route.path === "/ide" ? "chat.ide-panels" : helpTopicForRoute(route.path));
      break;
    case "ide-toggle-chat":
      toggleIdeChatPanel();
      break;
    case "ide-toggle-file-tree":
      toggleIdeSidebar();
      break;
    default:
      if (isIdeMenuAction(action)) {
        window.dispatchEvent(new CustomEvent("xu-ide-menu", { detail: action }));
      }
      break;
  }
}

function onBossNotifyEvent(ev: Event) {
  const detail = (ev as CustomEvent).detail as
    | {
        kind?: BossNotifyKind | string;
        title?: string;
        body?: string;
        channel?: string;
        force?: boolean;
      }
    | undefined;
  if (!detail?.title) return;
  void notifyBoss({
    kind: detail.kind ?? "general",
    title: detail.title,
    body: detail.body,
    channel: detail.channel,
    force: detail.force,
  }).catch((err) => console.warn("xu-boss-notify", err));
}

let unlistenMenu: (() => void) | undefined;
let unlistenEditor: (() => void) | undefined;
let unlistenScreenshot: (() => void) | undefined;
let unlistenBossInbound: (() => void) | undefined;
let unlistenAttach: (() => void) | undefined;
let unlistenCheckUpdate: (() => void) | undefined;
let disposed = false;
let keyHandler: ((e: KeyboardEvent) => void) | undefined;
let contextMenuHandler: ((e: MouseEvent) => void) | undefined;
let cloudAuthLeaseTimer: ReturnType<typeof setInterval> | undefined;

const editCtxVisible = ref(false);
const editCtxX = ref(0);
const editCtxY = ref(0);
const editCtxCanCopy = ref(false);
const editCtxCanPaste = ref(true);
const editCtxCanCut = ref(false);

function isEditableTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return !(el as HTMLInputElement).disabled;
  return el.isContentEditable;
}

function selectionHasText(): boolean {
  const sel = window.getSelection()?.toString() ?? "";
  return sel.length > 0;
}

function openAppEditContextMenu(e: MouseEvent) {
  const t = e.target as Element | null;
  const editable = isEditableTarget(t) || !!t?.closest?.("input,textarea,[contenteditable='true']");
  editCtxCanCopy.value = selectionHasText() || editable;
  editCtxCanCut.value = editable && (selectionHasText() || isEditableTarget(t));
  editCtxCanPaste.value = true;
  editCtxX.value = Math.min(e.clientX, window.innerWidth - 180);
  editCtxY.value = Math.min(e.clientY, window.innerHeight - 160);
  editCtxVisible.value = true;
}

function onAppEditCtxAction(action: AppEditCtxAction) {
  if (action === "reload") {
    window.location.reload();
    return;
  }
  try {
    if (action === "copy") document.execCommand("copy");
    else if (action === "cut") document.execCommand("cut");
    else if (action === "paste") document.execCommand("paste");
  } catch {
    /* WebView 可能限制剪贴板 */
  }
}

async function runCloudAuthLeaseCheck() {
  if (route.meta.public || route.path === "/login") return;
  const { ensureCloudAuthLease } = await import("./utils/cloudAuthLease");
  const lease = await ensureCloudAuthLease();
  if (lease === "logout") {
    resetAuthSessionCheck();
    await router.replace({ path: "/login", query: { reason: "auth_lease_expired" } });
  }
}

onMounted(() => {
  disposed = false;
  if (isScreenshotOverlayWindow()) {
    checkingSetup.value = false;
    ready.value = true;
    return;
  }
  if (isUpdaterShell.value || route.path === "/updater") {
    checkingSetup.value = false;
    ready.value = true;
    return;
  }
  // 冷启动清残留：避免上次唤醒 flag / 黑通话层把整窗挡住
  forceCloseVoiceAssistantOverlay();
  clearStuckUiBlockers();
  ensureBuiltinCommercePlugins();
  migrateAuthStorage();
  if (readAuthToken()) void syncAuthSettingsToDb();
  bindAppRouter(router);
  void checkSetup();
  // 防止 setup/HMR 卡在「正在准备」黑屏态
  window.setTimeout(() => {
    if (!disposed && checkingSetup.value) {
      checkingSetup.value = false;
      if (!ready.value && (fouOnboardingDone() || readAuthToken())) {
        ready.value = true;
      }
      clearStuckUiBlockers();
      forceCloseVoiceAssistantOverlay();
    }
  }, 4000);
  void ensureEmployeeLiveBridge();
  ensureWorkflowBridge();
  void ensureDeliveryReviewBridge();
  startBossReplyWatch();
  ensureProjectQueueBridge();
  void listen<{ text?: string; source?: string }>("xu-boss-inbound", (e) => {
    if (disposed) return;
    const text = e.payload?.text?.trim();
    if (!text) return;
    void (async () => {
      const handled = await handleBossInboundReset(text, e.payload?.source);
      if (!handled) {
        await handleBossMessage(text, undefined, e.payload?.source).catch((err) => console.warn("boss-inbound", err));
      }
    })().catch((err) => console.warn("boss-inbound", err));
  }).then((fn) => {
    if (disposed) fn();
    else unlistenBossInbound = fn;
  });
  writeIdeCliOverride(readIdeCliOverride());
  syncCodingSurfaceToRust();
  void (async () => {
    try {
      await syncScreenshotShortcutFromRust();
      await bootstrapScreenshotShortcut();
    } catch (err) {
      console.warn("screenshot shortcut", err);
    }
  })();
  void import("./office/agencyRoles")
    .then(({ reloadAgencyCatalog }) => reloadAgencyCatalog())
    .catch((err) => {
      const msg =
        err instanceof Error
          ? err.message
          : "岗位目录加载失败。请打开设置 → 岗位数据，登录后下载云端全量包。";
      void fouAlert(msg, "岗位数据");
    });
  void listenScreenshotHotkey(() => {
    if (!disposed) openScreenshotSession();
  }).then((fn) => {
    if (disposed) fn();
    else unlistenScreenshot = fn;
  });

  void listen<{ dataUrl?: string; path?: string; filename?: string }>("xu-attach-chat-image", (e) => {
    if (disposed) return;
    if (!e.payload?.dataUrl && !e.payload?.path) return;
    window.dispatchEvent(new CustomEvent("xu-attach-chat-image", { detail: e.payload }));
  }).then((fn) => {
    if (disposed) fn();
    else unlistenAttach = fn;
  });
  void listen<{ path: string; line?: number }>("xu:open-in-ide", ({ payload }) => {
    void focusIdeWindow(payload?.path, payload?.line);
  }).then((fn) => {
    if (disposed) fn();
    else unlistenEditor = fn;
  });

  void (async () => {
    try {
      const label = getCurrentWindow().label;
      if ((label === "ide" || label.startsWith("ide-")) && route.path !== "/ide" && route.path !== "/canvas") {
        await router.replace({ path: "/ide", query: { ...route.query } });
      }
    } catch {
      /* browser */
    }
  })();

  keyHandler = (e: KeyboardEvent) => {
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    if (modKey && e.key === "/") {
      e.preventDefault();
      showShortcuts.value = !showShortcuts.value;
    }
    if (modKey && e.key === "n") {
      e.preventDefault();
      openNewSession();
    }
    if (modKey && e.key === "w") {
      e.preventDefault();
      showShortcuts.value = false;
    }
    if (modKey && e.key.toLowerCase() === "b" && route.path === "/ide") {
      e.preventDefault();
      toggleIdeSidebar();
    }
    // Escape: 清虚募阁/foucui 遮罩；强制关掉卡住的语音通话黑层；关掉启动自检
    if (e.key === "Escape") {
      clearStuckUiBlockers();
      if (showStartupSelfCheck.value) {
        showStartupSelfCheck.value = false;
      }
      if (isVoiceAssistantOverlayOpen() || document.querySelector(".voice-assistant-overlay")) {
        forceCloseVoiceAssistantOverlay();
      }
    }
    if (e.key === "F12") {
      // 正式包：禁止调试；开发仅 tauri:dev 可开
      e.preventDefault();
      if (!import.meta.env.DEV) return;
      void invoke("xu_open_devtools").catch(() => {});
      return;
    }
    // 生产拦截检查元素 / 查看源码等
    if (!import.meta.env.DEV) {
      const mod = e.ctrlKey || e.metaKey;
      if (
        e.shiftKey &&
        mod &&
        (e.key === "I" || e.key === "i" || e.key === "J" || e.key === "j" || e.key === "C" || e.key === "c")
      ) {
        e.preventDefault();
        return;
      }
      if (mod && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
      }
    }
  };
  window.addEventListener("keydown", keyHandler);

  if (!import.meta.env.DEV) {
    contextMenuHandler = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-xu-context]")) return;
      e.preventDefault();
      openAppEditContextMenu(e);
    };
    document.addEventListener("contextmenu", contextMenuHandler);
  }

  window.addEventListener("xu-boss-notify", onBossNotifyEvent);
  document.addEventListener("visibilitychange", onGlobalVoiceWakeVisibility);
  window.addEventListener("focus", onGlobalVoiceWakeVisibility);
  window.addEventListener(XU_VOICE_WAKE_REFRESH, onGlobalVoiceWakeVisibility);
  void refreshGlobalVoiceWake();

  void listen<AppMenuAction>("app-menu-action", (event) => {
    if (disposed) return;
    handleTitleBarAction(event.payload);
  }).then((fn) => {
    if (disposed) fn();
    else unlistenMenu = fn;
  });

  void listen("check-app-update", () => {
    if (disposed) return;
    void runAppUpdateCheck().catch((err) => console.warn("check-app-update", err));
  }).then((fn) => {
    if (disposed) fn();
    else unlistenCheckUpdate = fn;
  });

  if (isMainWindow() && readAuthToken()) {
    window.setTimeout(() => {
      if (disposed) return;
      void maybeDailyAppUpdateCheck().catch((err) => console.warn("daily-app-update", err));
    }, 2500);
  }

  void runCloudAuthLeaseCheck();
  cloudAuthLeaseTimer = setInterval(() => {
    void runCloudAuthLeaseCheck();
  }, 60 * 60 * 1000);
});

onUnmounted(() => {
  disposed = true;
  if (cosyAutostartTimer) {
    clearTimeout(cosyAutostartTimer);
    cosyAutostartTimer = null;
  }
  if (cloudAuthLeaseTimer) clearInterval(cloudAuthLeaseTimer);
  if (keyHandler) window.removeEventListener("keydown", keyHandler);
  if (contextMenuHandler) document.removeEventListener("contextmenu", contextMenuHandler);
  window.removeEventListener("xu-boss-notify", onBossNotifyEvent);
  document.removeEventListener("visibilitychange", onGlobalVoiceWakeVisibility);
  window.removeEventListener("focus", onGlobalVoiceWakeVisibility);
  window.removeEventListener(XU_VOICE_WAKE_REFRESH, onGlobalVoiceWakeVisibility);
  stopVoiceWake();
  stopBossReplyWatch();
  unlistenMenu?.();
  unlistenCheckUpdate?.();
  unlistenEditor?.();
  unlistenScreenshot?.();
  unlistenBossInbound?.();
  unlistenAttach?.();
});

watch(ready, (value) => {
  if (value) {
    clearStuckUiBlockers();
    if (route.path === "/onboarding") {
      void router.replace("/home");
    }
  }
});

watch(
  () => route.fullPath,
  () => {
    clearStuckUiBlockers();
    if (route.path !== "/login" && fouOnboardingDone() && !ready.value) {
      ready.value = true;
      void bootstrapEmployees()
        .then(() => ensureInitialOfficeDefault())
        .catch((err) => console.warn("bootstrapEmployees", err));
      void bootstrapConcurrency().catch((err) => console.warn("bootstrapConcurrency", err));
    }
  },
);

watch(
  isAuthRoute,
  (auth) => {
    if (isScreenshotOverlayWindow()) return;
    if (auth) void applyLoginWindowSize();
    else void restoreMainWindowSize();
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="isScreenshotOverlay || isCosyConsole || isUpdaterShell" class="screenshot-shell">
    <RouterView />
  </div>
  <div
    v-else
    class="app-shell"
    :class="[`app-shell-${platformKind}`, { 'app-shell-auth': isAuthRoute }]"
  >
    <AppTitleBar
      v-if="!isAuthRoute"
      :platform="platformKind"
      :current-path="route.path"
      :chat-panel-visible="ideChatPanelVisible"
      :chat-history-visible="ideChatHistoryVisible"
      :sidebar-visible="ideSidebarVisible"
      @action="handleTitleBarAction"
      @toggle-chat="toggleIdeChatPanel"
      @toggle-chat-history="toggleIdeChatHistory"
      @toggle-sidebar="toggleIdeSidebar"
    />

    <KeyboardShortcutsPanel v-if="!isAuthRoute" v-model="showShortcuts" />

    <div class="app-body" :class="{ 'app-body-auth': isAuthRoute }">
      <RouterView v-if="isAuthRoute" :key="route.fullPath" />

      <div v-else-if="checkingSetup && !setup && !ready" class="setup-loading">
        <span class="loading-dots" style="font-size: 20px" />
        <div class="dashboard-loading-text ui-font">{{ t("app.preparing", { brand: BRAND_NAME_ZH }) }}</div>
      </div>

      <OnboardingPage
        v-else-if="!ready"
        :checking="checkingSetup"
        :api-key-configured="setup?.api_key_configured ?? false"
        :error="setup?.error || ''"
        @retry="checkSetup"
        @continue="continueWithoutSetup"
      />

      <template v-else>
        <NavBar v-if="!hideNav" />
        <div class="page-area">
          <div class="page-area-main">
            <RouterView :key="route.fullPath" />
          </div>
        </div>
        <ToolApprovalDialog />
        <HelpPanel />
        <CommerceStudioDialog />
        <SimpleTrainingDialog />
        <AppEditContextMenu
          :visible="editCtxVisible"
          :x="editCtxX"
          :y="editCtxY"
          :can-copy="editCtxCanCopy"
          :can-paste="editCtxCanPaste"
          :can-cut="editCtxCanCut"
          @action="onAppEditCtxAction"
          @close="editCtxVisible = false"
        />
        <StartupSelfCheckOverlay
          v-if="showStartupSelfCheck"
          @done="showStartupSelfCheck = false"
        />
      </template>
    </div>
  </div>
</template>
