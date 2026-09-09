/**
 * @file 应用内帮助 Markdown 的构建期加载器
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo eager-path-index
 */
const rawModules = import.meta.glob("../../docs/help/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const DOC_BY_REL = new Map<string, string>();

for (const [key, text] of Object.entries(rawModules)) {
  const rel = key.replace(/^.*docs\/help\//, "").replace(/\?raw$/, "");
  DOC_BY_REL.set(rel, text);
}

/** 按相对路径读取打包正文；路径缺失时返回可见占位信息。 */
export function loadHelpMarkdown(docRel: string | undefined): string {
  if (!docRel) return "_暂无正文。_";
  return DOC_BY_REL.get(docRel) || `_未找到文档：${docRel}_`;
}
