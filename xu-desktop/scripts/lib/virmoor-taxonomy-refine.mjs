import fs from "node:fs";

/**
 * @file virmoor-taxonomy-refine.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo Phase1–2 分类归位、catalogL5/positionId、财务分包、slug 语义化
 */
import {
  buildSemanticSlug,
  deriveNameZh,
  debrandBody,
  debrandDescription,
  debrandQuickPrompts,
  debrandTags,
  mergeQuickPrompts,
  parseFrontmatter,
} from "./virmoor-role-debrand.mjs";
import { slugifyToken } from "./role-taxonomy.mjs";

export const DUPLICATE_SLUGS_REMOVE = ["specialized-role-bpkqngkgiw"];

export const RESTORE_FROM_ZH_CN = [
  {
    path: "specialized/ex_VPckUgnh3ssy.md",
    nameZh: "亲子成长教育顾问",
    slug: "specialized-family-growth-counselor",
    division: "specialized",
  },
  {
    path: "engineering/ex_xxSPYMyM3yiQ.md",
    nameZh: "数据建模分析专家",
    slug: "engineering-data-modeling-analyst",
    division: "engineering",
  },
  {
    path: "finance/ex_xfzTmqhRRW3h.md",
    nameZh: "期权波动率分析顾问",
    slug: "finance-options-volatility-analyst",
    division: "finance",
  },
];

export const SLUG_RENAME_MAP = {
  "engineering-PPT-sd5r4a4h": "engineering-data-analytics-ppt-specialist",
  "finance-role-u7pwrcq98a": "finance-futures-basis-analyst",
  "specialized-role-khueqvhlw3": "security-ai-skill-security-reviewer",
  "specialized-role-pm4rdrble9": "specialized-youth-guard-family-educator",
};

export const NAME_ZH_FIXES = {
  "战略咨询岗咨询顾问": null,
  "数据分析专家": null,
};

export const THIRD_PARTY_NAME_PATTERNS = [
  { re: /东方财富妙想/i, nameZh: "智能选基研究顾问" },
  { re: /Wind-Alice/i, nameZh: "宏观经济分析顾问" },
  { re: /刺桐说Pro/i, nameZh: "财经热点解读顾问" },
  { re: /通达信/i, nameZh: "行情技术分析顾问" },
  { re: /万方数据/i, nameZh: "学术文献检索顾问" },
];

const NON_TECH_SPECIALIZED =
  /specialized-(PPT|SEO|TikTok|FBA|ToB|NGO|CBT|KET|FAQ|RFP|CRM|360|ASIN|Listing|SKU|WhatsApp|WANFANG|IRAC|RTB|WBS|Flova|GEO|VibeKnow|AI-CMO|8D-CAPA|SOP)/i;

const TECH_HAY =
  /React|Vue|Git|SQL|API|Docker|Kubernetes|Harmony|Solidity|TypeScript|Node\.?js|Python|Java|Rust|Next|MCP|AICoding|CLI|Dockerfile|Mermaid|Unity|Godot|Roblox|Jira|LSP|ArXiv|工程师|架构师|后端|前端|运维|DevOps|SRE|小程序|鸿蒙|微服务|中间件|Go语言|Spring|\.NET|云原生|K8s|算法与AI|数据智能|软件工程|测试质量|渗透|安全审查|技能审核/i;

const MARKET_FINANCE_HAY =
  /ETF|MACD|选股|涨停|港美股|A股|筹码|新股|期权|期货|波动率|基差|席位|期限结构|IV分位|DCF|均线|龙虎榜|北向资金/i;

const OLD_NICKNAMES =
  /知文文|小法同学|技美美|留洋洋|刘小排|钱守通|懂秘|马滢老师|鹏城信息AI专家|企鹅教师助手/g;

export function fixMarketRoleBody(bodyMd, nameZh) {
  let t = debrandBody(String(bodyMd || ""), nameZh);
  t = t.replace(
    /你是「[^」]+」，一名扎根中国市场的[^，,]+(?=，隶属)/g,
    `你是「${nameZh}」，一名扎根虚幕阁市场的专业从业者`,
  );
  t = t.replace(/一名扎根中国市场[^，]*(?:，[^，]*)*?，隶属/g, "一名扎根虚幕阁市场的专业从业者，隶属");
  t = t.replace(OLD_NICKNAMES, nameZh);
  t = t.replace(/贴合中国国情的[^级]+级交付/g, "贴合中国国情的专业级交付");
  t = t.replace(
    new RegExp(`在【[^】]+】场景下，为用户提供贴合中国国情的${nameZh}级交付`, "g"),
    "在对应场景下，为用户提供贴合中国国情的专业级交付",
  );
  return t;
}

export function fixThirdPartyNameZh(nameZh) {
  let n = String(nameZh || "").trim();
  for (const { re, nameZh: fixed } of THIRD_PARTY_NAME_PATTERNS) {
    if (re.test(n)) return fixed;
  }
  return n;
}

export function inferCatalogL5(meta, nameZh) {
  const old = String(meta.catalogL5 || "").trim();
  const hay = `${nameZh} ${meta.description || ""} ${(meta.tags || []).join(" ")} ${meta.catalogL3 || ""}`;

  if (meta.catalogL1 === "技术研发" || meta.roleAxis === "技术研发" || meta.division === "engineering") {
    if (/React|Next|Vue|前端|Harmony|小程序|移动|RN|Android|iOS|HarmonyOS/i.test(hay)) return "前端工程";
    if (/后端|API|微服务|中间件|Spring|Go语言|Java|Python|\.NET|Node/i.test(hay)) return "后端服务";
    if (/DevOps|SRE|运维|Docker|K8s|Kubernetes|云原生|CI\/CD/i.test(hay)) return "运维与平台";
    if (/测试|QA|质量/i.test(hay)) return "测试质量";
    if (/数据|PPT.*数据|BI|报表|建模|可视化/i.test(hay)) return "数据工程";
    if (/安全|审查|渗透|AppSec/i.test(hay)) return "安全工程";
    if (/AI|Agent|LLM|RAG|MCP|Prompt|算法/i.test(hay)) return "算法与AI应用";
    if (/游戏|Unity|Godot|Unreal|Roblox/i.test(hay)) return "游戏开发";
    if (old === "算法与AI" || old === "算法/数据/AI") return "算法与AI应用";
    return old || "软件工程";
  }

  if (meta.division === "finance" || meta.roleAxis === "财务税务" || meta.catalogL1 === "金融投资") {
    if (MARKET_FINANCE_HAY.test(hay) || old === "战略咨询岗") return "证券投研";
    if (nameZh.startsWith("财务 ·")) return "企业财务";
    return old === "投研/财务" ? "企业财务" : old || "企业财务";
  }

  if (/文化智能/i.test(hay)) return "战略咨询";
  if (meta.division === "strategy" || meta.roleAxis === "战略咨询") return old || "战略咨询";

  return old;
}

export function inferFinanceSegment(meta, nameZh) {
  const catalogL5 = meta.catalogL5 || inferCatalogL5(meta, nameZh);
  if (catalogL5 === "证券投研") return "证券投研";
  if (nameZh.startsWith("财务 ·")) return "企业财务";
  if (MARKET_FINANCE_HAY.test(`${nameZh} ${meta.description || ""}`)) return "证券投研";
  return "企业财务";
}

export function isTechRole(role) {
  const { slug, nameZh, meta, division } = role;
  if (division === "engineering" || division === "testing" || division === "security") return false;
  if (NON_TECH_SPECIALIZED.test(slug)) return false;
  if (meta.catalogL1 === "技术研发") return true;
  if (meta.roleAxis === "技术研发") return true;
  const hay = `${slug} ${nameZh} ${meta.catalogL5 || ""} ${meta.catalogL3 || ""} ${(meta.tags || []).join(" ")}`;
  if (/营销增长|市场营销岗/i.test(hay) && !/工程师|开发|API|Git|代码/i.test(hay)) return false;
  if (/行业顾问/i.test(meta.catalogL1 || "") && !TECH_HAY.test(hay)) return false;
  return TECH_HAY.test(hay);
}

export function refineDivision(role) {
  const { slug, meta } = role;
  if (DUPLICATE_SLUGS_REMOVE.includes(slug)) return null;
  if (slug === "specialized-role-khueqvhlw3" || slug === "security-ai-skill-security-reviewer") {
    return { ...role, division: "security", meta: { ...meta, catalogL2: "security" } };
  }
  if (slug.startsWith("marketing-")) {
    return relocateDivision(role, "marketing", "市场营销");
  }
  if (slug.startsWith("med-")) {
    return relocateDivision(role, "healthcare", "医疗健康");
  }
  if (role.division === "engineering" && slug.startsWith("specialized-") && NON_TECH_SPECIALIZED.test(slug)) {
    return relocateDivision(role, "specialized", "综合专业");
  }
  if (isTechRole(role)) {
    return {
      ...role,
      division: "engineering",
      meta: {
        ...meta,
        catalogL1: "技术研发",
        catalogL2: "engineering",
        roleAxis: "技术研发",
      },
    };
  }
  return role;
}

function relocateDivision(role, division, divisionZh) {
  return {
    ...role,
    division,
    meta: {
      ...role.meta,
      division,
      divisionZh,
      catalogL2: division,
    },
  };
}

export function refineNameZh(role) {
  const overrides = {
    "finance-role-u7pwrcq98a": "期货基差期限结构分析顾问",
    "finance-futures-basis-analyst": "期货基差期限结构分析顾问",
    "engineering-PPT-sd5r4a4h": "经营数据分析与汇报专家",
    "engineering-data-analytics-ppt-specialist": "经营数据分析与汇报专家",
    "specialized-role-pm4rdrble9": "未成年防沉迷家庭教育专家",
    "specialized-youth-guard-family-educator": "未成年防沉迷家庭教育专家",
    "specialized-role-khueqvhlw3": "AI技能安全审查专家",
    "security-ai-skill-security-reviewer": "AI技能安全审查专家",
    "product-manager": "产品 · 产品经理",
    "ma-integration-manager": "战略 · 并购整合经理",
    "blender-addon-engineer": "游戏 · Blender 插件工程师",
    "unity-architect": "游戏 · Unity 架构师",
    "specialized-Unity": "游戏 · Unity 架构师",
  };
  let nameZh = overrides[role.slug] || fixThirdPartyNameZh(role.nameZh);
  if (NAME_ZH_FIXES[nameZh] === null) {
    nameZh = deriveNameZh({ ...role.meta, nameZh: role.meta.description || nameZh, tags: role.meta.tags });
    nameZh = fixThirdPartyNameZh(nameZh);
  }
  return { ...role, nameZh };
}

export function refineSlug(role, slugInUse) {
  const mapped = SLUG_RENAME_MAP[role.slug];
  if (mapped && !slugInUse.has(mapped)) {
    slugInUse.add(mapped);
    return { ...role, slug: mapped };
  }
  let target = role.slug;
  const shouldSemantic =
    /^specialized-role-[a-z0-9]+$/.test(target) ||
    (role.division === "engineering" && target.startsWith("specialized-"));
  if (shouldSemantic) {
    const candidate = buildSemanticSlug(role.division, role.nameZh, role.meta, target);
    if (
      candidate &&
      candidate !== target &&
      (!/specialized-role-[a-z0-9]+$/.test(candidate) || candidate.length < target.length)
    ) {
      target = candidate;
    }
  }
  if (slugInUse.has(target) && target !== role.slug) {
    const tail = role.slug.replace(/^specialized-role-/, "").slice(0, 6);
    target = `${target}-${tail}`.slice(0, 64);
  }
  if (!slugInUse.has(target)) {
    slugInUse.add(target);
    return { ...role, slug: target };
  }
  slugInUse.add(role.slug);
  return role;
}

export function applyTaxonomyMeta(role) {
  const catalogL5 = inferCatalogL5(role.meta, role.nameZh);
  const financeSegment = role.division === "finance" ? inferFinanceSegment(role.meta, role.nameZh) : "";
  const tags = Array.isArray(role.meta.tags) ? [...role.meta.tags] : [];
  if (financeSegment && !tags.includes(financeSegment)) tags.unshift(financeSegment);
  const meta = {
    ...role.meta,
    nameZh: role.nameZh,
    roleTitle: role.nameZh,
    catalogL4: role.nameZh,
    catalogL5,
    catalogL3: role.meta.catalogL3 || catalogL5,
    tags,
    description: debrandDescription(role.meta.description || role.nameZh, role.nameZh),
  };
  if (role.division === "engineering") {
    meta.catalogL1 = "技术研发";
    meta.roleAxis = "技术研发";
    meta.catalogL2 = "engineering";
  }
  if (role.division === "security") {
    meta.catalogL1 = "安全风控";
    meta.roleAxis = "安全风控";
    meta.catalogL2 = "security";
    meta.catalogL5 = meta.catalogL5 || "安全工程";
  }
  if (role.division === "strategy" && /文化智能/.test(role.nameZh)) {
    meta.catalogL1 = "行业顾问";
    meta.roleAxis = "战略咨询";
    meta.catalogL5 = "战略咨询";
  }
  return { ...role, meta };
}

export function restoreRoleFromZhCn(srcRoot, relPath, override) {
  const file = `${srcRoot}/${relPath}`.replace(/\\/g, "/");
  const raw = fs.readFileSync(file, "utf8");
  const { meta, bodyMd } = parseFrontmatter(raw);
  const nameZh = override.nameZh || deriveNameZh(meta);
  const tags = debrandTags(meta.tags, nameZh);
  const description = debrandDescription(meta.description || "", nameZh);
  const division = override.division || meta.division;
  const slug = override.slug || buildSemanticSlug(division, nameZh, { ...meta, tags, description }, meta.slug);
  const quickPrompts = debrandQuickPrompts(meta.quickPrompts, nameZh);
  const body = fixMarketRoleBody(bodyMd, nameZh);
  return {
    slug,
    division,
    nameZh,
    meta: { ...meta, tags, description },
    quickPrompts,
    bodyMd: body,
    restoredFrom: relPath,
  };
}

export function mergePromptsIntoTarget(roles, targetSlug, sourceSlug) {
  const target = roles.find((r) => r.slug === targetSlug);
  const source = roles.find((r) => r.slug === sourceSlug);
  if (!target || !source) return roles;
  target.quickPrompts = mergeQuickPrompts(target.quickPrompts, source.quickPrompts);
  return roles.filter((r) => r.slug !== sourceSlug);
}
