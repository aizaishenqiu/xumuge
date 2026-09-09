/**
 * @file 老板确认策略：单模型额度断连 + 风险标签升级
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-01
 * @version 1.2.0
 * @category ToolPolicy
 * @algo heuristic-risk-matrix
 */
import { invoke } from "@tauri-apps/api/core";

export const BOSS_CONFIRM_POLICY_KEY = "xu.boss.confirm.policy";

/** Rust settings：途中写作单模型额度（元） */
export const WRITING_PER_MODEL_QUOTA_YUAN_KEY = "writing.per_model_quota_yuan";
/** Rust settings：额度触顶后的老板锁（值为 presetId，空=未锁） */
export const WRITING_QUOTA_BOSS_LOCK_KEY = "writing.quota.boss_lock";

export type BossConfirmPolicy = {
  /**
   * 途中写作护栏：单个模型累计费用（参考价·元）≥ 此值 → 断开连接；
   * 重开须老板确认。文案含金额 ≥ 此值时仍升级必老板。
   */
  amountThresholdYuan: number;
  requireBossForCrossModule: boolean;
  requireBossForRelease: boolean;
  requireBossForPaymentOrCompliance: boolean;
  /** 无高风险命中且有经理 → manager_ok，不强制老板 */
  lowRiskAutoManagerDecide: boolean;
};

export type NeedConfirmClass = "boss_required" | "manager_ok" | "auto_continue";

export type NeedConfirmContext = {
  isCrossModule?: boolean;
  isRelease?: boolean;
  hasManager?: boolean;
};

export const DEFAULT_BOSS_CONFIRM_POLICY: BossConfirmPolicy = {
  amountThresholdYuan: 5000,
  requireBossForCrossModule: true,
  requireBossForRelease: true,
  requireBossForPaymentOrCompliance: true,
  lowRiskAutoManagerDecide: true,
};

const PAYMENT_COMPLIANCE_RE =
  /付款|支付|转账|汇款|合规|等保|开票|发票|税务|删库|drop\s+table|生产环境|正式环境/i;
const RELEASE_RE = /发布|上线|发版|投产|rollback|回滚上线/i;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function normalizeBossConfirmPolicy(
  raw: Partial<BossConfirmPolicy> | null | undefined,
): BossConfirmPolicy {
  const b = { ...DEFAULT_BOSS_CONFIRM_POLICY, ...(raw || {}) };
  const amount = Number(b.amountThresholdYuan);
  return {
    amountThresholdYuan: Number.isFinite(amount)
      ? Math.max(0, Math.floor(amount))
      : DEFAULT_BOSS_CONFIRM_POLICY.amountThresholdYuan,
    requireBossForCrossModule: b.requireBossForCrossModule !== false,
    requireBossForRelease: b.requireBossForRelease !== false,
    requireBossForPaymentOrCompliance: b.requireBossForPaymentOrCompliance !== false,
    lowRiskAutoManagerDecide: b.lowRiskAutoManagerDecide !== false,
  };
}

export function readBossConfirmPolicy(): BossConfirmPolicy {
  const raw = readJson(BOSS_CONFIRM_POLICY_KEY);
  return normalizeBossConfirmPolicy(
    raw && typeof raw === "object" ? (raw as Partial<BossConfirmPolicy>) : null,
  );
}

export function writeBossConfirmPolicy(next: Partial<BossConfirmPolicy>): BossConfirmPolicy {
  const merged = normalizeBossConfirmPolicy({ ...readBossConfirmPolicy(), ...next });
  writeJson(BOSS_CONFIRM_POLICY_KEY, merged);
  return merged;
}

/**
 * Duty: sync writing per-model quota yuan into Rust settings (agent mid-run enforces).
 * Failure: swallow IPC errors (localStorage policy still valid for UI classification).
 */
export async function syncWritingPerModelQuotaToDb(yuan: number): Promise<void> {
  const n = Math.max(0, Math.floor(Number(yuan) || 0));
  try {
    await invoke("xu_set_setting", {
      key: WRITING_PER_MODEL_QUOTA_YUAN_KEY,
      value: String(n),
    });
  } catch {
    /* ignore */
  }
}

/** Duty: read which preset is locked after writing quota disconnect. */
export async function readWritingQuotaBossLock(): Promise<string> {
  try {
    const v = await invoke<string | null>("xu_get_setting", {
      key: WRITING_QUOTA_BOSS_LOCK_KEY,
    });
    return (v || "").trim();
  } catch {
    return "";
  }
}

/**
 * Duty: boss confirms and clears writing-quota disconnect lock so model calls may resume.
 * Failure: throws user-facing string from IPC.
 */
export async function clearWritingQuotaBossLock(): Promise<void> {
  await invoke("xu_set_setting", {
    key: WRITING_QUOTA_BOSS_LOCK_KEY,
    value: "",
  });
}

/** Extract largest yuan-like amount from free text. */
export function extractLargestAmountYuan(text: string): number | null {
  const t = text || "";
  let max: number | null = null;
  const re =
    /(?:¥|￥|RMB\s*)?\s*([\d]{1,3}(?:,[\d]{3})*(?:\.\d+)?|[\d]+(?:\.\d+)?)\s*(?:元|万)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const rawNum = m[1].replace(/,/g, "");
    let n = Number(rawNum);
    if (!Number.isFinite(n)) continue;
    if (/万/.test(m[0])) n *= 10_000;
    if (max == null || n > max) max = n;
  }
  return max;
}

/**
 * Duty: classify XU_NEED_CONFIRM text into who must review.
 * Failure: returns boss_required when ambiguous high-risk cues appear.
 */
export function classifyNeedConfirm(
  text: string,
  ctx?: NeedConfirmContext,
  policy?: BossConfirmPolicy,
): NeedConfirmClass {
  const p = policy ?? readBossConfirmPolicy();
  const body = text || "";

  if (ctx?.isCrossModule && p.requireBossForCrossModule) return "boss_required";
  if (ctx?.isRelease && p.requireBossForRelease) return "boss_required";
  if (p.requireBossForRelease && RELEASE_RE.test(body)) return "boss_required";
  if (p.requireBossForPaymentOrCompliance && PAYMENT_COMPLIANCE_RE.test(body)) {
    return "boss_required";
  }

  const amount = extractLargestAmountYuan(body);
  if (amount != null && amount >= p.amountThresholdYuan) return "boss_required";

  if (p.lowRiskAutoManagerDecide && ctx?.hasManager) return "manager_ok";
  if (p.lowRiskAutoManagerDecide && !ctx?.hasManager) return "auto_continue";
  return "boss_required";
}
