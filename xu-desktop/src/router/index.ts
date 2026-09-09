/**
 * @file 桌面路由表（重页懒加载，减轻 IDE/独立窗口首包）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-05
 * @version 1.1.0
 * @category Config
 * @algo hash-router-lazy-pages
 */
import { createRouter, createWebHashHistory } from "vue-router";
import LoginPage from "../pages/LoginPage.vue";
import {
  hydrateAuthFromDb,
  migrateAuthStorage,
  openShowcaseRegister,
  readAuthToken,
  restoreSession,
} from "../utils/auth";
import {
  isProductExpired,
  PRODUCT_EXPIRED_MSG,
} from "../utils/productExpiry";
import { fouAlert } from "foucui";

function defaultLandingPath(): string {
  return readAuthToken() ? "/home" : "/login";
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginPage, meta: { public: true } },
    {
      path: "/register",
      name: "register",
      meta: { public: true },
      beforeEnter: () => {
        void openShowcaseRegister();
        return { path: "/login" };
      },
      component: LoginPage,
    },
    { path: "/", redirect: () => defaultLandingPath() },
    { path: "/home", name: "home", component: () => import("../pages/HomePage.vue") },
    { path: "/projects", name: "projects", component: () => import("../pages/ProjectsPage.vue") },
    { path: "/office", name: "office", component: () => import("../pages/OfficePage.vue") },
    { path: "/monitor", name: "monitor", component: () => import("../pages/MonitorPage.vue") },
    { path: "/contacts", name: "contacts", component: () => import("../pages/ContactsPage.vue") },
    { path: "/team", name: "team", component: () => import("../pages/TeamPage.vue") },
    { path: "/agency", name: "agency", component: () => import("../pages/AgencyRolesPage.vue") },
    { path: "/connections", name: "connections", component: () => import("../pages/ConnectionsPage.vue") },
    { path: "/help", name: "help", component: () => import("../pages/HelpPage.vue") },
    { path: "/memory", name: "memory", component: () => import("../pages/MemoryPage.vue") },
    {
      path: "/onboarding",
      name: "onboarding",
      component: () => import("../pages/OnboardingPage.vue"),
    },
    { path: "/chat", redirect: "/home" },
    { path: "/ide", name: "ide", component: () => import("../pages/IdePage.vue") },
    { path: "/canvas", name: "canvas", component: () => import("../pages/CanvasPage.vue") },
    { path: "/settings", name: "settings", component: () => import("../pages/SettingsPage.vue") },
    { path: "/feedback", name: "feedback", component: () => import("../pages/BugFeedbackPage.vue") },
    {
      path: "/cosy-console",
      name: "cosy-console",
      component: () => import("../pages/CosyVoiceConsolePage.vue"),
      meta: { public: true },
    },
    { path: "/dashboard", redirect: "/projects" },
    {
      path: "/screenshot-overlay",
      name: "screenshot-overlay",
      component: () => import("../pages/ScreenshotOverlayPage.vue"),
      meta: { public: true },
    },
    {
      path: "/updater",
      name: "updater",
      component: () => import("../pages/UpdaterPage.vue"),
      meta: { public: true },
    },
  ],
});

let sessionChecked = false;
let authHydrated = false;

const AUTH_BOOT_TIMEOUT_MS = 12_000;

async function ensureAuthHydrated(): Promise<void> {
  if (authHydrated) return;
  authHydrated = true;
  try {
    migrateAuthStorage();
    await hydrateAuthFromDb();
  } catch {
    /* ignore */
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/** Reset after forced logout (e.g. cloud auth lease expiry). */
export function resetAuthSessionCheck(): void {
  sessionChecked = false;
}

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  await ensureAuthHydrated();
  if (to.path !== "/login" && isProductExpired()) {
    try {
      fouAlert({ title: "试用到期", message: PRODUCT_EXPIRED_MSG });
    } catch {
      /* ignore */
    }
    return { path: "/login", query: { reason: "product_expired" } };
  }
  const token = readAuthToken();
  if (!token) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }
  if (to.path === "/login") {
    return { path: "/home" };
  }
  if (!sessionChecked) {
    const s = await withTimeout(restoreSession(), AUTH_BOOT_TIMEOUT_MS, null);
    sessionChecked = true;
    if (!s) return { path: "/login", query: { redirect: to.fullPath } };
  }
  const { ensureCloudAuthLease } = await import("../utils/cloudAuthLease");
  const lease = await withTimeout(ensureCloudAuthLease(), AUTH_BOOT_TIMEOUT_MS, "skipped" as const);
  if (lease === "logout") {
    resetAuthSessionCheck();
    return {
      path: "/login",
      query: { redirect: to.fullPath, reason: "auth_lease_expired" },
    };
  }
  return true;
});
