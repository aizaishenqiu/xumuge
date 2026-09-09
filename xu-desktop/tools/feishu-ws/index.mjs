#!/usr/bin/env node
/**
 * Fou Feishu long-connection sidecar.
 * Env: FEISHU_APP_ID, FEISHU_APP_SECRET
 * stdout: NDJSON only. SDK logs → stderr.
 *
 * Receives im.message.receive_v1 via WSClient.
 * Note: without「获取群组中所有消息」, Feishu only pushes messages that @ the bot.
 */
import fs from "fs";
import * as Lark from "@larksuiteoapi/node-sdk";

for (const m of ["log", "info", "warn", "debug", "error"]) {
  const orig = console[m].bind(console);
  console[m] = (...args) => {
    try {
      fs.writeSync(
        2,
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n",
      );
    } catch {
      try {
        orig(...args);
      } catch {
        /* ignore */
      }
    }
  };
}

function emit(obj) {
  try {
    fs.writeSync(1, JSON.stringify(obj) + "\n");
  } catch {
    /* ignore */
  }
}

const appId = (process.env.FEISHU_APP_ID || "").trim();
const appSecret = (process.env.FEISHU_APP_SECRET || "").trim();

if (!appId.startsWith("cli_") || !appSecret) {
  emit({ type: "error", message: "FEISHU_APP_ID / FEISHU_APP_SECRET 无效" });
  process.exit(1);
}

function extractText(contentRaw) {
  if (!contentRaw) return "";
  try {
    const c = typeof contentRaw === "string" ? JSON.parse(contentRaw) : contentRaw;
    if (typeof c.text === "string") return c.text;
    if (typeof c.content === "string") return c.content;
    if (Array.isArray(c.content)) {
      return c.content
        .flat(3)
        .map((x) => (x && typeof x === "object" ? x.text || "" : String(x || "")))
        .filter(Boolean)
        .join("");
    }
    return JSON.stringify(c);
  } catch {
    return String(contentRaw);
  }
}

/** Replace @_user_1 / @_bot_1 placeholders with readable text; drop bot @ from body. */
function expandMentionPlaceholders(text, mentions) {
  let t = text || "";
  if (!Array.isArray(mentions)) return t.trim();
    for (const m of mentions) {
    const key = (m?.key || "").trim();
    if (!key) continue;
    const name = (m?.name || "").trim();
    const isBot = String(m?.mentioned_type || "").toLowerCase() === "bot";
    if (isBot) {
      t = t.split(key).join(" ");
    } else if (name) {
      t = t.split(key).join(`@${name}`);
    }
  }
  t = t.replace(/@_all\b/g, "@所有人");
  return t.replace(/\s+/g, " ").trim();
}

function extractHumanMentionNames(mentions, expandedText) {
  const names = [];
  if (Array.isArray(mentions)) {
    for (const m of mentions) {
      if (String(m?.mentioned_type || "").toLowerCase() === "bot") continue;
      const n = (m?.name || "").trim();
      if (n && !names.includes(n)) names.push(n);
    }
  }
  const re = /@([^\s@，,。.!！？?：:]{1,32})/g;
  let m;
  while ((m = re.exec(expandedText || ""))) {
    const n = m[1].trim();
    if (!n || /^_?(user|bot)_\d+$/i.test(n)) continue;
    if (!names.includes(n)) names.push(n);
  }
  return names;
}

function handleReceive(data, eventName) {
  try {
    // EventDispatcher already unwraps: data often IS the event body with .message/.sender
    const root =
      data?.event && (data?.event?.message || data?.message) ? data.event : data;
    const message = root?.message || data?.message || {};
    const sender = root?.sender || data?.sender || {};
    const mentions = message.mentions || [];
    const msgType = message.message_type || "";
    let rawText = extractText(message.content);
    if (!rawText && msgType && msgType !== "text") {
      rawText = `[${msgType}]`;
    }
    const text = expandMentionPlaceholders(rawText, mentions);
    const mentionNames = extractHumanMentionNames(mentions, text);
    emit({
      type: "debug",
      message: `handler=${eventName} chat=${message.chat_id || ""} type=${msgType} raw=${JSON.stringify(rawText).slice(0, 80)}`,
      hasMessage: Boolean(message?.message_id || message?.content),
    });
    if (!message?.message_id && !message?.content) {
      emit({
        type: "debug",
        message: `empty payload keys=${Object.keys(data || {}).join(",")}`,
      });
    }
    emit({
      type: "message",
      chatId: message.chat_id || "",
      messageId: message.message_id || "",
      messageType: msgType,
      chatType: message.chat_type || "",
      senderOpenId: sender?.sender_id?.open_id || sender?.sender_id?.user_id || "",
      senderType: sender?.sender_type || "",
      senderName: "",
      text,
      mentionNames,
      ts: Date.now(),
    });
  } catch (e) {
    emit({ type: "error", message: String(e?.message || e) });
  }
}

const wsClient = new Lark.WSClient({
  appId,
  appSecret,
  loggerLevel: Lark.LoggerLevel.warn,
});

emit({ type: "status", state: "starting" });

const handlers = {
  "im.message.receive_v1": async (data) => handleReceive(data, "im.message.receive_v1"),
  // Some tenants / SDK paths surface schema-2 style names
  "p2.im.message.receive_v1": async (data) => handleReceive(data, "p2.im.message.receive_v1"),
};

const dispatcher = new Lark.EventDispatcher({
  loggerLevel: Lark.LoggerLevel.warn,
}).register(handlers);

// Surface unmatched event types to Fou logs (otherwise silent miss)
const origInvoke = dispatcher.invoke.bind(dispatcher);
dispatcher.invoke = async function patchedInvoke(data, params) {
  const result = await origInvoke(data, params);
  if (typeof result === "string" && result.startsWith("no ")) {
    emit({ type: "debug", message: `unhandled_event: ${result}` });
  }
  return result;
};

wsClient
  .start({ eventDispatcher: dispatcher })
  .then(() => {
    emit({ type: "status", state: "connected" });
    emit({
      type: "hint",
      message:
        "长连接已就绪。若群消息仍无 type=message：①开放平台已添加事件「接收消息 im.message.receive_v1」②群里请 @机器人 发一句；不 @ 需开通并发布「获取群组中所有消息」③保存长连接时缶萃须在线。同一 App 只能有一个长连接。",
    });
  })
  .catch((e) => {
    emit({ type: "error", message: String(e?.message || e) });
    process.exit(1);
  });

setInterval(() => {
  emit({ type: "heartbeat", ts: Date.now() });
}, 30000);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
