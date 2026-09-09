<script setup lang="ts">
/**
 * QQ / WeChat style compact login (600×350).
 * Enterprise accounts must pick local roles before entering the app.
 * @author qiuye <yjk150@qq.com>
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { FouButton, fouAlert, fouMsg } from "foucui";
import { captureApiError, sanitizeUserMessage, toUserError } from "../utils/userFacingError";
import {
  bootstrapAuth,
  clearClientDefaults,
  cloudLogin,
  getAccountServerUrl,
  markAppOnboardingComplete,
  openShowcaseRegister,
  readAuthToken,
  restoreSession,
  type AuthSession,
} from "../utils/auth";
import { getDevLoginPassword, getDevLoginUser } from "../utils/appEnv";
import { BRAND_ICON_URL, BRAND_NAME_EN, BRAND_NAME_ZH } from "../utils/brandSettings";
import {
  applyLoginRoleWindowSize,
  applyLoginWindowSize,
  closeLoginWindow,
  minimizeLoginWindow,
  restoreMainWindowSize,
} from "../utils/loginWindow";
import {
  getEditionPrefs,
  listAllRolesForPicker,
  setEditionPrefs,
} from "../license/edition";
import type { RolePackMeta } from "../office/rolePackApi";

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const username = ref("");
const password = ref("");
const busy = ref(false);
const error = ref("");
const isDevBuild = ref(false);
/** credentials | enterprise-roles */
const step = ref<"credentials" | "enterprise-roles">("credentials");
const roleMode = ref<"single" | "multi">("multi");
const roleFilter = ref("");
const roleCatalog = ref<RolePackMeta[]>([]);
const selectedRoleIds = ref<string[]>([]);
let titleClicks = 0;
let titleClickTimer: ReturnType<typeof setTimeout> | undefined;
let enteredApp = false;

const filteredRoles = computed(() => {
  const q = roleFilter.value.trim().toLowerCase();
  const list = roleCatalog.value;
  if (!q) return list.slice(0, 120);
  return list
    .filter((r) => {
      const blob = `${r.nameZh || ""} ${r.name || ""} ${r.id} ${r.divisionZh || ""}`.toLowerCase();
      return blob.includes(q);
    })
    .slice(0, 120);
});

async function goRegister() {
  try {
    await openShowcaseRegister();
  } catch (e) {
    error.value = toUserError(e).replace(/^Error:\s*/i, "") || "无法打开注册页";
  }
}

async function enterApp() {
  enteredApp = true;
  markAppOnboardingComplete();
  await restoreMainWindowSize();
  const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "";
  await router.replace(redirect && redirect !== "/login" ? redirect : "/home");
}

function isEnterpriseAccount(s: AuthSession): boolean {
  const fromCloud = String(s.user?.edition || "").toLowerCase();
  if (fromCloud === "enterprise") return true;
  const role = String(s.user?.role || "").toLowerCase();
  return role === "enterprise" || role === "org" || role === "company";
}

async function maybeEnterEnterpriseRoleStep(s: AuthSession): Promise<boolean> {
  let prefs = await getEditionPrefs();
  try {
    if (prefs.activeRoleIds?.length) {
      selectedRoleIds.value = [...prefs.activeRoleIds];
    }
  } catch {
    /* ignore */
  }
  const enterprise = isEnterpriseAccount(s);
  if (!enterprise) return false;

  // 已选过角色：跳过每次登录的角色步
  if (prefs.activeRoleIds?.length) {
    try {
      if (prefs.edition !== "enterprise") {
        await setEditionPrefs({ ...prefs, edition: "enterprise" });
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  try {
    const p2 = await getEditionPrefs();
    if (p2.edition !== "enterprise") {
      await setEditionPrefs({ ...p2, edition: "enterprise" });
    }
  } catch {
    /* ignore */
  }

  busy.value = true;
  try {
    roleCatalog.value = await listAllRolesForPicker();
  } catch (e) {
    error.value = toUserError(e).replace(/^Error:\s*/i, "") || "无法加载角色列表";
    if (prefs.activeRoleIds?.length) return false;
    void fouAlert("角色列表加载失败，可稍后到设置重试；本次先以默认权限进入。", "登录");
    return false;
  } finally {
    busy.value = false;
  }
  step.value = "enterprise-roles";
  await applyLoginRoleWindowSize();
  return true;
}

onMounted(async () => {
  if (route.query.reason === "auth_lease_expired") {
    error.value = t("login.leaseExpired");
  }
  try {
    const b = await bootstrapAuth();
    isDevBuild.value = Boolean(b.isDevBuild);
    if (b.clearedStorage) clearClientDefaults();
  } catch {
    /* ignore */
  }
  const token = readAuthToken();
  if (token) {
    const s = await restoreSession();
    if (s) {
      const needRoles = await maybeEnterEnterpriseRoleStep(s);
      if (!needRoles) await enterApp();
      return;
    }
  }
  await nextTick();
  await applyLoginWindowSize();
  window.setTimeout(() => {
    void applyLoginWindowSize();
  }, 120);
});

onUnmounted(() => {
  if (!enteredApp) {
    void restoreMainWindowSize();
  }
});

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    const user = username.value.trim();
    const pass = password.value;
    if (!user || !pass) {
      error.value = t("login.missingCredentials");
      return;
    }
    const s = await cloudLogin(user, pass, getAccountServerUrl());
    const needRoles = await maybeEnterEnterpriseRoleStep(s);
    if (!needRoles) await enterApp();
  } catch (e) {
    if (!captureApiError(e, (msg) => {
      error.value = msg;
    })) {
      const msg = sanitizeUserMessage(e instanceof Error ? e.message : e, "登录失败");
      error.value = msg;
      void fouAlert(msg, "提示");
    }
  } finally {
    busy.value = false;
  }
}

async function confirmRoles() {
  if (selectedRoleIds.value.length === 0) {
    error.value = roleMode.value === "single" ? "请选择一个角色" : "请至少选择一个角色";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const prefs = await getEditionPrefs();
    await setEditionPrefs({
      ...prefs,
      edition: "enterprise",
      activeRoleIds: [...selectedRoleIds.value],
    });
    await enterApp();
  } catch (e) {
    error.value = sanitizeUserMessage(e instanceof Error ? e.message : e, "操作失败");
  } finally {
    busy.value = false;
  }
}

function toggleRole(id: string) {
  if (roleMode.value === "single") {
    selectedRoleIds.value = [id];
    return;
  }
  const set = new Set(selectedRoleIds.value);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  selectedRoleIds.value = [...set];
}

function setRoleMode(mode: "single" | "multi") {
  roleMode.value = mode;
  if (mode === "single" && selectedRoleIds.value.length > 1) {
    selectedRoleIds.value = selectedRoleIds.value.slice(0, 1);
  }
}

function backToCredentials() {
  step.value = "credentials";
  error.value = "";
  void applyLoginWindowSize();
}

/** Dev only: remote login via env (hidden — click brand 3×). */
async function oneClickDev() {
  if (!isDevBuild.value) return;
  busy.value = true;
  error.value = "";
  try {
    const user = getDevLoginUser();
    const pass = getDevLoginPassword();
    const s = await cloudLogin(user, pass, getAccountServerUrl());
    const needRoles = await maybeEnterEnterpriseRoleStep(s);
    if (!needRoles) await enterApp();
  } catch (e) {
    if (!captureApiError(e, (msg) => {
      error.value = msg;
    })) {
      const msg = sanitizeUserMessage(e instanceof Error ? e.message : e, "登录失败");
      error.value = msg;
      void fouAlert(msg, "提示");
    }
  } finally {
    busy.value = false;
  }
}

function onBrandClick() {
  if (!isDevBuild.value) return;
  titleClicks += 1;
  clearTimeout(titleClickTimer);
  titleClickTimer = setTimeout(() => {
    titleClicks = 0;
  }, 800);
  if (titleClicks >= 3) {
    titleClicks = 0;
    void oneClickDev();
  }
}
</script>

<template>
  <div class="qq-login" :class="{ 'qq-login--roles': step === 'enterprise-roles' }">
    <aside class="qq-login-brand" data-tauri-drag-region @click="onBrandClick">
      <img class="qq-login-brand-mark" :src="BRAND_ICON_URL" alt="" draggable="false" />
      <div class="qq-login-brand-text">
        <strong>{{ BRAND_NAME_ZH }}</strong>
        <span>{{ BRAND_NAME_EN }}</span>
      </div>
      <p class="qq-login-brand-lead">
        {{ step === "enterprise-roles" ? t("login.enterpriseLead") : t("login.brandLead") }}
      </p>
    </aside>

    <section class="qq-login-panel">
      <div class="qq-login-chrome" data-tauri-drag-region>
        <FouButton
          class="qq-win-btn"
          icon="subtract-line"
          text
          size="small"
          native-type="button"
          :title="t('login.minimize')"
          :aria-label="t('login.minimize')"
          @click="minimizeLoginWindow"
        />
        <FouButton
          class="qq-win-btn qq-win-close"
          icon="close-line"
          text
          size="small"
          native-type="button"
          :title="t('login.close')"
          :aria-label="t('login.close')"
          @click="closeLoginWindow"
        />
      </div>

      <div v-if="step === 'credentials'" class="qq-login-body">
        <h2 class="qq-login-title ui-font">{{ t("login.title") }}</h2>

        <label class="qq-field">
          <FouIcon icon="user-line" size="16" class="qq-field-icon" />
          <input
            v-model="username"
            class="qq-native-input ui-font"
            type="text"
            :placeholder="t('login.usernamePlaceholder')"
            autocomplete="username"
          />
        </label>
        <label class="qq-field">
          <FouIcon icon="lock-password-line" size="16" class="qq-field-icon" />
          <input
            v-model="password"
            class="qq-native-input ui-font"
            type="password"
            :placeholder="t('login.passwordPlaceholder')"
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </label>

        <p v-if="error" class="qq-err">{{ error }}</p>

        <FouButton
          class="qq-login-btn"
          type="primary"
          icon="login-box-line"
          :disabled="busy"
          @click="submit"
        >
          {{ busy ? t("login.submitting") : t("login.submit") }}
        </FouButton>

        <div class="qq-login-links">
          <FouButton
            icon="user-add-line"
            text
            size="small"
            native-type="button"
            @click="goRegister"
          >
            {{ t("login.register") }}
          </FouButton>
        </div>
      </div>

      <div v-else class="qq-login-body qq-login-body--roles">
        <h2 class="qq-login-title ui-font">选择本机角色</h2>
        <p class="qq-role-hint">企业账号需指定本机要运行的角色后再进入系统</p>

        <div class="qq-role-modes">
          <FouButton
            :type="roleMode === 'single' ? 'primary' : 'default'"
            icon="radio-button-line"
            size="small"
            native-type="button"
            @click="setRoleMode('single')"
          >
            单选
          </FouButton>
          <FouButton
            :type="roleMode === 'multi' ? 'primary' : 'default'"
            icon="checkbox-multiple-line"
            size="small"
            native-type="button"
            @click="setRoleMode('multi')"
          >
            多选
          </FouButton>
          <span class="qq-role-count">已选 {{ selectedRoleIds.length }}</span>
        </div>

        <label class="qq-field qq-field--filter">
          <FouIcon icon="search-line" size="16" class="qq-field-icon" />
          <input
            v-model="roleFilter"
            class="qq-native-input ui-font"
            type="search"
            placeholder="搜索角色…"
          />
        </label>

        <div class="qq-role-list">
          <FouButton
            v-for="r in filteredRoles"
            :key="r.id"
            size="small"
            class="qq-role-chip"
            :icon="
              selectedRoleIds.includes(r.id)
                ? roleMode === 'single'
                  ? 'radio-button-line'
                  : 'checkbox-circle-line'
                : roleMode === 'single'
                  ? 'checkbox-blank-circle-line'
                  : 'checkbox-blank-line'
            "
            :type="selectedRoleIds.includes(r.id) ? 'primary' : 'default'"
            native-type="button"
            @click="toggleRole(r.id)"
          >
            {{ r.nameZh || r.name || r.id }}
          </FouButton>
          <p v-if="filteredRoles.length === 0" class="qq-role-empty">无匹配角色</p>
        </div>

        <p v-if="error" class="qq-err">{{ error }}</p>

        <div class="qq-role-actions">
          <FouButton
            icon="arrow-left-line"
            size="small"
            native-type="button"
            :disabled="busy"
            @click="backToCredentials"
          >
            返回
          </FouButton>
          <FouButton
            class="qq-login-btn"
            type="primary"
            icon="check-line"
            :disabled="busy"
            @click="confirmRoles"
          >
            {{ busy ? "进入中…" : "进入系统" }}
          </FouButton>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.qq-login {
  width: 100%;
  height: 100%;
  min-width: 600px;
  min-height: 350px;
  margin: 0;
  display: grid;
  grid-template-columns: 220px 1fr;
  overflow: hidden;
  background: #fff;
  user-select: none;
}

.qq-login-brand {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 16px;
  color: #f8fafc;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(201, 162, 74, 0.28), transparent 55%),
    linear-gradient(165deg, #1a2230 0%, #0f141c 55%, #121820 100%);
  cursor: default;
}

.qq-login-brand-mark {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.qq-login-brand-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.2;
  gap: 4px;
}

.qq-login-brand-text strong {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.qq-login-brand-text span {
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #c9a24a;
}

.qq-login-brand-lead {
  margin: 8px 0 0;
  font-size: 12px;
  color: rgba(248, 250, 252, 0.72);
  text-align: center;
}

.qq-login-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #f7f8fa;
}

.qq-login-chrome {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
  height: 36px;
  padding: 4px 6px 0;
  flex-shrink: 0;
}

.qq-win-btn {
  width: 28px !important;
  min-width: 28px !important;
  height: 28px !important;
  color: #64748b !important;
}

.qq-win-btn:hover {
  background: rgba(15, 23, 42, 0.06) !important;
}

.qq-win-close:hover {
  background: #e81123 !important;
  color: #fff !important;
}

.qq-login-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  padding: 0 40px 28px;
  box-sizing: border-box;
  min-height: 0;
}

.qq-login-body--roles {
  justify-content: flex-start;
  padding-top: 4px;
  padding-bottom: 16px;
}

.qq-login-title {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 650;
  color: #1e293b;
  text-align: center;
}

.qq-role-hint {
  margin: -8px 0 12px;
  font-size: 12px;
  color: #64748b;
  text-align: center;
}

/* Single-layer field — no nested FouInput chrome */
.qq-field {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 0 12px;
  height: 40px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #d0d5dd;
  box-sizing: border-box;
}

.qq-field:focus-within {
  border-color: #12b7f5;
}

.qq-field--filter {
  margin-bottom: 8px;
  height: 34px;
}

.qq-field-icon {
  flex-shrink: 0;
  color: #94a3b8;
}

.qq-native-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0 !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
  font-size: 14px;
  color: #1e293b;
  padding: 0;
}

.qq-native-input::placeholder {
  color: #94a3b8;
}

.qq-err {
  width: 100%;
  margin: 0 0 8px;
  color: #b91c1c;
  font-size: 12px;
  text-align: center;
}

.qq-login-btn {
  width: 100%;
  margin-top: 6px;
  height: 40px !important;
}

.qq-login-btn :deep(button),
.qq-login-btn.fou-button {
  width: 100%;
  background: #12b7f5 !important;
  border-color: #12b7f5 !important;
}

.qq-login-btn :deep(button):hover,
.qq-login-btn.fou-button:hover {
  background: #0aa1db !important;
  border-color: #0aa1db !important;
}

.qq-login-links {
  margin-top: 10px;
  display: flex;
  justify-content: center;
}

.qq-role-modes {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.qq-role-count {
  margin-left: auto;
  font-size: 12px;
  color: #64748b;
}

.qq-role-list {
  flex: 1;
  min-height: 120px;
  max-height: 180px;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-content: flex-start;
  padding: 4px 0 8px;
}

.qq-role-chip {
  max-width: 100%;
}

.qq-role-empty {
  margin: 12px auto;
  font-size: 12px;
  color: #94a3b8;
}

.qq-role-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.qq-role-actions .qq-login-btn {
  flex: 1;
  margin-top: 0;
}
</style>
