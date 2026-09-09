/**
 * @file 应用内帮助树（开源导出：无私有 docs/help 正文）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-09
 * @version 1.0.0-oss
 * @category Config
 * @algo none
 */

export type HelpTreeNode = {
  id: string;
  title: string;
  icon?: string;
  doc?: string;
  children?: HelpTreeNode[];
};

/** Open-source build: no private help markdown; UI shows empty / website CTA. */
export const HELP_TREE: HelpTreeNode[] = [];

export const DEFAULT_HELP_TOPIC = "oss.website";

export const ROUTE_HELP_TOPICS: Record<string, string> = {};

export function flattenHelpNodes(nodes: HelpTreeNode[] = HELP_TREE): HelpTreeNode[] {
  const out: HelpTreeNode[] = [];
  const walk = (list: HelpTreeNode[]) => {
    for (const n of list) {
      if (n.doc) out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function findHelpNode(id: string, nodes: HelpTreeNode[] = HELP_TREE): HelpTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findHelpNode(id, n.children);
      if (hit) return hit;
    }
  }
  return null;
}

export function helpTopicForRoute(path: string): string {
  return ROUTE_HELP_TOPICS[path] || DEFAULT_HELP_TOPIC;
}

export type HelpTreeDataNode = {
  id: string;
  label: string;
  doc?: string;
  children?: HelpTreeDataNode[];
};

export function buildHelpTreeData(nodes: HelpTreeNode[] = HELP_TREE): HelpTreeDataNode[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.title,
    doc: n.doc,
    children: n.children?.length ? buildHelpTreeData(n.children) : undefined,
  }));
}

export function firstDocTopicId(nodes: HelpTreeNode[] = HELP_TREE): string {
  const flat = flattenHelpNodes(nodes);
  return flat[0]?.id || DEFAULT_HELP_TOPIC;
}

export function resolveHelpTopicId(id: string | null | undefined): string {
  if (id && findHelpNode(id)) return id;
  return DEFAULT_HELP_TOPIC;
}

export function parentHelpTopicId(
  childId: string,
  nodes: HelpTreeNode[] = HELP_TREE,
): string | null {
  for (const n of nodes) {
    if (n.children?.some((c) => c.id === childId)) return n.id;
    if (n.children?.length) {
      const nested = parentHelpTopicId(childId, n.children);
      if (nested) return nested;
    }
  }
  return null;
}

export function helpTopicIdForDocRel(
  href: string,
  _fromDocRel?: string | null,
): string | null {
  const raw = String(href || "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  return null;
}
