#!/usr/bin/env node
/**
 * @file 企微客服消息轮询 sidecar（入站 NDJSON + 确认后发送）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 0.1.0
 * @category Network
 * @algo wecom-kf-poll
 *
 * Env: WECOM_CORP_ID, WECOM_KF_SECRET, WECOM_OPEN_KFID
 * stdout: NDJSON events
 * stdin: NDJSON commands { type: 'send', externalUserid, openKfid, text }
 */
import fs from "fs";
import readline from "readline";

function emit(obj) {
  try {
    fs.writeSync(1, JSON.stringify(obj) + "\n");
  } catch {
    /* ignore */
  }
}

const corpId = (process.env.WECOM_CORP_ID || "").trim();
const secret = (process.env.WECOM_KF_SECRET || "").trim();
const openKfid = (process.env.WECOM_OPEN_KFID || "").trim();
const pollMs = Math.max(5000, Number(process.env.WECOM_KF_POLL_MS || 12000));

if (!corpId || !secret || !openKfid) {
  emit({ type: "error", message: "WECOM_CORP_ID / WECOM_KF_SECRET / WECOM_OPEN_KFID 未配置" });
  process.exit(1);
}

let token = "";
let tokenExpire = 0;
let cursor = "";

async function fetchToken() {
  const now = Date.now();
  if (token && now < tokenExpire - 60_000) return token;
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(data.errmsg || "gettoken failed");
  }
  token = data.access_token;
  tokenExpire = now + (data.expires_in || 7200) * 1000;
  return token;
}

async function syncMessages() {
  const access = await fetchToken();
  const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${access}`;
  const body = { cursor, token: "", limit: 50, voice_format: 0, open_kfid: openKfid };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode !== 0) {
    emit({ type: "error", message: data.errmsg || "sync_msg failed", errcode: data.errcode });
    return;
  }
  if (data.next_cursor) cursor = data.next_cursor;
  const list = Array.isArray(data.msg_list) ? data.msg_list : [];
  for (const m of list) {
    const text =
      m?.text?.content ||
      m?.text?.content ||
      (m?.msgtype === "text" && m?.content) ||
      "";
    if (!text) continue;
    emit({
      type: "inbound",
      msgId: m.msgid || "",
      externalUserid: m.external_userid || "",
      openKfid: m.open_kfid || openKfid,
      text: String(text).trim(),
      ts: m.send_time ? Number(m.send_time) * 1000 : Date.now(),
    });
  }
  if (list.length) {
    emit({ type: "heartbeat", synced: list.length, ts: Date.now() });
  }
}

async function sendReply(externalUserid, kfId, text) {
  const access = await fetchToken();
  const url = `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${access}`;
  const body = {
    touser: externalUserid,
    open_kfid: kfId || openKfid,
    msgtype: "text",
    text: { content: text },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode !== 0) {
    throw new Error(data.errmsg || "send_msg failed");
  }
  return data;
}

emit({ type: "ready", openKfid, ts: Date.now() });

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  if (cmd?.type === "send" && cmd.text && cmd.externalUserid) {
    try {
      await sendReply(cmd.externalUserid, cmd.openKfid, cmd.text);
      emit({ type: "sent", msgId: cmd.msgId || "", ts: Date.now() });
    } catch (e) {
      emit({ type: "error", message: String(e?.message || e) });
    }
  }
});

setInterval(() => {
  syncMessages().catch((e) => emit({ type: "error", message: String(e?.message || e) }));
}, pollMs);

syncMessages().catch((e) => emit({ type: "error", message: String(e?.message || e) }));
