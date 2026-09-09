/**
 * @file CosyVoice 登录后自动启（独立于自检 overlay，避免 sessionStorage 跳过）
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-03
 * @version 1.2.2
 * @category Config
 * @algo once-per-load-bootstrap
 */

import { loadVoiceSettings, saveVoiceSettings } from "../stores/voiceSettings";
import { getCosyFastapiDefaultUrl } from "./appEnv";
import {
  cosyFastapiBootstrap,
  cosyFastapiSidecarStatus,
  getCosyWantRunning,
  setCosyWantRunning,
  type CosyBootstrapResult,
} from "./cosyFastapiSidecarApi";
import { probeFastapiUrl } from "./cosyFastapiClient";
import { ensureSystemCosyVoices } from "./cosySystemVoices";

let oncePromise: Promise<CosyBootstrapResult | null> | null = null;

function parsePortFromBaseUrl(url: string): number {
  try {
    const u = new URL(url.trim() || getCosyFastapiDefaultUrl());
    const p = Number(u.port);
    return Number.isFinite(p) && p > 0 ? p : 50000;
  } catch {
    return 50000;
  }
}

/**
 * 轮询 FastAPI 是否可达；模型冷启动可能数十秒。
 * 返回 true=就绪；false=超时仍不可达。
 */
export async function waitCosyFastapiHealthy(
  baseUrl: string,
  timeoutMs = 90_000,
  intervalMs = 2_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await probeFastapiUrl(baseUrl);
      if (r.ready) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * 本页加载只跑一次：若 want 或设置里已记自动启且路径齐，则 bootstrap。
 * 不依赖自检 overlay / sessionStorage。
 */
export function ensureCosyAutostartOnce(): Promise<CosyBootstrapResult | null> {
  if (!oncePromise) {
    oncePromise = runCosyAutostart()
      .then((r) => {
        // 未真正跑起来时放开锁，便于设置页 / 延迟重试再拉起
        if (!r?.running) oncePromise = null;
        return r;
      })
      .catch((e) => {
        oncePromise = null;
        throw e;
      });
  }
  return oncePromise;
}

/**
 * 语音口令「启动 Cosy」：强制 want=true 并拉起 sidecar（可重复调用）。
 */
export async function forceStartCosyForVoice(): Promise<CosyBootstrapResult> {
  const settings = loadVoiceSettings();
  const python = settings.cosyPython.trim();
  const serverScript = settings.cosyServerScript.trim();
  const model = settings.cosyModelDir.trim();
  const port = parsePortFromBaseUrl(settings.cosyFastapiBaseUrl);
  const extraArgs = settings.cosyExtraArgs.trim();
  saveVoiceSettings({
    ...settings,
    provider: "cosyvoice",
    cosyBackend: "fastapi",
    cosyWantRunning: true,
  });
  try {
    await setCosyWantRunning({
      want: true,
      python,
      serverScript,
      model,
      port,
      extraArgs,
    });
  } catch {
    /* ignore */
  }
  oncePromise = null;
  if (!python || !serverScript || !model) {
    return {
      attempted: false,
      running: false,
      pid: null,
      message: "未配置 Cosy 路径，请到设置 → Cosy 完成本机安装。",
    };
  }
  const r = await runCosyAutostart();
  return (
    r ?? {
      attempted: true,
      running: false,
      pid: null,
      message: "启动未返回结果",
    }
  );
}

/** 允许设置页在探测失败后手动再触发（不占用 once 锁以外的路径）。 */
export async function runCosyAutostart(): Promise<CosyBootstrapResult | null> {
  const settings = loadVoiceSettings();
  if (settings.cosyBackend !== "fastapi") {
    return {
      attempted: false,
      running: false,
      pid: null,
      message: "当前后端非本机 FastAPI",
    };
  }

  const disk = await getCosyWantRunning().catch(() => null);
  const want = Boolean(disk?.want || settings.cosyWantRunning);
  const python = (disk?.python || settings.cosyPython).trim();
  const serverScript = (disk?.serverScript || settings.cosyServerScript).trim();
  const model = (disk?.model || settings.cosyModelDir).trim();
  const port = disk?.port && disk.port > 0 ? disk.port : parsePortFromBaseUrl(settings.cosyFastapiBaseUrl);
  const extraArgs = (disk?.extraArgs || settings.cosyExtraArgs).trim();

  if (!want) {
    return {
      attempted: false,
      running: false,
      pid: null,
      message: "已跳过（未启用自动启动）",
    };
  }
  if (!python || !serverScript || !model) {
    return {
      attempted: false,
      running: false,
      pid: null,
      message: "未配置路径（Python / server / model）",
    };
  }

  // 已在跑且可探通则不再 free_port 杀进程
  try {
    const st = await cosyFastapiSidecarStatus();
    if (st.running) {
      // 短探通即可；模型冷启动不在此阻塞 UI
      const healthy = await waitCosyFastapiHealthy(settings.cosyFastapiBaseUrl, 3_000, 1_000);
      if (healthy) {
        void seedSystemVoicesInBackground(settings);
        return {
          attempted: true,
          running: true,
          pid: st.pid,
          message: `已在运行（pid ${st.pid ?? "?"}）`,
        };
      }
      // 进程在跑但 API 未就绪：不阻塞启动，后台继续等
      void waitCosyFastapiHealthy(settings.cosyFastapiBaseUrl, 90_000, 2_000).then((ok) => {
        if (ok) void seedSystemVoicesInBackground(settings);
      });
      return {
        attempted: true,
        running: true,
        pid: st.pid,
        message: `进程已在跑（pid ${st.pid ?? "?"}），模型加载中`,
      };
    }
  } catch {
    /* fall through to bootstrap */
  }

  try {
    await setCosyWantRunning({
      want: true,
      python,
      serverScript,
      model,
      port,
      extraArgs,
    });
    saveVoiceSettings({ ...settings, cosyWantRunning: true });
  } catch {
    /* ignore */
  }

  const result = await cosyFastapiBootstrap({
    want: true,
    python,
    serverScript,
    model,
    port,
    extraArgs,
  });

  if (result.running) {
    // 勿在启动链路里干等 90s：否则自检全屏层像卡死
    void waitCosyFastapiHealthy(settings.cosyFastapiBaseUrl, 90_000, 2_000).then((ok) => {
      if (ok) void seedSystemVoicesInBackground(settings);
    });
    return {
      ...result,
      message: `${result.message} · 模型后台加载中`,
    };
  }
  return result;
}

function seedSystemVoicesInBackground(
  settings: ReturnType<typeof loadVoiceSettings>,
): Promise<void> {
  return ensureSystemCosyVoices({
    voicesRoot: settings.cosyVoicesRoot,
    defaultPromptWav: settings.cosyDefaultPromptWav,
    defaultPromptText: settings.cosyDefaultPromptText,
    persistRoot: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}

