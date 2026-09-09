<script setup lang="ts">
/**
 * @file 办公室企微客服待回复草稿条
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 1.0.0
 * @category Layout
 * @algo wecom-kf-draft-bar
 */
import { onMounted, onUnmounted, ref } from "vue";
import { FouButton, fouAlert, fouMsg } from "foucui";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  approveWecomKfSend,
  listWecomKfDrafts,
  saveWecomKfDraft,
  type WecomKfDraft,
} from "../utils/channelConnections";
import { toUserError } from "../utils/userFacingError";

const drafts = ref<WecomKfDraft[]>([]);
const busyId = ref<string | null>(null);
let unlisten: UnlistenFn | null = null;

async function refresh() {
  try {
    drafts.value = await listWecomKfDrafts();
  } catch {
    drafts.value = [];
  }
}

async function saveDraft(d: WecomKfDraft) {
  busyId.value = d.msgId;
  try {
    await saveWecomKfDraft(d.msgId, d.draftReply);
    await refresh();
    fouMsg.success("草稿已保存");
  } catch (e) {
    void fouAlert(toUserError(e), "客服草稿");
  } finally {
    busyId.value = null;
  }
}

async function approveDraft(d: WecomKfDraft) {
  if (!d.draftReply.trim()) {
    void fouAlert("请先填写回复内容", "确认发送");
    return;
  }
  busyId.value = d.msgId;
  try {
    await saveWecomKfDraft(d.msgId, d.draftReply);
    await approveWecomKfSend(d.msgId);
    await refresh();
    fouMsg.success("已发送客服回复");
  } catch (e) {
    void fouAlert(toUserError(e), "确认发送");
  } finally {
    busyId.value = null;
  }
}

onMounted(() => {
  void refresh();
  void listen("xu-wecom-kf-inbound", () => {
    void refresh();
  }).then((u) => {
    unlisten = u;
  });
});

onUnmounted(() => {
  unlisten?.();
  unlisten = null;
});

defineExpose({ refresh });
</script>

<template>
  <section v-if="drafts.length" class="wecom-kf-bar ui-font">
    <header class="wecom-kf-head">
      <strong>企微客服 · 待确认回复（{{ drafts.length }}）</strong>
      <FouButton icon="refresh-line" size="small" native-type="button" @click="refresh">刷新</FouButton>
    </header>
    <article v-for="d in drafts" :key="d.msgId" class="wecom-kf-item">
      <p class="wecom-kf-customer">客户：{{ d.customerText }}</p>
      <textarea
        v-model="d.draftReply"
        class="wecom-kf-reply"
        rows="3"
        placeholder="回复草稿（员工可自动起草，您确认后再发送）…"
      />
      <div class="wecom-kf-actions">
        <FouButton
          size="small"
          icon="save-line"
          native-type="button"
          :disabled="busyId === d.msgId"
          @click="saveDraft(d)"
        >
          保存草稿
        </FouButton>
        <FouButton
          size="small"
          type="primary"
          icon="send-plane-line"
          native-type="button"
          :disabled="busyId === d.msgId"
          @click="approveDraft(d)"
        >
          确认发送
        </FouButton>
      </div>
    </article>
  </section>
</template>

<style scoped>
.wecom-kf-bar {
  margin: 8px 12px 0;
  padding: 10px 12px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
}
.wecom-kf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}
.wecom-kf-item + .wecom-kf-item {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border, rgba(255, 255, 255, 0.06));
}
.wecom-kf-customer {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--muted);
}
.wecom-kf-reply {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 13px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  background: var(--surface, #1a1f24);
  color: inherit;
  resize: vertical;
}
.wecom-kf-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
</style>
