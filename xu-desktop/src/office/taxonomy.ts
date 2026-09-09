/**
 * @file taxonomy.ts — Industry × position taxonomy registry (docs/config/*.json).
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-01
 * @version 1.0.0
 * @category Config
 * @algo taxonomy-lookup
 */
import industriesJson from "../../docs/config/taxonomy-industries.json";
import positionsJson from "../../docs/config/taxonomy-positions.json";

export type TaxonomyIndustry = {
  id: string;
  label: string;
  icon?: string;
  children?: Array<{ id: string; label: string }>;
};

export type TaxonomyPosition = { id: string; label: string };

export type TaxonomyPositionCategory = {
  id: string;
  label: string;
  icon?: string;
  positions: TaxonomyPosition[];
};

export const TAXONOMY_INDUSTRIES: TaxonomyIndustry[] = industriesJson.items;
export const TAXONOMY_POSITION_CATEGORIES: TaxonomyPositionCategory[] = positionsJson.categories;

/**
 * Chinese labels for division / industry folder ids.
 * Pack frontmatter often sets divisionZh = English id; UI must not show the slug.
 */
export const DIVISION_LABEL_ZH: Record<string, string> = {
  engineering: "研发工程",
  "software-company": "软件公司",
  design: "设计",
  product: "产品",
  "project-management": "项目管理",
  testing: "测试",
  security: "安全",
  marketing: "市场",
  sales: "销售",
  finance: "金融投资",
  support: "支持服务",
  strategy: "战略",
  specialized: "内容创作",
  academic: "学术研究",
  "game-development": "游戏开发",
  gis: "地理信息",
  healthcare: "医疗健康",
  "paid-media": "付费投放",
  "spatial-computing": "空间计算",
  education: "教育",
  consulting: "咨询",
  operations: "内部运营",
  general: "通用办公",
  tourism: "文旅旅游",
  "party-union": "党群工会",
  retail: "零售电商",
  hr: "人力资源",
  "supply-chain": "供应链",
  manufacturing: "制造",
  "real-estate": "房地产",
  procurement: "采购",
  media: "媒体内容",
  nonprofit: "公益慈善",
  nutrition: "营养膳食",
  admin: "行政办公",
  agriculture: "农业农村",
  energy: "能源电力",
  ip: "知识产权",
  legal: "法务合规",
  "board-office": "董事会办公室",
  "financial-services": "金融服务",
  "risk-control": "风控",
  "data-analytics": "数据分析",
  "data-labeling": "数据标注",
  software: "软件研发",
  management: "项目管理",
  qa: "测试质量",
};

/** True when label is missing or just an English kebab/snake id. */
export function isAsciiTaxonomySlug(label: string): boolean {
  const t = label.trim();
  if (!t) return true;
  return /^[a-z0-9][a-z0-9_-]*$/i.test(t);
}

/**
 * Duty: Chinese display name for a division/industry id.
 * Prefers non-ASCII zh from pack; else DIVISION_LABEL_ZH; else id.
 */
export function resolveDivisionDisplayName(divisionId: string, divisionZh?: string | null): string {
  const id = (divisionId || "").trim();
  const zh = (divisionZh || "").trim();
  if (zh && !isAsciiTaxonomySlug(zh)) return zh;
  if (id && DIVISION_LABEL_ZH[id]) return DIVISION_LABEL_ZH[id];
  if (zh) return zh;
  return id || "未分类";
}

const DIVISION_TO_INDUSTRY: Record<string, string> = {
  engineering: "software",
  "software-company": "software",
  design: "design",
  product: "product",
  "project-management": "management",
  testing: "software",
  security: "software",
  marketing: "marketing",
  sales: "marketing",
  finance: "finance",
  support: "general",
  strategy: "consulting",
  specialized: "general",
  academic: "education",
  healthcare: "healthcare",
  education: "education",
};

const SLUG_POSITION_RULES: Array<{ test: RegExp; category: string; positionId: string; positionZh: string }> = [
  { test: /product-manager|product-owner|pm\b/i, category: "product", positionId: "product-manager", positionZh: "产品经理" },
  { test: /frontend|front-end|fe-engineer/i, category: "engineering", positionId: "frontend-engineer", positionZh: "前端工程师" },
  { test: /backend|back-end|api-engineer/i, category: "engineering", positionId: "backend-engineer", positionZh: "后端工程师" },
  { test: /fullstack|full-stack/i, category: "engineering", positionId: "fullstack-engineer", positionZh: "全栈工程师" },
  { test: /architect/i, category: "engineering", positionId: "architect", positionZh: "架构师" },
  { test: /devops|sre/i, category: "engineering", positionId: "devops-engineer", positionZh: "运维工程师" },
  { test: /qa|quality|test-engineer/i, category: "qa", positionId: "qa-engineer", positionZh: "测试工程师" },
  { test: /ui-design|ux|brand-guardian|designer/i, category: "design", positionId: "ui-designer", positionZh: "UI 设计师" },
  { test: /project-manager|project-shepherd/i, category: "management", positionId: "project-manager", positionZh: "项目经理" },
  { test: /accountant|finance/i, category: "finance", positionId: "cost-accountant", positionZh: "成本会计" },
  { test: /marketing|growth/i, category: "marketing", positionId: "marketing-manager", positionZh: "市场经理" },
  { test: /meeting|scribe|secretary/i, category: "support", positionId: "meeting-scribe", positionZh: "会议书记员" },
];

export function industryLabel(id: string): string {
  return (
    TAXONOMY_INDUSTRIES.find((i) => i.id === id)?.label ||
    DIVISION_LABEL_ZH[id] ||
    id
  );
}

export function positionCategoryLabel(id: string): string {
  return (
    TAXONOMY_POSITION_CATEGORIES.find((c) => c.id === id)?.label ||
    DIVISION_LABEL_ZH[id] ||
    id
  );
}

export function positionLabel(categoryId: string, positionId: string): string {
  const cat = TAXONOMY_POSITION_CATEGORIES.find((c) => c.id === categoryId);
  return cat?.positions.find((p) => p.id === positionId)?.label || positionId;
}

export function inferIndustryFromDivision(division: string, divisionZh?: string): {
  industryId: string;
  industryZh: string;
} {
  const industryId = DIVISION_TO_INDUSTRY[division] || division || "general";
  const industryZh = resolveDivisionDisplayName(
    industryId,
    TAXONOMY_INDUSTRIES.find((i) => i.id === industryId)?.label || divisionZh,
  );
  return { industryId, industryZh };
}

export function inferPositionFromSlug(slug: string, nameZh: string): {
  positionId: string;
  positionZh: string;
  positionCategory: string;
  positionCategoryZh: string;
} {
  const hay = `${slug} ${nameZh}`;
  for (const rule of SLUG_POSITION_RULES) {
    if (rule.test.test(hay)) {
      return {
        positionId: rule.positionId,
        positionZh: rule.positionZh,
        positionCategory: rule.category,
        positionCategoryZh: positionCategoryLabel(rule.category),
      };
    }
  }
  const positionId = slug.replace(/[^a-z0-9-]+/gi, "-").slice(0, 48) || "general-role";
  return {
    positionId,
    positionZh: nameZh || positionId,
    positionCategory: "engineering",
    positionCategoryZh: positionCategoryLabel("engineering"),
  };
}

export type RoleTaxonomyFields = {
  industryId: string;
  industryZh: string;
  positionId: string;
  positionZh: string;
  positionCategory: string;
  positionCategoryZh: string;
};

export function resolveRoleTaxonomy(input: {
  division: string;
  divisionZh?: string;
  slug?: string;
  nameZh: string;
  industryId?: string;
  industryZh?: string;
  positionId?: string;
  positionZh?: string;
  positionCategory?: string;
  positionCategoryZh?: string;
}): RoleTaxonomyFields {
  const inferredIndustry = inferIndustryFromDivision(input.division, input.divisionZh);
  const inferredPosition = inferPositionFromSlug(input.slug || input.nameZh, input.nameZh);
  const industryId = input.industryId?.trim() || inferredIndustry.industryId;
  const positionCategory = input.positionCategory?.trim() || inferredPosition.positionCategory;
  return {
    industryId,
    industryZh: resolveDivisionDisplayName(
      industryId,
      input.industryZh?.trim() || inferredIndustry.industryZh,
    ),
    positionId: input.positionId?.trim() || inferredPosition.positionId,
    positionZh: input.positionZh?.trim() || inferredPosition.positionZh,
    positionCategory,
    positionCategoryZh: resolveDivisionDisplayName(
      positionCategory,
      input.positionCategoryZh?.trim() || inferredPosition.positionCategoryZh,
    ),
  };
}
