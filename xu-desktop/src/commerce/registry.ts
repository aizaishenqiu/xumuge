import type { XuCommercialPlugin } from "./types";
import { acquireHeavyModule, releaseHeavyModule } from "./activeHeavyModule";

const plugins = new Map<string, XuCommercialPlugin>();
let activeId: string | null = null;

export function listCommercialPlugins(): XuCommercialPlugin[] {
  return [...plugins.values()];
}

export function getCommercialPlugin(id: string): XuCommercialPlugin | undefined {
  return plugins.get(id);
}

export function getActiveCommercialPlugin(): XuCommercialPlugin | null {
  return activeId ? plugins.get(activeId) ?? null : null;
}

/** Register a plugin implementation (from .xubiz loader in later waves). */
export function registerCommercialPlugin(plugin: XuCommercialPlugin): void {
  plugins.set(plugin.id, plugin);
}

export function unregisterCommercialPlugin(id: string): void {
  if (activeId === id) {
    activeId = null;
    releaseHeavyModule(id);
  }
  plugins.delete(id);
}

export async function activateCommercialPlugin(
  id: string,
  activateFn: (plugin: XuCommercialPlugin) => Promise<void>,
): Promise<void> {
  const plugin = plugins.get(id);
  if (!plugin) throw new Error(`商业插件未注册：${id}`);
  acquireHeavyModule(id);
  try {
    if (activeId && activeId !== id) {
      const prev = plugins.get(activeId);
      if (prev) await prev.deactivate();
      releaseHeavyModule(activeId);
    }
    await activateFn(plugin);
    activeId = id;
  } catch (e) {
    if (activeId !== id) releaseHeavyModule(id);
    throw e;
  }
}

export async function deactivateActiveCommercialPlugin(): Promise<void> {
  if (!activeId) return;
  const id = activeId;
  const plugin = plugins.get(id);
  activeId = null;
  releaseHeavyModule(id);
  if (plugin) await plugin.deactivate();
}

/** First registered plugin that declares the entitlement (for Canvas / training hooks). */
export function findPluginForEntitlement(entitlement: string): XuCommercialPlugin | null {
  for (const p of plugins.values()) {
    if (p.entitlements.includes(entitlement)) return p;
  }
  return null;
}
