import { toUserError } from "./userFacingError";
/**
 * @file 金额/税率确定性计算沙盒（LLM 只解释结果）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-01
 * @version 1.0.0
 * @category Parse
 * @algo fixed-point-money-math
 */

export type CalcOp =
  | { op: "sum"; amounts: number[] }
  | { op: "tax_inclusive"; amount: number; ratePercent: number }
  | { op: "tax_exclusive"; amount: number; ratePercent: number }
  | { op: "subtotal"; lines: { qty: number; unitPrice: number }[] };

export type CalcResult = {
  ok: true;
  value: number;
  breakdown: string[];
} | {
  ok: false;
  error: string;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Parse XU_CALC JSON or simple "sum:1,2,3" / "tax:100@13". */
export function parseFouCalcDirective(text: string): CalcOp | null {
  const t = (text || "").trim();
  const json = t.match(/XU_CALC\s*[:：]?\s*(\{[\s\S]*\})/i);
  if (json) {
    try {
      const o = JSON.parse(json[1]) as CalcOp;
      if (o && typeof o === "object" && "op" in o) return o;
    } catch {
      return null;
    }
  }
  const sum = t.match(/XU_CALC\s*[:：]?\s*sum\s*[:=]\s*([\d.,\s+-]+)/i);
  if (sum) {
    const amounts = sum[1]
      .split(/[,，\s]+/)
      .map((x) => Number(x.replace(/,/g, "")))
      .filter((n) => Number.isFinite(n));
    if (amounts.length) return { op: "sum", amounts };
  }
  const tax = t.match(
    /XU_CALC\s*[:：]?\s*tax\s*[:=]\s*([\d.]+)\s*@\s*([\d.]+)/i,
  );
  if (tax) {
    return {
      op: "tax_exclusive",
      amount: Number(tax[1]),
      ratePercent: Number(tax[2]),
    };
  }
  return null;
}

/**
 * Duty: deterministic money math for XU_CALC / UI.
 * Failure: returns ok:false with message (no throw).
 */
export function runCalcSandbox(op: CalcOp): CalcResult {
  try {
    if (op.op === "sum") {
      const amounts = op.amounts.map((n) => Number(n)).filter((n) => Number.isFinite(n));
      if (!amounts.length) return { ok: false, error: "sum 需要至少一个金额" };
      const value = round2(amounts.reduce((a, b) => a + b, 0));
      return {
        ok: true,
        value,
        breakdown: [`合计 ${amounts.map((a) => round2(a)).join(" + ")} = ${value}`],
      };
    }
    if (op.op === "tax_exclusive") {
      const amount = Number(op.amount);
      const rate = Number(op.ratePercent);
      if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate < 0 || rate > 100) {
        return { ok: false, error: "税率须在 0～100，金额须为数字" };
      }
      const tax = round2((amount * rate) / 100);
      const total = round2(amount + tax);
      return {
        ok: true,
        value: total,
        breakdown: [
          `未税 ${round2(amount)}`,
          `税率 ${rate}% → 税额 ${tax}`,
          `含税合计 ${total}`,
        ],
      };
    }
    if (op.op === "tax_inclusive") {
      const amount = Number(op.amount);
      const rate = Number(op.ratePercent);
      if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate < 0 || rate >= 100) {
        return { ok: false, error: "含税反算：税率须在 0～100（不含 100）" };
      }
      const net = round2(amount / (1 + rate / 100));
      const tax = round2(amount - net);
      return {
        ok: true,
        value: net,
        breakdown: [
          `含税 ${round2(amount)}`,
          `税率 ${rate}% → 未税 ${net}，税额 ${tax}`,
        ],
      };
    }
    if (op.op === "subtotal") {
      const lines = op.lines || [];
      if (!lines.length) return { ok: false, error: "subtotal 需要行项目" };
      const parts: string[] = [];
      let value = 0;
      for (const line of lines) {
        const qty = Number(line.qty);
        const unit = Number(line.unitPrice);
        if (!Number.isFinite(qty) || !Number.isFinite(unit)) {
          return { ok: false, error: "行项目 qty/unitPrice 须为数字" };
        }
        const lineTotal = round2(qty * unit);
        value = round2(value + lineTotal);
        parts.push(`${qty}×${round2(unit)}=${lineTotal}`);
      }
      return { ok: true, value, breakdown: [`明细 ${parts.join("；")}`, `小计 ${value}`] };
    }
    return { ok: false, error: "未知运算" };
  } catch (e) {
    return { ok: false, error: toUserError(e) };
  }
}

export function formatCalcForAgent(result: CalcResult): string {
  if (!result.ok) return `XU_CALC 失败：${result.error}`;
  return `XU_CALC 结果：${result.value}\n${result.breakdown.join("\n")}\n（数字由本地沙盒计算，请只解释勿重算）`;
}
