<script setup lang="ts">
/**
 * @file 多端连接（飞书等）配置与探测
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-28
 * @updated 2026-09-01
 * @version 1.1.0
 * @category Layout
 * @algo none
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { FouButton, fouAlert, fouMsg } from "foucui";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  analyzeFeishuDoc,
  ensureFeishuWs,
  getChannelEndpoint,
  getFeishuWsStatus,
  listFeishuRecentSenders,
  loadChannelStatus,
  notifyBoss,
  probeChannel,
  restartFeishuWs,
  sendChannelChat,
  setChannelEndpoint,
  setFeishuBossOpenId,
  setFeishuMeetingSync,
  setPreferredNotifyChannel,
  statusLabel,
  type ChannelEndpointView,
  type ChannelHubStatus,
  type ChannelPlatformStatus,
  type FeishuRecentSender,
  type FeishuWsStatus,
  approveWecomKfSend,
  getWecomKfDefaultEmployee,
  getWecomKfStatus,
  listWecomKfDrafts,
  saveWecomKfDraft,
  setWecomKfDefaultEmployee,
  setWecomKfEnabled,
  type WecomKfDraft,
  type WecomKfStatus,
} from "../utils/channelConnections";
import { requireCapability } from "../utils/auth";
import { toUserError, sanitizeUserDisplayText } from "../utils/userFacingError";
import { loadEmployees, type Employee } from "../utils/employees";

const hub = ref<ChannelHubStatus | null>(null);
const loading = ref(false);
const busyId = ref<string | null>(null);
const showDoc = ref(false);
const docUrl = ref("");
const docBusy = ref(false);
const docResult = ref("");

const cfgOpen = ref(false);
const cfgId = ref("feishu");
const cfg = ref<ChannelEndpointView | null>(null);
const cfgApi = ref("");
const cfgKey = ref("");
const cfgReceiveId = ref("");
/** feishu: webhook | app */
const cfgMode = ref<"webhook" | "app">("app");
const cfgEnabled = ref(true);
const cfgMeetingSync = ref(false);
const cfgKfSync = ref(false);
const cfgKfCorpId = ref("");
const cfgKfOpenKfid = ref("");
const cfgSaving = ref(false);
const cfgError = ref("");
const cfgProbe = ref("");
const wsStatus = ref<FeishuWsStatus | null>(null);
const meetingBusy = ref(false);
const restartBusy = ref(false);
const recentSenders = ref<FeishuRecentSender[]>([]);
const bossBusyId = ref<string | null>(null);
const wecomKfStatus = ref<WecomKfStatus | null>(null);
const wecomDrafts = ref<WecomKfDraft[]>([]);
const kfBusy = ref(false);
const draftBusyId = ref<string | null>(null);
const kfDefaultEmployeeId = ref("");
const kfEmployees = ref<Employee[]>([]);
let unlistenWs: UnlistenFn | null = null;
let unlistenWecomKf: UnlistenFn | null = null;

const chatOpen = ref(false);
const chatId = ref("feishu");
const chatText = ref("你好，这是虚募阁对话试发。");
const chatBusy = ref(false);

const preferred = computed(() => hub.value?.preferredChannel ?? "feishu");

const cfgTitle = computed(() => {
  const p = hub.value?.platforms.find((x) => x.id === cfgId.value);
  return `配置 · ${p?.label ?? cfgId.value}`;
});

const wsStateLabel = computed(() => {
  const s = wsStatus.value?.state || "";
  if (s === "connected" || s === "running") return "长连接已连接";
  if (s === "starting") return "长连接启动中…";
  if (s === "need_console_config")
    return "请到飞书开放平台改成「长连接」订阅（保存时虚募阁要开着）";
  if (s === "error") return `长连接错误：${wsStatus.value?.lastError || "未知"}`;
  if (s === "stopped" || !s) return "长连接未启动";
  return `长连接：${s}`;
});

const inboundHint = computed(() => {
  const st = wsStatus.value;
  if (!st?.meetingSync) return "";
  const connected = st.state === "connected" || st.state === "running";
  if (!connected) return "";
  const last = st.lastInboundMs || 0;
  if (last > 0) {
    try {
      return `最近入站：${new Date(last).toLocaleString("zh-CN")}`;
    } catch {
      return "已收到过入站消息";
    }
  }
  return "心跳正常但尚未收到群消息：请在群里 @机器人 发一句；终端应出现 type\":\"message\"";
});

const wecomKfStateLabel = computed(() => {
  const s = wecomKfStatus.value?.state || "";
  if (s === "ready") return "客服同步已就绪";
  if (s === "starting") return "客服同步启动中…";
  if (s === "error") return `客服同步错误：${wecomKfStatus.value?.lastError || "未知"}`;
  if (s === "off" || !s) return "客服同步未启动";
  return `客服同步：${s}`;
});

async function refreshKfEmployees() {
  try {
    kfEmployees.value = await loadEmployees();
    kfDefaultEmployeeId.value = (await getWecomKfDefaultEmployee()) || "";
  } catch {
    kfEmployees.value = [];
  }
}

async function saveKfDefaultEmployee() {
  try {
    await setWecomKfDefaultEmployee(kfDefaultEmployeeId.value);
    fouMsg.success("默认客服员工已保存");
  } catch (e) {
    void fouAlert(toUserError(e), "默认客服员工");
  }
}

async function refreshWecomKf() {
  try {
    wecomKfStatus.value = await getWecomKfStatus();
  } catch {
    wecomKfStatus.value = null;
  }
  try {
    wecomDrafts.value = await listWecomKfDrafts();
  } catch {
    wecomDrafts.value = [];
  }
}

async function toggleKfSync() {
  if (cfgId.value !== "wecom") return;
  kfBusy.value = true;
  try {
    const next = !cfgKfSync.value;
    if (cfgKfCorpId.value.trim() && cfgKey.value.trim() && cfgKfOpenKfid.value.trim()) {
      wecomKfStatus.value = await setWecomKfEnabled(next);
      cfgKfSync.value = wecomKfStatus.value.kfSync;
      fouMsg.success(next ? "已开启企微客服同步" : "已关闭企微客服同步");
    } else {
      cfgKfSync.value = next;
      fouMsg.info("将在「保存并连接」后生效");
    }
    await refreshWecomKf();
  } catch (e) {
    void fouAlert(toUserError(e), "企微客服同步");
  } finally {
    kfBusy.value = false;
  }
}

async function saveWecomDraft(d: WecomKfDraft) {
  draftBusyId.value = d.msgId;
  try {
    await saveWecomKfDraft(d.msgId, d.draftReply);
    await refreshWecomKf();
    fouMsg.success("草稿已保存");
  } catch (e) {
    void fouAlert(toUserError(e), "客服草稿");
  } finally {
    draftBusyId.value = null;
  }
}

async function approveWecomDraft(d: WecomKfDraft) {
  if (!d.draftReply.trim()) {
    void fouAlert("请先填写回复内容", "确认发送");
    return;
  }
  draftBusyId.value = d.msgId;
  try {
    await saveWecomKfDraft(d.msgId, d.draftReply);
    await approveWecomKfSend(d.msgId);
    await refreshWecomKf();
    fouMsg.success("已发送客服回复");
  } catch (e) {
    void fouAlert(toUserError(e), "确认发送");
  } finally {
    draftBusyId.value = null;
  }
}

async function forceRestartWs() {
  if (restartBusy.value) return;
  restartBusy.value = true;
  try {
    wsStatus.value = await restartFeishuWs();
    fouMsg.success("已强制重启飞书长连接（已清理残留 node）");
  } catch (e) {
    void fouAlert(toUserError(e), "飞书长连接");
  } finally {
    restartBusy.value = false;
  }
}

async function refreshWs() {
  try {
    wsStatus.value = await getFeishuWsStatus();
  } catch {
    wsStatus.value = null;
  }
  try {
    recentSenders.value = await listFeishuRecentSenders();
  } catch {
    recentSenders.value = [];
  }
}

async function toggleBoss(s: FeishuRecentSender) {
  bossBusyId.value = s.openId;
  try {
    recentSenders.value = await setFeishuBossOpenId(s.openId, !s.isBoss);
    fouMsg.success(
      s.isBoss
        ? `已取消 Boss 绑定：${s.name || s.openId}`
        : `已绑定 Boss：${s.name || s.openId}（该飞书账号发言会显示为 Boss）`,
    );
  } catch (e) {
    void fouAlert(toUserError(e), "Boss 绑定");
  } finally {
    bossBusyId.value = null;
  }
}

async function refresh() {
  loading.value = true;
  try {
    hub.value = await loadChannelStatus();
    await refreshWs();
    await refreshWecomKf();
  } catch (e) {
    void fouAlert(toUserError(e), "通道状态");
  } finally {
    loading.value = false;
  }
}

async function prefer(id: string) {
  busyId.value = `pref-${id}`;
  try {
    await setPreferredNotifyChannel(id);
    await refresh();
    fouMsg.success(`默认通知通道：${id}`);
  } catch (e) {
    void fouAlert(toUserError(e), "默认通道");
  } finally {
    busyId.value = null;
  }
}

function isFeishuHookToken(token: string): boolean {
  // Feishu hook tokens are typically UUID-like
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token.trim())
    || (/^[0-9a-f-]{20,}$/i.test(token.trim()) && token.includes("-"));
}

function isFeishuHookComplete(api: string): boolean {
  const m = api.trim().match(/\/hook\/([^/?#]+)/i);
  return Boolean(m && m[1] && isFeishuHookToken(m[1]));
}

function mergeFeishuApiKey(api: string, key: string): { api: string; key: string } {
  let a = api.trim().replace(/\s+/g, "");
  // 飞书自定义机器人：Key 栏常被填成 App Secret，绝不能拼进 URL
  let k = "";
  // 仅当 API 停在 /hook/ 且 Key 真是 hook token 时才拼接
  const rawKey = key.trim().replace(/\s+/g, "");
  if (/\/hook\/?$/i.test(a) && isFeishuHookToken(rawKey)) {
    a = a.replace(/\/?$/, "/") + rawKey;
  }
  return { api: a, key: k };
}

function feishuTokenHint(api: string): string {
  const m = api.trim().match(/\/hook\/([^/?#]+)/i);
  if (!m?.[1]) return "";
  const t = m[1];
  if (t.length < 8) return `token 过短（${t.length} 位）`;
  return `已识别 token …${t.slice(-4)}（共 ${t.length} 位）`;
}

async function openConfig(p: ChannelPlatformStatus) {
  if (p.id === "os") return;
  cfgId.value = p.id;
  cfgError.value = "";
  cfgProbe.value = "";
  cfgOpen.value = true;
  try {
    cfg.value = await getChannelEndpoint(p.id);
    cfgApi.value = cfg.value.api || cfg.value.webhookUrl || "";
    cfgKey.value = cfg.value.key || "";
    cfgReceiveId.value = cfg.value.receiveId || "";
    cfgEnabled.value = true;

    if (p.id === "feishu") {
      const mode = (cfg.value.mode === "webhook" ? "webhook" : "app") as "webhook" | "app";
      // 默认开放平台；仅当已存有效 webhook 时进 webhook 模式
      if (cfg.value.mode === "webhook" || isFeishuHookComplete(cfgApi.value)) {
        cfgMode.value = "webhook";
        if (cfgApi.value && !isFeishuHookComplete(cfgApi.value)) {
          cfgApi.value = "";
          cfgError.value = "Webhook 无效，已清空。也可切换到「开放平台」填 App ID + Secret。";
        }
      } else {
        cfgMode.value = mode === "app" || cfgApi.value.startsWith("cli_") ? "app" : "app";
        if (cfgApi.value && !cfgApi.value.startsWith("cli_") && !isFeishuHookComplete(cfgApi.value)) {
          cfgApi.value = "";
        }
      }
      cfgMeetingSync.value = cfg.value.meetingSync !== false && cfgMode.value === "app";
      void refreshWs();
    } else if (p.id === "wecom") {
      cfgMode.value = "webhook";
      cfgMeetingSync.value = false;
      cfgKfSync.value = cfg.value.kfSync ?? false;
      cfgKfCorpId.value = cfg.value.kfCorpId || "";
      cfgKfOpenKfid.value = cfg.value.kfOpenKfid || "";
      void refreshWecomKf();
      void refreshKfEmployees();
    } else {
      cfgMode.value = "webhook";
      cfgMeetingSync.value = false;
    }
  } catch (e) {
    cfgError.value = toUserError(e);
  }
}

function toggleEnabled() {
  cfgEnabled.value = !cfgEnabled.value;
}

function setFeishuMode(mode: "webhook" | "app") {
  cfgMode.value = mode;
  cfgError.value = "";
  cfgProbe.value = "";
  cfgApi.value = "";
  cfgKey.value = "";
  if (mode === "webhook") {
    cfgReceiveId.value = "";
    cfgMeetingSync.value = false;
  }
}

async function toggleMeetingSync() {
  if (cfgMode.value !== "app") return;
  meetingBusy.value = true;
  try {
    const next = !cfgMeetingSync.value;
    // Prefer live toggle when already saved; otherwise just flip local until save
    if (cfgApi.value.startsWith("cli_") && cfgKey.value) {
      wsStatus.value = await setFeishuMeetingSync(next);
      cfgMeetingSync.value = wsStatus.value.meetingSync;
      fouMsg.success(next ? "已开启开会同步（长连接）" : "已关闭开会同步");
    } else {
      cfgMeetingSync.value = next;
      fouMsg.info("将在「保存并连接」后生效");
    }
  } catch (e) {
    void fouAlert(toUserError(e), "开会同步");
  } finally {
    meetingBusy.value = false;
  }
}

async function saveConfig() {
  cfgSaving.value = true;
  cfgError.value = "";
  cfgProbe.value = "";
  try {
    try {
      await requireCapability("channel_save");
    } catch (e) {
      cfgError.value = toUserError(e);
      cfgSaving.value = false;
      return;
    }

    let api = cfgApi.value.trim().replace(/^["'`“”]+|["'`“”]+$/g, "");
    let key = cfgKey.value.trim().replace(/^["'`“”]+|["'`“”]+$/g, "");
    const receiveId = cfgReceiveId.value.trim().replace(/\s+/g, "");

    if (cfgId.value === "feishu" && cfgMode.value === "app") {
      if (!api.startsWith("cli_")) {
        cfgError.value = "请填写 App ID（以 cli_ 开头，在开放平台 · 凭证与基础信息）";
        cfgSaving.value = false;
        return;
      }
      if (!key) {
        cfgError.value = "请填写 App Secret";
        cfgSaving.value = false;
        return;
      }
      // 接收方可选：留空则自动发到机器人所在的第一个群
      cfgEnabled.value = true;
      await setChannelEndpoint({
        id: "feishu",
        enabled: true,
        mode: "app",
        api,
        key,
        receiveId,
        meetingSync: cfgMeetingSync.value,
      });
      if (cfgMeetingSync.value) {
        try {
          wsStatus.value = await ensureFeishuWs();
        } catch (e) {
          cfgProbe.value = `凭证已保存；长连接：${toUserError(e)}`;
        }
      } else {
        try {
          wsStatus.value = await setFeishuMeetingSync(false);
        } catch {
          /* ignore */
        }
      }
    } else {
      if (cfgId.value === "feishu") {
        ({ api, key } = mergeFeishuApiKey(api, key));
        key = "";
        cfgKey.value = "";
        cfgApi.value = api;
      }

      const keyLooksHook =
        /hook/i.test(key) && /(feishu|lark|webhook)/i.test(key);
      const apiLooksUrl = /^https?:\/\//i.test(api);
      if (keyLooksHook && !apiLooksUrl) {
        api = key;
        key = "";
        cfgApi.value = api;
        cfgKey.value = "";
      }

      if (
        (cfgId.value === "feishu" || cfgId.value === "wecom" || cfgId.value === "dingtalk") &&
        api &&
        !/^https?:\/\//i.test(api) &&
        api.includes(".")
      ) {
        api = `https://${api.replace(/^\/\//, "")}`;
        cfgApi.value = api;
      }

      if (cfgId.value === "feishu" || cfgId.value === "wecom" || cfgId.value === "dingtalk") {
        if (!api) {
          cfgError.value = "请填写完整 Webhook URL";
          cfgSaving.value = false;
          return;
        }
        if (!/^https?:\/\//i.test(api)) {
          cfgError.value = "Webhook 须以 https:// 开头";
          cfgSaving.value = false;
          return;
        }
        if (cfgId.value === "feishu" && !isFeishuHookComplete(api)) {
          cfgError.value =
            "Webhook token 不完整。或改用上方「开放平台」模式填 App ID + Secret。";
          cfgSaving.value = false;
          return;
        }
      }

      cfgEnabled.value = true;
      await setChannelEndpoint({
        id: cfgId.value,
        enabled: true,
        mode: cfgId.value === "feishu" ? "webhook" : undefined,
        api,
        key,
        kfCorpId: cfgId.value === "wecom" ? cfgKfCorpId.value.trim() : undefined,
        kfOpenKfid: cfgId.value === "wecom" ? cfgKfOpenKfid.value.trim() : undefined,
        kfSync: cfgId.value === "wecom" ? cfgKfSync.value : undefined,
      });
      if (cfgId.value === "wecom" && cfgKfSync.value) {
        try {
          wecomKfStatus.value = await setWecomKfEnabled(true);
        } catch (e) {
          cfgProbe.value = `Webhook 已保存；客服同步：${toUserError(e)}`;
        }
      }
    }

    const probe = await probeChannel(cfgId.value);
    await refresh();
    if (probe.ok) {
      cfgProbe.value = probe.message;
      cfgError.value = "";
      cfgOpen.value = false;
      fouMsg.success(`已连接 ${cfgId.value}：${probe.message}`);
    } else {
      cfgProbe.value = `已保存；连通探测失败：${probe.message}`;
      if (/19001|access token invalid/i.test(probe.message)) {
        cfgProbe.value += " → 建议改用「开放平台」模式（App ID + Secret）。";
      }
      cfgError.value = "";
      void fouAlert(cfgProbe.value, "连通探测");
    }
  } catch (e) {
    const msg = toUserError(e);
    cfgError.value = msg.includes("试用账号")
      ? msg
      : msg.replace(/^Error:\s*/i, "");
    cfgProbe.value = "";
    void fouAlert(cfgError.value || msg, "保存连接");
  } finally {
    cfgSaving.value = false;
  }
}

async function testSend(p: ChannelPlatformStatus) {
  if (p.id !== "os" && !p.webhookConfigured) {
    await openConfig(p);
    void fouAlert("请先填写 API 与 Key 并保存连接", "通知试发");
    return;
  }
  busyId.value = `test-${p.id}`;
  try {
    const r = await notifyBoss({
      kind: "test",
      title: "多端连接 · 通知试发",
      body: `来自虚募阁桌面的测试通知（通道 ${p.label}）`,
      channel: p.id,
      force: true,
    });
    if (r.ok) fouMsg.success(r.message);
    else void fouAlert(r.message, "通知试发");
  } catch (e) {
    void fouAlert(toUserError(e), "通知试发");
  } finally {
    busyId.value = null;
  }
}

function openChat(p: ChannelPlatformStatus) {
  if (p.id === "os" || !p.supportsChat) return;
  if (!p.webhookConfigured) {
    void openConfig(p);
    void fouAlert("请先配置 API / Key", "对话试发");
    return;
  }
  chatId.value = p.id;
  chatText.value = "你好，这是虚募阁对话试发。";
  chatOpen.value = true;
}

async function runChatSend() {
  chatBusy.value = true;
  try {
    const r = await sendChannelChat(chatId.value, chatText.value.trim());
    if (r.ok) {
      fouMsg.success(r.message);
      chatOpen.value = false;
    } else {
      void fouAlert(r.message, "对话试发");
    }
  } catch (e) {
    void fouAlert(toUserError(e), "对话试发");
  } finally {
    chatBusy.value = false;
  }
}

async function runDocAnalyze() {
  docBusy.value = true;
  docResult.value = "";
  try {
    const r = await analyzeFeishuDoc(docUrl.value.trim());
    docResult.value = `${r.message}\n\n${sanitizeUserDisplayText(r.summary, "")}`;
  } catch (e) {
    docResult.value = toUserError(e);
  } finally {
    docBusy.value = false;
  }
}

onMounted(() => {
  void refresh();
  void listen<FeishuWsStatus>("xu-feishu-ws", (ev) => {
    wsStatus.value = ev.payload;
  }).then((u) => {
    unlistenWs = u;
  });
  void listen<{ msgId: string }>("xu-wecom-kf-inbound", () => {
    void refreshWecomKf();
  }).then((u) => {
    unlistenWecomKf = u;
  });
});

onUnmounted(() => {
  unlistenWs?.();
  unlistenWs = null;
  unlistenWecomKf?.();
  unlistenWecomKf = null;
});
</script>

<template>
  <div class="vue-page connections-page">
    <header class="vue-page-header">
      <div>
        <h1 class="ui-font">多端连接</h1>
        <p class="ui-font muted">
          只需填写 API 与 Key，保存后自动探测连通。通知与对话均按各平台公开文档对接。
        </p>
      </div>
      <div class="vue-page-actions">
        <PageHelpButton topic="connections.overview" label="帮助" />
        <FouButton icon="refresh-line" native-type="button" :disabled="loading" @click="refresh">
          {{ loading ? "刷新中…" : "刷新状态" }}
        </FouButton>
      </div>
    </header>

    <div v-if="hub" class="hub-strip ui-font">
      <span class="ok">虚募阁消息直送已启用</span>
      <span class="muted">默认通道：{{ preferred }}</span>
    </div>

    <div class="card-grid">
      <article
        v-for="p in hub?.platforms ?? []"
        :key="p.id"
        class="channel-card"
        :class="{ preferred: preferred === p.id }"
      >
        <div class="card-head">
          <strong class="ui-font">{{ p.label }}</strong>
          <span class="badge ui-font">{{ hub ? statusLabel(p, hub) : "…" }}</span>
        </div>
        <p class="note ui-font">{{ p.note }}</p>
        <p
          v-if="p.id === 'feishu' && wsStatus?.meetingSync"
          class="note ui-font"
        >
          {{ wsStateLabel }}
          <template v-if="inboundHint"> · {{ inboundHint }}</template>
        </p>
        <div v-if="p.id === 'feishu' && wsStatus?.meetingSync" class="card-actions" style="margin-top: 4px">
          <FouButton
            icon="refresh-line"
            size="small"
            native-type="button"
            :disabled="restartBusy"
            @click="forceRestartWs"
          >
            {{ restartBusy ? "重启中…" : "重启长连接" }}
          </FouButton>
        </div>
        <div class="card-actions">
          <FouButton
            icon="star-line"
            size="small"
            native-type="button"
            :disabled="busyId === `pref-${p.id}` || preferred === p.id"
            @click="prefer(p.id)"
          >
            {{ preferred === p.id ? "默认" : "设为默认" }}
          </FouButton>
          <FouButton
            v-if="p.id !== 'os'"
            icon="settings-3-line"
            size="small"
            native-type="button"
            @click="openConfig(p)"
          >
            配置
          </FouButton>
          <FouButton
            type="primary"
            icon="notification-3-line"
            size="small"
            native-type="button"
            :disabled="busyId === `test-${p.id}`"
            @click="testSend(p)"
          >
            {{ busyId === `test-${p.id}` ? "发送中…" : "试发通知" }}
          </FouButton>
          <FouButton
            v-if="p.supportsChat"
            icon="chat-3-line"
            size="small"
            native-type="button"
            @click="openChat(p)"
          >
            试发对话
          </FouButton>
        </div>
      </article>
    </div>

    <section class="doc-section">
      <h2 class="ui-font">飞书文档</h2>
      <p class="ui-font muted">
        保存文档链接占位到本地；正文请导入 虚募阁记忆。开放平台读析可后续用同一套 API/Key 扩展。
      </p>
      <FouButton icon="file-text-line" native-type="button" @click="showDoc = true">保存链接占位</FouButton>
    </section>

    <FouDialog
      v-model="cfgOpen"
      :title="cfgTitle"
      width="560px"
      append-to-body
      :show-fullscreen="false"
      :show-minimize="false"
      :draggable="false"
      :resizable="false"
      :z-index="20000"
    >
      <p class="hint ui-font">{{ cfg?.docsHint || "按官方文档填写，保存后自动连通检测。" }}</p>

      <div v-if="cfgId === 'feishu'" class="mode-row">
        <FouButton
          :type="cfgMode === 'app' ? 'primary' : 'default'"
          icon="key-2-line"
          size="small"
          native-type="button"
          @click="setFeishuMode('app')"
        >
          开放平台（App ID）
        </FouButton>
        <FouButton
          :type="cfgMode === 'webhook' ? 'primary' : 'default'"
          icon="links-line"
          size="small"
          native-type="button"
          @click="setFeishuMode('webhook')"
        >
          群机器人 Webhook
        </FouButton>
      </div>

      <template v-if="cfgId === 'feishu' && cfgMode === 'app'">
        <p class="hint ui-font">
          填 <strong>App ID + App Secret</strong>，保存后自动探测连通。
          保存时会调用飞书
          <code>bot/v3/info</code>
          校验机器人（须在开放平台启用「机器人」并发布）。接收方可留空。
        </p>
        <label class="field ui-font">
          <span>App ID</span>
          <FouInput v-model="cfgApi" autocomplete="off" placeholder="cli_xxxxxxxx" />
        </label>
        <label class="field ui-font">
          <span>App Secret</span>
          <FouInput
            v-model="cfgKey"
            type="password"
            autocomplete="new-password"
            placeholder="开放平台 · 凭证与基础信息"
          />
        </label>
        <label class="field ui-font">
          <span>接收方 ID（可选）</span>
          <FouInput
            v-model="cfgReceiveId"
            autocomplete="off"
            placeholder="可留空；或手动填 oc_… / ou_…"
          />
        </label>
        <div class="field enable-row ui-font">
          <FouButton
            :type="cfgMeetingSync ? 'primary' : 'default'"
            :icon="cfgMeetingSync ? 'group-line' : 'chat-off-line'"
            native-type="button"
            :disabled="meetingBusy"
            @click="toggleMeetingSync"
          >
            {{ cfgMeetingSync ? "开会同步已开（点击关闭）" : "开会同步未开（点击开启）" }}
          </FouButton>
        </div>
        <p class="hint ui-font">
          开会同步：
          <br />1) 长连接 + 事件「接收消息」
          <br />2) 想<strong>群里不 @ 也能进办公室</strong>：权限开通「获取群组中所有消息」并发布版本；
          若只有「@ 机器人消息」权限，则仍须先 @ 机器人
          <br />3) <strong>派活</strong>：正文手打
          <code>@员工花名</code>
          （虚募阁花名册姓名，不用飞书通讯录点选）。例：
          <code>@小王 明天把周报写完</code>
        </p>
        <p v-if="cfgMeetingSync" class="probe ui-font">
          {{ wsStateLabel }}
          <template v-if="wsStatus?.boundChatId">
            · 最近群 {{ wsStatus.boundChatId.slice(0, 12) }}…
          </template>
          <template v-if="inboundHint">
            <br />{{ inboundHint }}
          </template>
        </p>
        <div v-if="cfgMeetingSync" class="field enable-row ui-font" style="margin-top: 8px">
          <FouButton
            icon="refresh-line"
            native-type="button"
            :disabled="restartBusy"
            @click="forceRestartWs"
          >
            {{ restartBusy ? "重启中…" : "强制重启长连接" }}
          </FouButton>
        </div>
        <div v-if="cfgMeetingSync" class="boss-bind ui-font">
          <p class="hint">
            Boss 匹配：把群里真人飞书账号绑成 Boss（机器人发出的消息仍是机器人身份）。
            先在群里发一条，下面会出现发言人，再点「设为 Boss」。
          </p>
          <div v-if="!recentSenders.length" class="hint">暂无发言记录，请先在飞书群发一句。</div>
          <div v-for="s in recentSenders" :key="s.openId" class="boss-row">
            <span class="boss-name">
              {{ s.isBoss ? "Boss·" : "" }}{{ s.name || `成员…${s.openId.slice(-6)}` }}
            </span>
            <FouButton
              size="small"
              :type="s.isBoss ? 'primary' : 'default'"
              :icon="s.isBoss ? 'user-star-line' : 'user-line'"
              native-type="button"
              :disabled="bossBusyId === s.openId"
              @click="toggleBoss(s)"
            >
              {{ s.isBoss ? "取消 Boss" : "设为 Boss" }}
            </FouButton>
          </div>
        </div>
      </template>

      <template v-else>
        <p v-if="cfgId === 'feishu'" class="hint ui-font">
          群设置 → 群机器人 → 自定义机器人 → 完整 Webhook（须含 /hook/ + UUID）。
        </p>
        <label class="field ui-font">
          <span>{{ cfgId === "feishu" ? "Webhook 地址" : "API" }}</span>
          <FouInput
            v-model="cfgApi"
            :type="cfgId === 'telegram' ? 'password' : 'text'"
            autocomplete="off"
            :placeholder="cfg?.apiHint || 'https://…'"
          />
        </label>
        <p v-if="cfgId === 'feishu' && cfgApi" class="hint ui-font">
          {{ feishuTokenHint(cfgApi) || "尚未识别到有效 token" }}
        </p>
        <label v-if="cfgId !== 'feishu'" class="field ui-font">
          <span>{{ cfgId === "wecom" ? "客服应用 Secret" : "Key（可选）" }}</span>
          <FouInput
            v-model="cfgKey"
            type="password"
            autocomplete="new-password"
            :placeholder="cfg?.keyHint || '可留空'"
          />
        </label>

        <template v-if="cfgId === 'wecom'">
          <p class="hint ui-font kf-section-title">企微客服同步（实验）</p>
          <p class="hint ui-font">
            除群机器人 Webhook 外，可同步<strong>微信客服</strong>会话：客户消息入站后须您确认才发送；与个人微信 App 无关。
          </p>
          <label class="field ui-font">
            <span>企业 ID</span>
            <FouInput v-model="cfgKfCorpId" autocomplete="off" placeholder="wwxxxxxxxx" />
          </label>
          <label class="field ui-font">
            <span>客服账号 ID（open_kfid）</span>
            <FouInput v-model="cfgKfOpenKfid" autocomplete="off" placeholder="wkxxxxxxxx" />
          </label>
          <label class="field ui-font">
            <span>默认客服员工（自动起草）</span>
            <select v-model="kfDefaultEmployeeId" class="kf-select" @change="saveKfDefaultEmployee">
              <option value="">自动匹配（客服/支持岗）</option>
              <option v-for="e in kfEmployees" :key="e.id" :value="e.id">
                {{ e.name }} · {{ e.role }}
              </option>
            </select>
          </label>
          <div class="field enable-row ui-font">
            <FouButton
              :type="cfgKfSync ? 'primary' : 'default'"
              :icon="cfgKfSync ? 'customer-service-2-line' : 'customer-service-line'"
              native-type="button"
              :disabled="kfBusy"
              @click="toggleKfSync"
            >
              {{ cfgKfSync ? "客服同步已开（点击关闭）" : "客服同步未开（点击开启）" }}
            </FouButton>
          </div>
          <p v-if="cfgKfSync && wecomKfStatus" class="probe ui-font">
            {{ wecomKfStateLabel }}
            <template v-if="wecomKfStatus.pendingDrafts">
              · 待回复 {{ wecomKfStatus.pendingDrafts }} 条
            </template>
          </p>
          <div v-if="wecomDrafts.length" class="kf-drafts ui-font">
            <p class="hint">待确认回复（须人工点发送）</p>
            <div v-for="d in wecomDrafts" :key="d.msgId" class="kf-draft-row">
              <p class="kf-customer">{{ d.customerText }}</p>
              <FouInput
                v-model="d.draftReply"
                placeholder="填写回复草稿…"
                autocomplete="off"
              />
              <div class="kf-draft-actions">
                <FouButton
                  size="small"
                  icon="save-line"
                  native-type="button"
                  :disabled="draftBusyId === d.msgId"
                  @click="saveWecomDraft(d)"
                >
                  保存草稿
                </FouButton>
                <FouButton
                  size="small"
                  type="primary"
                  icon="send-plane-line"
                  native-type="button"
                  :disabled="draftBusyId === d.msgId"
                  @click="approveWecomDraft(d)"
                >
                  确认发送
                </FouButton>
              </div>
            </div>
          </div>
        </template>
      </template>

      <div class="field enable-row ui-font">
        <FouButton
          :type="cfgEnabled ? 'primary' : 'default'"
          :icon="cfgEnabled ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'"
          native-type="button"
          @click="toggleEnabled"
        >
          {{ cfgEnabled ? "通道已启用（点击关闭）" : "通道未启用（点击开启）" }}
        </FouButton>
        <FouButton
          v-if="cfgId === 'feishu'"
          icon="delete-bin-line"
          native-type="button"
          @click="
            cfgApi = '';
            cfgKey = '';
            cfgReceiveId = '';
            cfgProbe = '';
            cfgError = '已清空';
          "
        >
          清空重填
        </FouButton>
      </div>
      <p v-if="cfgProbe" class="probe ui-font">{{ cfgProbe }}</p>
      <p v-if="cfgError && cfgError !== cfgProbe" class="err">{{ cfgError }}</p>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="cfgOpen = false">取消</FouButton>
        <FouButton
          type="primary"
          icon="links-line"
          native-type="button"
          :disabled="cfgSaving"
          @click="saveConfig"
        >
          {{ cfgSaving ? "连接中…" : "保存并连接" }}
        </FouButton>
      </template>
    </FouDialog>

    <FouDialog
      v-model="chatOpen"
      :title="`对话试发 · ${chatId}`"
      width="520px"
      append-to-body
      :show-fullscreen="false"
      :show-minimize="false"
      :draggable="false"
      :resizable="false"
      :z-index="20000"
    >
      <p class="hint ui-font">按该通道公开消息 API 发送一条对话文本（群机器人 / Bot sendMessage）。</p>
      <p v-if="chatId === 'feishu'" class="hint ui-font chat-diag">
        诊断：试发成功只表示「出站」；若要在虚募阁收到群消息，终端日志须出现
        <code>type":"message"</code>
        （或 im.message）。否则请到飞书开放平台核对：事件订阅已开长连接、机器人已入群、具备接收群消息 / @机器人权限。办公室侧栏是本地编排聊天，飞书对话请走本页「多端连接」。
      </p>
      <label class="field ui-font">
        <span>内容</span>
        <FouInput v-model="chatText" placeholder="输入要发送的对话内容" />
      </label>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="chatOpen = false">取消</FouButton>
        <FouButton
          type="primary"
          icon="send-plane-line"
          native-type="button"
          :disabled="chatBusy || !chatText.trim()"
          @click="runChatSend"
        >
          {{ chatBusy ? "发送中…" : "发送" }}
        </FouButton>
      </template>
    </FouDialog>

    <FouDialog
      v-model="showDoc"
      title="飞书文档链接占位"
      width="560px"
      append-to-body
      :close-on-click-modal="true"
      :show-fullscreen="false"
      :show-minimize="false"
      :draggable="false"
      :resizable="false"
      :z-index="20000"
    >
      <div class="doc-form">
        <FouInput v-model="docUrl" placeholder="https://….feishu.cn/docx/…" />
        <pre v-if="docResult" class="doc-out ui-font">{{ docResult }}</pre>
      </div>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="showDoc = false">关闭</FouButton>
        <FouButton
          type="primary"
          icon="save-line"
          native-type="button"
          :disabled="docBusy || !docUrl.trim()"
          @click="runDocAnalyze"
        >
          {{ docBusy ? "保存中…" : "保存占位" }}
        </FouButton>
      </template>
    </FouDialog>
  </div>
</template>

<style scoped>
.connections-page {
  padding: 16px 20px 32px;
  overflow: auto;
}
.vue-page-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 8px;
}
.vue-page-header h1 {
  margin: 0 0 6px;
  font-size: 22px;
}
.vue-page-actions {
  display: flex;
  gap: 8px;
}
.hub-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  margin: 8px 0 12px;
  font-size: 13px;
}
.hub-strip .ok {
  color: var(--success, #0f766e);
}
.hub-strip .muted,
.muted {
  color: var(--muted);
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.channel-card {
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 12px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--surface-card) 88%, transparent);
}
.channel-card.preferred {
  border-color: color-mix(in srgb, var(--accent, #0f766e) 55%, var(--border));
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.badge {
  font-size: 11px;
  color: var(--muted);
}
.note {
  font-size: 12px;
  color: var(--muted);
  margin: 8px 0 12px;
  line-height: 1.45;
  min-height: 2.8em;
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.doc-section {
  margin-top: 28px;
  padding-top: 16px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.doc-section h2 {
  font-size: 16px;
  margin: 0 0 6px;
}
.doc-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: min(480px, 70vw);
}
.doc-out {
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 12px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  padding: 10px;
  border-radius: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}
.field.enable-row {
  margin-bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.field.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}
.chat-diag code {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--surface-soft, rgba(0, 0, 0, 0.06));
}
.probe {
  font-size: 12px;
  color: var(--success, #0f766e);
  margin: 0 0 8px;
}
.boss-bind {
  margin: 8px 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
}
.boss-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
.boss-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kf-select {
  width: 100%;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  background: var(--surface, #1a1f24);
  color: inherit;
  font: inherit;
}
.kf-section-title {
  margin-top: 8px;
  font-weight: 600;
}
.kf-drafts {
  margin: 8px 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
}
.kf-draft-row {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kf-customer {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.kf-draft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.err {
  color: #b91c1c;
  font-size: 13px;
}
</style>
