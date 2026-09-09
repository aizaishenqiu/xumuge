/**
 * @file 登录后非阻塞自检：Cosy bootstrap / 离线语音探测 / 大脑配置软探测
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @updated 2026-09-01
 * @version 1.1.0
 * @category Config
 * @algo parallel-soft-probe
 */

import { loadOpsBrains } from "./opsBrains";
import { fetchVoiceEngineStatus } from "./voiceEngineCapability";
import { toUserError } from "./userFacingError";

export type SelfCheckStatus = "pending" | "running" | "ok" | "fail" | "skip";

export interface SelfCheckItem {
  id: string;
  title: string;
  status: SelfCheckStatus;
  detail: string;
}

const SESSION_KEY = "xu.startup.selfcheck.done.v1";

/** 本会话是否已跑过自检（sessionStorage 防重复）。 */
export function hasRunStartupSelfCheck(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** 标记本会话已跑过自检。 */
export function markStartupSelfCheckDone(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // ignore
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

function initialItems(): SelfCheckItem[] {
  return [
    {
      id: "cosy-fastapi",
      title: "CosyVoice FastAPI",
      status: "pending",
      detail: "等待…",
    },
    {
      id: "voice-native",
      title: "离线语音引擎",
      status: "pending",
      detail: "等待…",
    },
    {
      id: "brains",
      title: "大脑模型配置",
      status: "pending",
      detail: "等待…",
    },
  ];
}

async function checkCosy(): Promise<Pick<SelfCheckItem, "status" | "detail">> {
  // 不在自检里立刻拉起 Cosy（抢 GPU → WebView 黑屏）；仅报告是否已配置自动启
  try {
    const { loadVoiceSettings } = await import("../stores/voiceSettings");
    const { getCosyWantRunning } = await import("./cosyFastapiSidecarApi");
    const settings = loadVoiceSettings();
    const disk = await withTimeout(getCosyWantRunning(), 3_000, "读取 want").catch(() => null);
    const want = Boolean(disk?.want || settings.cosyWantRunning);
    if (!want) {
      return { status: "skip", detail: "未启用自动启动（可在设置里启动）" };
    }
    return {
      status: "ok",
      detail: "已安排约 45 秒后后台启动，避免抢显卡导致黑屏",
    };
  } catch (e) {
    return {
      status: "skip",
      detail: toUserError(e),
    };
  }
}

async function checkVoiceNative(): Promise<Pick<SelfCheckItem, "status" | "detail">> {
  const st = await withTimeout(fetchVoiceEngineStatus("sherpa-onnx"), 12_000, "离线语音探测");
  if (st.synthesisAvailable) {
    return { status: "ok", detail: st.reason || "可用" };
  }
  if (st.packInstalled) {
    return { status: "fail", detail: st.reason || "已装但不可合成" };
  }
  return { status: "skip", detail: st.reason || "未安装（可选）" };
}

async function checkBrains(): Promise<Pick<SelfCheckItem, "status" | "detail">> {
  const brains = await withTimeout(loadOpsBrains(), 10_000, "大脑配置");
  const slots = [brains.command, brains.work, brains.code].filter(Boolean);
  const configured = slots.filter((s) => s && (String(s.model || "").trim() || String(s.baseUrl || "").trim()));
  if (configured.length > 0) {
    return { status: "ok", detail: `已配置 ${configured.length} 个槽位` };
  }
  return { status: "skip", detail: "暂无模型配置（可稍后在设置中添加）" };
}

/**
 * 并行跑三项自检；通过 onUpdate 推送中间态。任一项失败不抛、不挡路由。
 */
export async function runStartupSelfCheck(
  onUpdate: (items: SelfCheckItem[]) => void,
): Promise<SelfCheckItem[]> {
  const items = initialItems();
  const bump = (id: string, patch: Partial<SelfCheckItem>) => {
    const i = items.findIndex((x) => x.id === id);
    if (i >= 0) items[i] = { ...items[i]!, ...patch };
    onUpdate(items.map((x) => ({ ...x })));
  };

  onUpdate(items.map((x) => ({ ...x })));

  const tasks: Array<{ id: string; run: () => Promise<Pick<SelfCheckItem, "status" | "detail">> }> =
    [
      { id: "cosy-fastapi", run: checkCosy },
      { id: "voice-native", run: checkVoiceNative },
      { id: "brains", run: checkBrains },
    ];

  await Promise.all(
    tasks.map(async ({ id, run }) => {
      bump(id, { status: "running", detail: "进行中…" });
      try {
        const r = await run();
        bump(id, r);
      } catch (e) {
        bump(id, {
          status: "fail",
          detail: toUserError(e),
        });
      }
    }),
  );

  return items;
}
