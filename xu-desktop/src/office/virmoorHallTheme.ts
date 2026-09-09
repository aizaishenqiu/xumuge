/**
 * @file virmoorHallTheme.ts 大厅 3D 主题 token（映射桌面 CSS 变量）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo css-token-bridge
 */

export type HallLayout = "studio";

/** 办公室内嵌固定 studio 视角（16 工位，侧列拉开） */
export const HALL_LAYOUT: HallLayout = "studio";

/** 读取根节点 CSS 变量，供 Three.js 材质取色 */
export function hallCssToken(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}
