/**
 * @file V1 对外文案：隐藏商业营销用语（非授权判定）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-05
 * @version 1.1.0
 * @category Config
 * @algo env-flag-display
 */
import { getShowCommerceUiFlag } from "./appEnv";

/** Display-only. Never use as entitlement; gates must call Rust `xu_license_entitlements`. */
export function showCommerceUi(): boolean {
  return getShowCommerceUiFlag();
}

/** User-visible label for Canvas side panel (no「商业版」in v1). */
export function canvasPanelLabel(): string {
  return showCommerceUi() ? "Canvas（商业版）" : "Canvas";
}
