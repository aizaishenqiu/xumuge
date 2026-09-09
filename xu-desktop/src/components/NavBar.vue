<script setup lang="ts">
/**
 * @file 左侧主导航（试用到期改在个人中心展示）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-02
 * @version 1.3.1
 * @category Layout
 * @algo none
 */
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { FouButton } from "foucui";
import { useNavCollapse } from "../composables/useNavCollapse";
import PersonalCenterDialog from "./PersonalCenterDialog.vue";
import { cachedSession } from "../utils/auth";
import { openAppSettings } from "../utils/openAppSettings";
import { clearStuckUiBlockers } from "../utils/clearStuckUiBlockers";

const NAV_ITEMS = [
  { path: "/home", labelKey: "nav.home", icon: "home-4-line" },
  { path: "/office", labelKey: "nav.office", icon: "building-4-line" },
  { path: "/projects", labelKey: "nav.projects", icon: "folder-3-line" },
  { path: "/monitor", labelKey: "nav.monitor", icon: "dashboard-line" },
  { path: "/contacts", labelKey: "nav.contacts", icon: "contacts-book-2-line" },
  { path: "/team", labelKey: "nav.team", icon: "team-line" },
  { path: "/agency", labelKey: "nav.agency", icon: "user-star-line" },
  { path: "/memory", labelKey: "nav.memory", icon: "brain-line" },
  { path: "/connections", labelKey: "nav.connections", icon: "links-line" },
  { path: "/settings", labelKey: "nav.settings", icon: "settings-3-line" },
  { path: "/feedback", labelKey: "nav.feedback", icon: "bug-line" },
  { path: "/help", labelKey: "nav.help", icon: "question-line" },
] as const;

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { collapsed, toggle } = useNavCollapse();
const profileOpen = ref(false);

const userInitial = computed(() => {
  const u = cachedSession()?.user;
  const nick = u?.nickname?.trim();
  if (nick) return nick.slice(0, 1);
  const name = u?.username?.trim();
  if (!name) return "我";
  return name.slice(0, 1).toUpperCase();
});

const profileTitle = computed(() => {
  const u = cachedSession()?.user;
  return u?.nickname?.trim() || u?.username?.trim() || "我";
});

/**
 * Duty: 侧栏路由跳转；先解除遗留遮罩，避免设置等入口被挡点击。
 * Settings 优先走 hash 直达，失败再 fallback，避免 openAppSettings 静默失败。
 */
function onNavClick(path: string) {
  clearStuckUiBlockers();
  if (path === "/settings") {
    if (route.path === "/ide") {
      void openAppSettings("/ide");
      return;
    }
    if (route.path === "/settings") return;
    void router.push("/settings").catch((err) => {
      console.warn("[nav] settings push failed", err);
      clearStuckUiBlockers();
      try {
        window.location.hash = "#/settings";
      } catch {
        /* ignore */
      }
    });
    return;
  }
  if (route.path === path || (path === "/home" && route.path === "/chat")) return;
  void router.push(path);
}

</script>

<template>
  <nav class="navbar" :class="{ collapsed }" aria-label="主导航">
    <div class="navbar-inner">
      <FouButton
        v-for="item in NAV_ITEMS"
        :key="item.path"
        class="navbar-item"
        :class="{ active: route.path === item.path || (item.path === '/home' && route.path === '/chat') }"
        :icon="item.icon"
        text
        native-type="button"
        :aria-label="t(item.labelKey)"
        :title="t(item.labelKey)"
        @click.stop="onNavClick(item.path)"
      >
        <span v-if="!collapsed" class="navbar-label ui-font">{{ t(item.labelKey) }}</span>
      </FouButton>
      <div class="navbar-spacer" />
      <FouButton
        class="navbar-item navbar-profile navbar-profile-avatar-only"
        icon="user-3-line"
        text
        native-type="button"
        :aria-label="t('nav.profile')"
        :title="profileTitle"
        @click="profileOpen = true"
      >
        <span class="navbar-avatar ui-font" aria-hidden="true">{{ userInitial }}</span>
      </FouButton>
    </div>

    <PersonalCenterDialog v-model="profileOpen" />

    <FouButton
      class="navbar-edge-toggle"
      :icon="collapsed ? 'arrow-right-s-line' : 'arrow-left-s-line'"
      text
      native-type="button"
      :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
      :title="collapsed ? '展开' : '收起'"
      @click="toggle"
    />
  </nav>
</template>

<style scoped>
.navbar {
  position: relative;
  z-index: 100;
  width: var(--navbar-w);
  flex-shrink: 0;
  transition: width 0.2s ease;
  background: var(--surface-soft);
  border-right: none;
  overflow: visible;
  -webkit-app-region: no-drag;
}
.navbar.collapsed {
  width: 0;
  border-right: none;
}
.navbar-inner {
  width: var(--navbar-w);
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0 6px;
  gap: 2px;
  overflow-x: hidden;
  overflow-y: auto;
  opacity: 1;
  transition: opacity 0.15s ease;
  scrollbar-width: thin;
  pointer-events: auto;
  -webkit-app-region: no-drag;
}
.navbar :deep(.navbar-item.fou-button),
.navbar :deep(.navbar-profile.fou-button),
.navbar :deep(.navbar-edge-toggle.fou-button) {
  -webkit-app-region: no-drag;
  pointer-events: auto;
  cursor: pointer;
}
.navbar.collapsed .navbar-inner {
  opacity: 0;
  pointer-events: none;
}
.navbar-label {
  font-size: 10px;
  line-height: 1.1;
  max-width: 62px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.navbar :deep(.navbar-item.fou-button) {
  flex-direction: column;
  height: auto;
  min-height: 46px;
  padding: 6px 4px;
  gap: 3px;
  border-radius: 10px;
  color: var(--muted);
}
.navbar-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--primary) 24%, var(--surface-card));
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
}
.navbar :deep(.navbar-profile.fou-button) {
  margin-top: 2px;
  border-top: 1px solid var(--hairline);
  padding-top: 8px;
  min-height: 40px;
  border-radius: 10px 10px 0 0;
}
.navbar :deep(.navbar-item.fou-button.active),
.navbar :deep(.navbar-item.fou-button:hover) {
  color: var(--ink);
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-card));
}
.navbar-spacer {
  flex: 1;
  min-height: 4px;
}
.navbar :deep(.navbar-edge-toggle.fou-button) {
  position: absolute;
  top: 50%;
  right: -11px;
  transform: translateY(-50%);
  z-index: 40;
  width: 14px;
  min-width: 14px;
  height: 56px;
  padding: 0;
  border: 1px solid var(--hairline);
  border-radius: 0 8px 8px 0;
  background: var(--surface-card);
  color: var(--muted);
  box-shadow: 2px 0 8px rgba(20, 30, 40, 0.08);
}
.navbar :deep(.navbar-edge-toggle.fou-button:hover) {
  color: var(--primary);
}
.navbar.collapsed :deep(.navbar-edge-toggle.fou-button) {
  right: -14px;
}
.navbar :deep(.navbar-profile-avatar-only .fou-icon) {
  display: none !important;
}
</style>
