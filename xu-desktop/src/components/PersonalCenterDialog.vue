<script setup lang="ts">
/**
 * @file 个人中心：昵称（云端 me）/ 用量；不展示密码与手机号
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-01
 * @version 1.2.0
 * @category Account
 * @algo none
 */
import { FouButton, FouDialog, FouInput } from "foucui";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import BillingPanel from "./chat/BillingPanel.vue";
import {
  BRAND_NAME,
  COMPANY_NAME_MAX,
  DEFAULT_COMPANY_NAME,
  readCompanyName,
  writeCompanyName,
} from "../utils/brandSettings";
import { getDefaultRemotePreset, loadGlobalModelProfiles } from "../utils/globalModelProfiles";
import { cachedSession, fetchCloudMe, logout } from "../utils/auth";
import { applyLoginWindowSize } from "../utils/loginWindow";
import { productTestModeExpiryLine } from "../utils/productExpiry";
import { toUserError } from "../utils/userFacingError";

const visible = defineModel<boolean>({ default: false });

type TabId = "profile" | "billing";

const router = useRouter();
const tab = ref<TabId>("profile");
const companyName = ref(readCompanyName());
const billingPresetId = ref("local");
const billingModelLabel = ref("未配置");
const accountLabel = ref("");
const userNickname = ref("");
const userPublicId = ref("");
const authSourceLabel = ref("本机");
const meBusy = ref(false);
const meError = ref("");

const tabs = computed(() => [
  { id: "profile" as const, label: "个人资料", icon: "user-3-line" },
  { id: "billing" as const, label: "用量", icon: "money-cny-box-line" },
]);

const companyHint = computed(() => `产品品牌固定为「${BRAND_NAME}」`);
/** 测试模式到期：仅个人中心展示，侧栏不再显示剩余天数。 */
const testModeExpiryLine = computed(() => productTestModeExpiryLine());

/** 账号展示：手机号不明文；优先 publicId / 邮箱脱敏。 */
function maskAccountLabel(raw: string): string {
  const t = raw.trim();
  if (!t || t === "未登录") return t || "未登录";
  if (/^1\d{10}$/.test(t)) return "已绑定手机";
  if (/^\d{11}$/.test(t)) return "已绑定手机";
  const at = t.indexOf("@");
  if (at > 1) {
    return `${t.slice(0, 2)}***${t.slice(at)}`;
  }
  if (t.length > 8) return `${t.slice(0, 3)}…${t.slice(-2)}`;
  return t;
}

async function loadBillingMeta() {
  try {
    const profiles = await loadGlobalModelProfiles(true);
    if (profiles.defaultSource === "remote" && !profiles.localOnly) {
      const preset = getDefaultRemotePreset(profiles);
      billingPresetId.value = preset?.id ?? "local";
      billingModelLabel.value = preset?.label?.trim() || "远程模型";
      return;
    }
    billingPresetId.value = "local";
    billingModelLabel.value =
      profiles.local.displayName?.trim() || profiles.local.textModel?.trim() || "本地模型";
  } catch {
    billingPresetId.value = "local";
    billingModelLabel.value = "未配置";
  }
}

function refreshCompany() {
  companyName.value = readCompanyName();
}

function refreshAccount() {
  const s = cachedSession();
  const u = s?.user;
  userNickname.value = u?.nickname?.trim() || "";
  userPublicId.value = u?.publicId?.trim() || u?.cloudUserId?.trim() || "";
  accountLabel.value = maskAccountLabel(u?.username?.trim() || "未登录");
  authSourceLabel.value = s?.authSource === "cloud" ? "云端账号" : "本机账号";
  meError.value = "";
}

async function refreshCloudMe() {
  meBusy.value = true;
  meError.value = "";
  try {
    const me = await fetchCloudMe();
    if (me?.nickname) userNickname.value = me.nickname;
    if (me?.publicId) userPublicId.value = me.publicId;
    refreshAccount();
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? Number((e as { code: number }).code) : 0;
    if (code === 40310) {
      visible.value = false;
      meError.value = "";
      return;
    }
    meError.value = toUserError(e).replace(/^Error:\s*/i, "");
  } finally {
    meBusy.value = false;
  }
}

function commitCompanyName() {
  companyName.value = writeCompanyName(companyName.value);
}

function openSettings() {
  visible.value = false;
  void router.push("/settings");
}

async function doLogout() {
  visible.value = false;
  try {
    await logout();
  } catch {
    /* ignore */
  }
  await router.replace("/login");
  await applyLoginWindowSize();
}

watch(visible, (open) => {
  if (!open) return;
  tab.value = "profile";
  refreshCompany();
  refreshAccount();
  void loadBillingMeta();
  void refreshCloudMe();
});
</script>

<template>
  <FouDialog v-model="visible" title="个人中心" width="520px" append-to-body destroy-on-close>
    <div class="personal-center ui-font">
      <div class="personal-tabs">
        <FouButton
          v-for="item in tabs"
          :key="item.id"
          :type="tab === item.id ? 'primary' : 'default'"
          :icon="item.icon"
          size="small"
          native-type="button"
          @click="tab = item.id"
        >
          {{ item.label }}
        </FouButton>
      </div>

      <section v-if="tab === 'profile'" class="personal-panel">
        <div class="profile-row">
          <span class="profile-label">品牌</span>
          <strong>{{ BRAND_NAME }}</strong>
        </div>
        <div v-if="testModeExpiryLine" class="profile-row profile-row-expiry">
          <span class="profile-label">授权</span>
          <strong class="profile-expiry">{{ testModeExpiryLine }}</strong>
        </div>
        <div class="profile-row">
          <span class="profile-label">昵称</span>
          <strong>{{ userNickname || (meBusy ? "加载中…" : "—") }}</strong>
        </div>
        <div v-if="userPublicId" class="profile-row">
          <span class="profile-label">用户 ID</span>
          <strong>{{ userPublicId }}</strong>
        </div>
        <div class="profile-row">
          <span class="profile-label">账号</span>
          <strong>{{ accountLabel }}</strong>
          <span class="profile-tag">{{ authSourceLabel }}</span>
        </div>
        <div class="profile-row">
          <span class="profile-label">公司名称</span>
          <FouInput
            v-model="companyName"
            :maxlength="COMPANY_NAME_MAX"
            :placeholder="DEFAULT_COMPANY_NAME"
            @blur="commitCompanyName"
            @keydown.enter="commitCompanyName"
          />
        </div>
        <p class="profile-hint">{{ companyHint }}；公司名称用于办公室欢迎语等场景。密码与手机号不在此展示。</p>
        <p v-if="meError" class="me-err">{{ meError }}</p>

        <div class="profile-actions">
          <FouButton
            icon="refresh-line"
            size="small"
            native-type="button"
            :loading="meBusy"
            :disabled="meBusy"
            @click="refreshCloudMe"
          >
            刷新资料
          </FouButton>
          <FouButton icon="settings-3-line" size="small" native-type="button" @click="openSettings">
            打开完整设置
          </FouButton>
          <FouButton
            icon="logout-box-r-line"
            size="small"
            type="danger"
            native-type="button"
            @click="doLogout"
          >
            退出登录
          </FouButton>
        </div>
      </section>

      <section v-else class="personal-panel">
        <p class="profile-hint">当前默认模型的 Token 用量与参考费用（与对话页账单一致）。</p>
        <BillingPanel
          :preset-id="billingPresetId"
          :model-label="billingModelLabel"
          always-expanded
        />
      </section>
    </div>
  </FouDialog>
</template>

<style scoped>
.personal-center {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 200px;
}
.personal-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.personal-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.profile-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.profile-label {
  width: 72px;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 13px;
}
.profile-row-expiry {
  align-items: flex-start;
}
.profile-expiry {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--ink);
}
.profile-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--muted);
  border: 1px solid var(--hairline);
}
.profile-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.me-err {
  margin: 0;
  font-size: 12px;
  color: #b91c1c;
}
.profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.personal-panel :deep(.billing-panel) {
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
}
</style>
