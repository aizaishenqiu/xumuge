/**
 * @file mermaidRuntime.ts Mermaid 懒加载与单次初始化
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.1.0
 * @category Cache
 * @algo mermaid-once-init
 */

let inited = false;

/** Duty: 渲染 Mermaid 源码为 SVG；initialize 只跑一次。 */
export async function renderMermaid(id: string, source: string): Promise<string> {
  const mod = await import("mermaid");
  const mermaid = mod.default;
  if (!inited) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    inited = true;
  }
  const { svg } = await mermaid.render(id, source);
  return svg;
}
