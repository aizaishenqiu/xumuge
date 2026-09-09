/**
 * Shared industry × position taxonomy inference for role-packs-src frontmatter.
 * Aligns with docs/plans/岗位双维分类规划.md and docs/config/taxonomy-*.json
 */

export const CATALOG_L1_TO_INDUSTRY = {
  技术研发: "software",
  产品与设计: "product",
  内容创意: "marketing",
  营销增长: "marketing",
  销售商务: "marketing",
  金融投资: "finance",
  运营与HR: "operations",
  行业顾问: "consulting",
  游戏空间: "software",
  医疗健康: "healthcare",
  教育: "education",
  政务公共: "general",
  法务合规: "general",
  安全风控: "software",
  制造供应链: "general",
  全球发展: "consulting",
};

export const DIVISION_TO_INDUSTRY = {
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
  tourism: "general",
  "supply-chain": "general",
  gis: "software",
  "game-development": "software",
};

export const INDUSTRY_ZH = {
  software: "软件研发",
  design: "创意设计",
  product: "产品",
  marketing: "市场运营",
  finance: "金融数据",
  education: "教育",
  healthcare: "医疗健康",
  consulting: "咨询",
  operations: "内部运营",
  general: "通用办公",
  management: "项目管理",
};

export const ROLE_AXIS_TO_CATEGORY = {
  经营管理: { cat: "management", catZh: "项目管理" },
  产品: { cat: "product", catZh: "产品" },
  技术研发: { cat: "engineering", catZh: "研发工程" },
  设计: { cat: "design", catZh: "设计" },
  内容创作: { cat: "marketing", catZh: "市场" },
  市场营销: { cat: "marketing", catZh: "市场" },
  销售商务: { cat: "marketing", catZh: "市场" },
  客户运营: { cat: "support", catZh: "支持服务" },
  人力资源: { cat: "support", catZh: "支持服务" },
  财务税务: { cat: "finance", catZh: "财务" },
  法务合规: { cat: "support", catZh: "支持服务" },
  医疗健康: { cat: "support", catZh: "支持服务" },
  教育培训: { cat: "education", catZh: "支持服务" },
  战略咨询: { cat: "consulting", catZh: "支持服务" },
  安全风控: { cat: "engineering", catZh: "研发工程" },
  供应链制造: { cat: "engineering", catZh: "研发工程" },
  游戏空间: { cat: "design", catZh: "设计" },
  政务公共: { cat: "general", catZh: "支持服务" },
};

export const SLUG_RULES = [
  { test: /product-manager|product-owner|pm\b/i, cat: "product", pid: "product-manager", pzh: "产品经理" },
  { test: /frontend|front-end/i, cat: "engineering", pid: "frontend-engineer", pzh: "前端工程师" },
  { test: /backend|back-end|api-engineer/i, cat: "engineering", pid: "backend-engineer", pzh: "后端工程师" },
  { test: /fullstack|full-stack/i, cat: "engineering", pid: "fullstack-engineer", pzh: "全栈工程师" },
  { test: /architect/i, cat: "engineering", pid: "architect", pzh: "架构师" },
  { test: /devops|sre/i, cat: "engineering", pid: "devops-engineer", pzh: "运维工程师" },
  { test: /qa|quality|test-engineer|testing-/i, cat: "qa", pid: "qa-engineer", pzh: "测试工程师" },
  { test: /ui-design|ux|brand|designer|design-/i, cat: "design", pid: "ui-designer", pzh: "UI 设计师" },
  { test: /project-manager|project-shepherd/i, cat: "management", pid: "project-manager", pzh: "项目经理" },
  { test: /accountant|finance/i, cat: "finance", pid: "cost-accountant", pzh: "成本会计" },
  { test: /marketing|growth/i, cat: "marketing", pid: "marketing-manager", pzh: "市场经理" },
  { test: /meeting|scribe|secretary/i, cat: "support", pid: "meeting-scribe", pzh: "会议书记员" },
];

export const CAT_ZH = {
  product: "产品",
  engineering: "研发工程",
  design: "设计",
  qa: "测试质量",
  management: "项目管理",
  finance: "财务",
  marketing: "市场",
  support: "支持服务",
  consulting: "咨询",
  education: "教育",
  general: "支持服务",
};

export function slugifyToken(s) {
  return String(s ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function inferIndustry(meta, division) {
  const catalogL1 = meta.catalogL1 || "";
  const industryId =
    CATALOG_L1_TO_INDUSTRY[catalogL1] || DIVISION_TO_INDUSTRY[division] || division || "general";
  const industryZh = INDUSTRY_ZH[industryId] || catalogL1 || meta.divisionZh || "通用办公";
  return { industryId, industryZh };
}

export function inferPositionCategory(roleAxis, division) {
  const axisInfo = ROLE_AXIS_TO_CATEGORY[roleAxis];
  if (axisInfo) return axisInfo;
  const divCat = {
    engineering: { cat: "engineering", catZh: CAT_ZH.engineering },
    design: { cat: "design", catZh: CAT_ZH.design },
    product: { cat: "product", catZh: CAT_ZH.product },
    testing: { cat: "qa", catZh: CAT_ZH.qa },
    finance: { cat: "finance", catZh: CAT_ZH.finance },
    marketing: { cat: "marketing", catZh: CAT_ZH.marketing },
    sales: { cat: "marketing", catZh: CAT_ZH.marketing },
    strategy: { cat: "consulting", catZh: CAT_ZH.consulting },
    education: { cat: "education", catZh: CAT_ZH.education },
    healthcare: { cat: "support", catZh: CAT_ZH.support },
  };
  return divCat[division] || { cat: "engineering", catZh: CAT_ZH.engineering };
}

/**
 * positionId: registry match → stable slug (ex_* / kebab) — never truncate CJK title to "AI".
 */
export function inferPosition(meta, slug) {
  const nameZh = meta.roleTitle || meta.nameZh || slug;
  const hay = `${slug} ${nameZh} ${meta.catalogL3 || ""} ${meta.catalogL4 || ""}`;

  for (const r of SLUG_RULES) {
    if (r.test.test(hay)) {
      return {
        positionId: r.pid,
        positionZh: nameZh,
        positionCategory: r.cat,
        positionCategoryZh: CAT_ZH[r.cat] || r.cat,
      };
    }
  }

  const catInfo = inferPositionCategory(meta.roleAxis || "", meta.division || "");
  const positionId = slug.startsWith("ex_") ? slug : slug.slice(0, 48) || "general-role";

  return {
    positionId,
    positionZh: nameZh,
    positionCategory: catInfo.cat,
    positionCategoryZh: catInfo.catZh,
  };
}

const WEAK_SUBCATEGORY = new Set(["ai", "it", "hr", "qa", "pm", "ui", "ux"]);

export function inferPositionSubCategory(meta) {
  const raw = meta.catalogL5 || meta.catalogL3 || "";
  if (!raw) return "";
  const sub = slugifyToken(String(raw).replace(/[/、]/g, "-"));
  if (!sub || sub.length < 4 || WEAK_SUBCATEGORY.has(sub.toLowerCase())) return "";
  return sub;
}

export function inferTaxonomyFields(meta, slug, division) {
  const { industryId, industryZh } = inferIndustry(meta, division);
  const pos = inferPosition({ ...meta, division }, slug);
  const positionSubCategory = inferPositionSubCategory(meta);
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  return {
    industryId,
    industryZh,
    industryTags: tags,
    positionId: pos.positionId,
    positionZh: pos.positionZh,
    positionCategory: pos.positionCategory,
    positionCategoryZh: pos.positionCategoryZh,
    positionSubCategory,
  };
}
