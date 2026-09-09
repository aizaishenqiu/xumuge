#!/usr/bin/env node
/**
 * @file Cursor SDK sidecar（probe / prompt / CLI open）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 0.1.0
 * @category Network
 * @algo cursor-sdk-stdio-ndjson
 *
 * Env: CURSOR_API_KEY
 * stdin: NDJSON { type: probe|prompt|open, ... }
 * stdout: NDJSON { type: ready|result|error, ... }
 */
import fs from "fs";
import { spawn } from "child_process";
import readline from "readline";

function emit(obj) {
  try {
    fs.writeSync(1, JSON.stringify(obj) + "\n");
  } catch {
    /* ignore */
  }
}

async function loadAgent() {
  const mod = await import("@cursor/sdk");
  return mod.Agent;
}

async function handleProbe() {
  const key = (process.env.CURSOR_API_KEY || "").trim();
  if (!key) {
    emit({ type: "result", ok: false, detail: "CURSOR_API_KEY 未配置" });
    return;
  }
  try {
    await loadAgent();
    emit({ type: "result", ok: true, detail: "Cursor SDK 模块已加载" });
  } catch (e) {
    emit({ type: "result", ok: false, detail: String(e?.message || e) });
  }
}

async function handlePrompt(cmd) {
  const key = (process.env.CURSOR_API_KEY || "").trim();
  if (!key) {
    emit({ type: "error", message: "CURSOR_API_KEY 未配置" });
    return;
  }
  const cwd = (cmd.cwd || process.cwd()).trim();
  const text = (cmd.text || "").trim();
  if (!text) {
    emit({ type: "error", message: "prompt 为空" });
    return;
  }
  const modelId = (cmd.model || "composer-2.5").trim();
  try {
    const Agent = await loadAgent();
    const result = await Agent.prompt(text, {
      apiKey: key,
      model: { id: modelId },
      local: { cwd },
    });
    emit({
      type: "result",
      ok: true,
      status: result?.status || "unknown",
      text: result?.result || "",
    });
  } catch (e) {
    emit({ type: "error", message: String(e?.message || e) });
  }
}

function handleOpen(cmd) {
  const p = (cmd.path || "").trim();
  if (!p) {
    emit({ type: "error", message: "path 为空" });
    return;
  }
  const bin = process.platform === "win32" ? "cursor.cmd" : "cursor";
  const child = spawn(bin, [p], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
  child.unref();
  emit({ type: "result", ok: true, detail: `已请求打开 ${p}` });
}

async function dispatch(cmd) {
  const type = cmd?.type;
  if (type === "probe") return handleProbe();
  if (type === "prompt") return handlePrompt(cmd);
  if (type === "open") return handleOpen(cmd);
  emit({ type: "error", message: `unknown type: ${type}` });
}

const oneShot = process.argv.includes("--oneshot");

if (oneShot) {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", async () => {
    try {
      const cmd = JSON.parse(Buffer.concat(chunks).toString("utf8").trim() || "{}");
      await dispatch(cmd);
    } catch (e) {
      emit({ type: "error", message: String(e?.message || e) });
    }
    process.exit(0);
  });
} else {
  emit({ type: "ready", ts: Date.now() });
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    void (async () => {
      try {
        const cmd = JSON.parse(line);
        await dispatch(cmd);
      } catch (e) {
        emit({ type: "error", message: String(e?.message || e) });
      }
    })();
  });
}
