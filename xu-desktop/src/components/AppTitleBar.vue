<script setup lang="ts">
/**
 * @file AppTitleBar.vue 无边框窗口顶栏
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-20
 * @updated 2026-09-06
 * @version 1.2.0
 * @category Layout
 * @algo tauri-drag-region
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FouButton } from "foucui";
import { getWindowMenu, type AppMenuAction } from "../appMenu";
import type { PlatformKind } from "../utils/platform";
import { BRAND_ICON_URL, BRAND_NAME, readCompanyName } from "../utils/brandSettings";
import { focusIdeWindow } from "../utils/windowManager";
import { openAppSettings } from "../utils/openAppSettings";

const props = defineProps<{
  platform: PlatformKind;
  currentPath: string;
  /** IDE: whether right chat panel is visible */
  chatPanelVisible?: boolean;
  /** IDE: whether chat session history list is visible */
  chatHistoryVisible?: boolean;
  /** IDE: whether left sidebar (file tree) is visible */
  sidebarVisible?: boolean;
}>();

const emit = defineEmits<{
  action: [action: AppMenuAction];
  "toggle-chat": [];
  "toggle-chat-history": [];
  "toggle-sidebar": [];
}>();

const openMenu = ref<string | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const companyName = ref(readCompanyName());
const { t } = useI18n();
const isIdeSurface = computed(() => props.currentPath === "/ide");
const menu = computed(() => getWindowMenu(props.platform, { ide: isIdeSurface.value }));
const showWindowControls = computed(() => props.platform !== "macos");

function pageLabel(path: string) {
  switch (path) {
    case "/office":
      return t("titleBar.office");
    case "/team":
      return t("titleBar.team");
    case "/agency":
      return t("titleBar.agency");
    case "/memory":
      return t("titleBar.memory");
    case "/connections":
      return t("titleBar.connections");
    case "/settings":
      return t("titleBar.settings");
    case "/feedback":
      return t("titleBar.feedback");
    case "/onboarding":
      return t("titleBar.onboarding");
    case "/ide":
      return t("titleBar.ide");
    case "/canvas":
      return t("titleBar.canvas");
    case "/home":
    case "/chat":
      return t("titleBar.home");
    default:
      return BRAND_NAME;
  }
}

function refreshBrand() {
  companyName.value = readCompanyName();
}

async function withCurrentWindow(action: "minimize" | "toggleMaximize" | "close") {
  try {
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "toggleMaximize") await appWindow.toggleMaximize();
    if (action === "close") await appWindow.close();
  } catch (error) {
    console.warn(`Window control failed: ${action}`, error);
  }
}

function runAction(action: AppMenuAction) {
  openMenu.value = null;
  emit("action", action);
}

/** 顶栏齿轮：直接路由，避免 emit 链或 drag 区域吞掉点击 */
function onSettingsClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  openMenu.value = null;
  if (props.currentPath === "/office") {
    emit("action", "open-office-menu");
    return;
  }
  void openAppSettings(props.currentPath);
}

function handlePointerDown(event: PointerEvent) {
  if (!rootRef.value?.contains(event.target as Node)) {
    openMenu.value = null;
  }
}

/** Duty: 拖窗走 data-tauri-drag-region，禁止 await 后再 startDragging（会卡死 WebView）。 */
function handleDoubleClick(e: MouseEvent) {
  const target = e.target as Element;
  if (target.closest("button, input, a, [role='button'], .fou-button, .qiu-titlebar-no-drag")) return;
  void withCurrentWindow("toggleMaximize");
}

onMounted(() => {
  window.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("xu-brand-settings", refreshBrand);
  window.addEventListener("storage", refreshBrand);
});
onUnmounted(() => {
  window.removeEventListener("pointerdown", handlePointerDown);
  window.removeEventListener("xu-brand-settings", refreshBrand);
  window.removeEventListener("storage", refreshBrand);
});
</script>

<template>
  <div
    ref="rootRef"
    class="app-titlebar qiu-app-titlebar"
    :class="`app-titlebar-${platform}`"
    data-tauri-drag-region
    @dblclick="handleDoubleClick"
  >
    <div class="app-titlebar-left" data-tauri-drag-region>
      <div class="app-titlebar-brand" :title="BRAND_NAME" data-tauri-drag-region>
        <img :src="BRAND_ICON_URL" alt="" class="app-titlebar-mark brand-mark-img" data-tauri-drag-region />
      </div>

      <FouButton
        v-if="isIdeSurface"
        class="app-titlebar-icon-btn app-titlebar-sidebar-toggle qiu-titlebar-no-drag"
        :icon="sidebarVisible === false ? 'layout-left-2-line' : 'sidebar-fold-line'"
        text
        size="small"
        native-type="button"
        :title="sidebarVisible === false ? '显示侧栏与文件树' : '隐藏侧栏与文件树'"
        :aria-label="sidebarVisible === false ? '显示侧栏与文件树' : '隐藏侧栏与文件树'"
        @click="emit('toggle-sidebar')"
      />

      <nav v-if="menu.length > 0" class="app-titlebar-menu qiu-titlebar-no-drag" aria-label="Application menu">
        <div v-for="section in menu" :key="section.label" class="app-titlebar-menu-root">
          <FouButton
            class="app-titlebar-menu-btn qiu-titlebar-no-drag"
            :class="{ active: openMenu === section.label }"
            text
            size="small"
            native-type="button"
            :icon="section.icon"
            @mousedown.stop
            @click.stop="openMenu = openMenu === section.label ? null : section.label"
          >
            {{ section.label }}
          </FouButton>
          <div v-if="openMenu === section.label" class="app-titlebar-menu-popover fou-menu-panel">
            <template v-for="(item, idx) in section.items" :key="`${section.label}-${idx}-${item.label}`">
              <div v-if="item.separator" class="app-titlebar-menu-sep" role="separator" />
              <button
                v-else
                type="button"
                class="app-titlebar-menu-item fou-menu-row qiu-titlebar-no-drag"
                :disabled="!item.action"
                @mousedown.stop
                @click.stop="item.action && runAction(item.action)"
              >
                <span class="xu-menu-row-label">{{ item.label }}</span>
                <kbd v-if="item.shortcut" class="xu-menu-row-kbd">{{ item.shortcut }}</kbd>
              </button>
            </template>
          </div>
        </div>
      </nav>
    </div>

    <div class="app-titlebar-actions qiu-app-titlebar-actions qiu-titlebar-no-drag">
      <FouButton
        v-if="!isIdeSurface"
        class="app-titlebar-icon-btn"
        icon="code-box-line"
        text
        size="small"
        native-type="button"
        title="打开 IDE"
        aria-label="打开 IDE"
        @click="void focusIdeWindow()"
      >
        IDE
      </FouButton>
      <FouButton
        v-if="isIdeSurface"
        class="app-titlebar-icon-btn"
        :icon="chatHistoryVisible === false ? 'history-line' : 'chat-history-line'"
        text
        native-type="button"
        :title="chatHistoryVisible === false ? '显示历史会话' : '隐藏历史会话'"
        :aria-label="chatHistoryVisible === false ? '显示历史会话' : '隐藏历史会话'"
        @click="emit('toggle-chat-history')"
      />
      <FouButton
        v-if="isIdeSurface"
        class="app-titlebar-icon-btn"
        :icon="chatPanelVisible === false ? 'layout-right-2-line' : 'layout-right-line'"
        text
        native-type="button"
        :title="chatPanelVisible === false ? '显示右侧对话' : '关闭右侧对话'"
        :aria-label="chatPanelVisible === false ? '显示右侧对话' : '关闭右侧对话'"
        @click="emit('toggle-chat')"
      />
      <FouButton
        class="app-titlebar-icon-btn app-titlebar-settings qiu-titlebar-no-drag"
        icon="settings-3-line"
        text
        native-type="button"
        title="设置"
        aria-label="设置"
        @mousedown.stop
        @click.stop="onSettingsClick"
      />
    </div>

    <div v-if="showWindowControls" class="app-window-controls qiu-app-titlebar-winctl qiu-titlebar-no-drag">
      <FouButton
        icon="subtract-line"
        text
        native-type="button"
        aria-label="Minimize"
        title="最小化"
        @click="withCurrentWindow('minimize')"
      />
      <FouButton
        icon="checkbox-blank-line"
        text
        native-type="button"
        aria-label="Maximize"
        title="最大化"
        @click="withCurrentWindow('toggleMaximize')"
      />
      <FouButton
        icon="close-line"
        text
        native-type="button"
        aria-label="Close"
        title="关闭"
        @click="withCurrentWindow('close')"
      />
    </div>
  </div>
</template>
