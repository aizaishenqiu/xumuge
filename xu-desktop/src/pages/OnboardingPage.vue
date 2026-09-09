<script setup lang="ts">
/**
 * @author qiuye <yjk150@qq.com>
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { FouButton } from "foucui";
import { loadOpsBrains } from "../utils/opsBrains";
import { BRAND_NAME, BRAND_NAME_ZH, BRAND_LOGO_URL, COMPANY_LEGAL_NAME } from "../utils/brandSettings";

const props = defineProps<{
  checking?: boolean;
  apiKeyConfigured?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  continue: [];
  retry: [];
}>();

const router = useRouter();
const brainHint = ref("");

const readyHint = computed(() => {
  if (props.apiKeyConfigured) return "已检测到至少一个 Provider API Key 环境变量。";
  return "尚未检测到 API Key 环境变量；可先进入应用，再到设置配置三脑。";
});

onMounted(async () => {
  try {
    const b = await loadOpsBrains();
    const slots = [b.command, b.work, b.code]
      .filter((s) => s.model.trim() || s.baseUrl.trim())
      .map((s) => s.model || s.baseUrl);
    brainHint.value = slots.length
      ? `已配置脑槽：${slots.slice(0, 3).join(" · ")}`
      : "三脑尚未填写 model/baseUrl，建议进入设置配置。";
  } catch {
    brainHint.value = "无法读取三脑配置（可稍后在设置中填写）。";
  }
});

function markDone() {
  window.localStorage.setItem("xu.onboarding.complete", "true");
  try {
    window.localStorage.removeItem("hermes.onboarding.complete");
  } catch {
    /* ignore */
  }
  emit("continue");
}

function finish() {
  markDone();
  void router.replace("/home");
}

function goSettings() {
  markDone();
  void router.replace("/settings");
}

function goConnections() {
  markDone();
  void router.replace("/connections");
}
</script>

<template>
  <div class="xu-onboard">
    <header class="hero">
      <img class="logo" :src="BRAND_LOGO_URL" :alt="BRAND_NAME_ZH" />
      <p class="kicker ui-font">{{ BRAND_NAME }} · {{ COMPANY_LEGAL_NAME }}</p>
      <h1 class="ui-font">独立 AI 员工桌面</h1>
      <p class="sub ui-font">
        对话与派活走虚募阁内置智能体；记忆与通知在{{ BRAND_NAME_ZH }}内闭环。无需安装外部 CLI。
      </p>
    </header>

    <ol class="steps ui-font">
      <li>
        <strong>配置模型</strong>
        <p>在系统环境变量中设置 API Key（如 OPENAI_API_KEY / DEEPSEEK_API_KEY），并在设置页填写 Ops 三脑的 baseUrl 与 model。</p>
        <p class="hint">{{ readyHint }}</p>
        <p v-if="brainHint" class="hint">{{ brainHint }}</p>
      </li>
      <li>
        <strong>（可选）Boss 通知</strong>
        <p>多端连接中配置飞书 / 企微 Webhook，试发成功即可。</p>
      </li>
      <li>
        <strong>添加员工并派活</strong>
        <p>团队页添加工位员工、设置工作区后，在办公室派活；由 Native Agent 执行。</p>
      </li>
    </ol>

    <p v-if="error" class="err ui-font">{{ error }}</p>
    <p v-if="checking" class="hint ui-font">正在检测环境…</p>

    <div class="actions">
      <FouButton icon="settings-3-line" native-type="button" @click="goSettings">去配置三脑</FouButton>
      <FouButton icon="links-line" native-type="button" @click="goConnections">多端连接</FouButton>
      <FouButton type="primary" icon="rocket-line" native-type="button" @click="finish">
        进入办公室
      </FouButton>
      <FouButton icon="refresh-line" native-type="button" :disabled="checking" @click="emit('retry')">
        重新检测
      </FouButton>
    </div>
  </div>
</template>

<style scoped>
.fou-onboard {
  max-width: 640px;
  margin: 0 auto;
  padding: 48px 24px 64px;
}
.hero {
  text-align: center;
  margin-bottom: 28px;
}
.logo {
  display: block;
  height: 40px;
  width: auto;
  max-width: 220px;
  margin: 0 auto 12px;
  object-fit: contain;
}
.kicker {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.hero h1 {
  margin: 8px 0;
  font-size: 28px;
}
.sub {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
  font-size: 14px;
}
.steps {
  margin: 0 0 20px;
  padding: 0 0 0 1.2em;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.steps li p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}
.hint {
  color: var(--muted);
  font-size: 12px;
}
.err {
  color: #b91c1c;
  font-size: 13px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
</style>
