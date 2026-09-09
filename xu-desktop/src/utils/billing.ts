/**
 * Token 账单与用量 IPC 封装
 *
 * @author qiuye <yjk150@qq.com>
 */
import { invoke } from "@tauri-apps/api/core";

export interface TokenBillingSummary {
  presetId: string;
  model: string;
  provider: string;
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costCnyMicros: number;
}

export type { TokenPackageStatus } from "../employee/memory";
export { tokenPackageStatus, setTokenPackage } from "../employee/memory";

export interface TokenBillRow {
  id: string;
  sessionId: string | null;
  source: string;
  model: string | null;
  presetId: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costCnyMicros: number;
  pricingTier: string;
  createdAt: number;
}

export interface PresetQuotaStatus {
  presetId: string;
  hardLimitCnyMicros: number;
  softRatio: number;
  usedCnyMicros: number;
  softHit: boolean;
  hardHit: boolean;
}

export interface TokenBillingBucket {
  bucketStart: number;
  label: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costCnyMicros: number;
  callCount: number;
}

export interface SessionBillingSummary {
  sessionId: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costCnyMicros: number;
  callCount: number;
}

export interface SessionBillingRound {
  roundIndex: number;
  model: string;
  presetId: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costCnyMicros: number;
  createdAt: number;
}

export interface ModelBillingSeriesPoint {
  label: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costCnyMicros: number;
  callCount: number;
}

export type BillingGranularity = "day" | "week" | "month";

/**
 * 查询单个会话的累计账单（对话底栏「共消耗」）
 */
export async function sessionBillingSummary(sessionId: string): Promise<SessionBillingSummary> {
  return invoke<SessionBillingSummary>("xu_session_billing_summary", { sessionId });
}

/**
 * 查询单个会话按 API 调用轮次的明细（上下文弹层）
 */
export async function sessionBillingRounds(sessionId: string): Promise<SessionBillingRound[]> {
  return invoke<SessionBillingRound[]>("xu_session_billing_rounds", { sessionId });
}

/**
 * 全部模型在时间区间内的分桶序列（图表 X 轴为日期/周/月）
 */
export async function tokenBillingModelSeries(
  fromMs: number,
  toMs: number,
  granularity: BillingGranularity,
): Promise<ModelBillingSeriesPoint[]> {
  return invoke<ModelBillingSeriesPoint[]>("xu_token_billing_model_series", {
    fromMs,
    toMs,
    granularity,
  });
}

/**
 * 单个模型在时间区间内的分桶序列
 */
export async function tokenBillingSeries(
  fromMs: number,
  toMs: number,
  granularity: BillingGranularity,
  presetId?: string,
): Promise<TokenBillingBucket[]> {
  return invoke<TokenBillingBucket[]>("xu_token_billing_series", {
    fromMs,
    toMs,
    granularity,
    presetId: presetId?.trim() || null,
  });
}

/**
 * 将微元（百万分之一元）格式化为人民币字符串
 */
export function formatCnyMicros(micros: number): string {
  if (!micros) return "¥0.00";
  return `¥${(micros / 1_000_000).toFixed(4).replace(/\.?0+$/, "")}`;
}

/** 会话底栏短显示，如 4.38 */
export function formatCnyShort(micros: number): string {
  return (micros / 1_000_000).toFixed(2);
}

/**
 * 将 Token 数量格式化为 K/M 可读字符串
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * 全量累计汇总（不限时间；兼容旧调用）
 */
export async function tokenBillingSummary(presetId?: string): Promise<TokenBillingSummary[]> {
  return invoke<TokenBillingSummary[]>("xu_token_billing_summary", {
    presetId: presetId?.trim() || null,
  });
}

/**
 * 按用户选择的时间区间汇总各模型（设置 → 账单表格，与图表区间一致）
 */
export async function tokenBillingSummaryInRange(
  fromMs: number,
  toMs: number,
  presetId?: string,
): Promise<TokenBillingSummary[]> {
  return invoke<TokenBillingSummary[]>("xu_token_billing_summary_range", {
    fromMs,
    toMs,
    presetId: presetId?.trim() || null,
  });
}

/**
 * 列出最近 Token 账单明细行
 */
export async function listTokenBills(presetId?: string, limit = 30): Promise<TokenBillRow[]> {
  return invoke<TokenBillRow[]>("xu_list_token_bills", {
    presetId: presetId?.trim() || null,
    limit,
  });
}

/**
 * 按时间区间列出每次 API 调用的 Token 账单明细（设置 → 账单表格）
 */
export async function listTokenBillsInRange(
  fromMs: number,
  toMs: number,
  presetId?: string,
  limit = 500,
): Promise<TokenBillRow[]> {
  return invoke<TokenBillRow[]>("xu_list_token_bills_range", {
    fromMs,
    toMs,
    presetId: presetId?.trim() || null,
    limit,
  });
}

/** 账单明细时间列：YYYY-MM-DD HH:mm:ss */
export function formatBillTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 读取远程模型套餐配额状态 */
export async function getPresetQuota(presetId: string): Promise<PresetQuotaStatus> {
  return invoke<PresetQuotaStatus>("xu_get_preset_quota", { presetId });
}

/** 设置远程模型套餐硬/软限额 */
export async function setPresetQuota(
  presetId: string,
  hardLimitCnyMicros: number,
  softRatio?: number,
): Promise<PresetQuotaStatus> {
  return invoke<PresetQuotaStatus>("xu_set_preset_quota", {
    payload: { presetId, hardLimitCnyMicros, softRatio },
  });
}

/** 从远程同步模型价目表 */
export async function syncModelPricing(url?: string): Promise<void> {
  await invoke("xu_sync_model_pricing", { url: url?.trim() || null });
}

/** 价目表是否到期需要同步 */
export async function pricingSyncDue(): Promise<boolean> {
  return invoke<boolean>("xu_pricing_sync_due");
}

export const PRICING_SYNC_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
