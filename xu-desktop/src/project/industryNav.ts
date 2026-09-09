/**
 * @file 项目侧栏行业树：与岗位 taxonomy-industries 对齐
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.1.0
 * @category Config
 * @algo industry-subtree-ids
 */
import { TAXONOMY_INDUSTRIES, industryLabel, type TaxonomyIndustry } from "../office/taxonomy";
import type { IndustryId } from "./industryProfiles";
import { INDUSTRY_ICONS, INDUSTRY_LABEL } from "./industryProfiles";

export const ALL_INDUSTRY_ID = "all" as const;

export type IndustryNavItem = {
  id: IndustryId;
  label: string;
  icon: string;
};

export type IndustryTreeNode = {
  id: string;
  label: string;
  children?: IndustryTreeNode[];
};

export const INDUSTRY_NAV: IndustryNavItem[] = TAXONOMY_INDUSTRIES.map((item) => {
  const id = item.id as IndustryId;
  return {
    id,
    label: INDUSTRY_LABEL[id] || item.label,
    icon: INDUSTRY_ICONS[id] || item.icon || "folder-3-line",
  };
});

function mapTaxonomyNode(item: TaxonomyIndustry): IndustryTreeNode {
  const children = item.children?.map((c) => mapTaxonomyNode(c as TaxonomyIndustry));
  return {
    id: item.id,
    label: item.label,
    ...(children?.length ? { children } : {}),
  };
}

/** 当前节点及全部子孙行业 id。 */
export function collectIndustryIds(node: IndustryTreeNode): string[] {
  const ids = [node.id];
  for (const c of node.children || []) ids.push(...collectIndustryIds(c));
  return ids;
}

export function findIndustryNode(
  nodes: IndustryTreeNode[],
  id: string,
): IndustryTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children?.length ? findIndustryNode(n.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

/** null = 不过滤（全部）。否则项目 industryId 落在该集合内即显示。 */
export function industryFilterIds(
  tree: IndustryTreeNode[],
  selectedId: string,
): Set<string> | null {
  if (!selectedId || selectedId === ALL_INDUSTRY_ID) return null;
  const node = findIndustryNode(tree, selectedId);
  if (!node) return new Set([selectedId]);
  return new Set(collectIndustryIds(node));
}

export function buildProjectIndustryTree(
  projectCounts: Map<string, number>,
  total: number,
): IndustryTreeNode[] {
  const children: IndustryTreeNode[] = TAXONOMY_INDUSTRIES.map((item) => {
    const mapped = mapTaxonomyNode(item);
    return labelWithCount(mapped, projectCounts);
  });
  const known = new Set(children.flatMap((c) => collectIndustryIds(c)));
  for (const [id, count] of projectCounts.entries()) {
    if (!id || id === ALL_INDUSTRY_ID || known.has(id) || count <= 0) continue;
    children.push({
      id,
      label: `${industryLabel(id) || INDUSTRY_LABEL[id as IndustryId] || id}（${count}）`,
    });
    known.add(id);
  }
  return [{ id: ALL_INDUSTRY_ID, label: `全部行业（${total}）`, children }];
}

function nodeCount(node: IndustryTreeNode, counts: Map<string, number>): number {
  let n = counts.get(node.id) || 0;
  for (const c of node.children || []) n += nodeCount(c, counts);
  return n;
}

function labelWithCount(node: IndustryTreeNode, counts: Map<string, number>): IndustryTreeNode {
  const children = node.children?.map((c) => labelWithCount(c, counts));
  const n = nodeCount({ ...node, children }, counts);
  const base = node.label.replace(/（\d+）$/, "");
  return { id: node.id, label: `${base}（${n}）`, ...(children?.length ? { children } : {}) };
}
