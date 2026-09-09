/**
 * @file 打开应用设置页（首页/侧栏/顶栏共用）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-01
 * @version 1.1.0
 * @category Navigation
 * @algo route-fallback
 */
import { router } from "../router";

/**
 * Duty: 根据当前路由打开设置：IDE 内嵌设置 Tab，其余页面跳转 `#/settings`。
 * @param group 可选，打开后直接定位到设置分组（如 models、billing）
 * Failure: 路由 push 失败时回退改 location.hash，避免侧栏/顶栏「设置打不开」。
 */
export async function openAppSettings(
  currentPath?: string,
  group?: string,
): Promise<void> {
  const path = currentPath ?? router.currentRoute.value.path;
  try {
    if (path === "/ide") {
      const { openIdeSettingsTab } = await import("./ideSpecialTabs");
      openIdeSettingsTab(group);
      return;
    }
    const query = group?.trim() ? { group: group.trim() } : {};
    if (path === "/settings") {
      if (group?.trim()) await router.replace({ path: "/settings", query });
      return;
    }
    await router.push({ path: "/settings", query });
  } catch (err) {
    console.warn("[openAppSettings]", err);
    const q = group?.trim() ? `?group=${encodeURIComponent(group.trim())}` : "";
    try {
      window.location.hash = `#/settings${q}`;
    } catch {
      /* ignore */
    }
  }
}
