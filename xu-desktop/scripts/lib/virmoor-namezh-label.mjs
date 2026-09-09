/**
 * @file virmoor-namezh-label.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.1.0
 * @category role-pack
 * @algo 岗位 nameZh 统一「行业/部门 · 岗位名」前缀；保留业务前缀不被专项覆盖
 */
import { inferIndustry } from "./role-taxonomy.mjs";
import {
  BUSINESS_PREFIXES,
  NAMEZH_SEP,
  WEAK_PREFIXES,
  inferBusinessPrefix,
  splitDisplayNameZh,
} from "./virmoor-business-prefix.mjs";

export { NAMEZH_SEP, splitDisplayNameZh };

/** division 文件夹 → 列表展示用短标签（与已有人工标注对齐） */
export const DIVISION_DISPLAY_LABEL = {
  academic: "学术",
  admin: "行政",
  agriculture: "农业",
  "board-office": "董办",
  consulting: "咨询",
  "data-analytics": "数据分析",
  "data-labeling": "数据标注",
  design: "设计",
  education: "教育",
  energy: "能源",
  engineering: "软件研发",
  finance: "财务",
  "financial-services": "金融服务",
  "game-development": "游戏",
  gis: "地理信息",
  healthcare: "医疗",
  hr: "人力资源",
  ip: "知识产权",
  legal: "法务",
  manufacturing: "制造",
  marketing: "市场营销",
  media: "传媒",
  nonprofit: "公益",
  nutrition: "营养",
  operations: "运营",
  "paid-media": "付费媒体",
  "party-union": "党务工会",
  procurement: "采购",
  product: "产品",
  "project-management": "项目管理",
  "real-estate": "房地产",
  retail: "零售",
  "risk-control": "风控内审",
  sales: "销售",
  security: "安全",
  "spatial-computing": "空间计算",
  specialized: "专项",
  strategy: "战略",
  "supply-chain": "供应链",
  support: "支持",
  testing: "测试",
  tourism: "文旅",
};

/** industryZh 长称 → 列表短标签 */
const INDUSTRY_ZH_SHORT = {
  医疗健康: "医疗",
  市场运营: "市场营销",
  金融数据: "金融",
  内部运营: "运营",
  通用办公: "通用",
  项目管理: "项目管理",
  软件研发: "软件研发",
  创意设计: "设计",
};

/** 已有前缀与目标标签等价（避免反复改写） */
const LABEL_ALIASES = {
  医疗: ["医疗", "医疗健康"],
  市场营销: ["市场营销", "市场", "营销", "品牌营销", "付费广告"],
  财务: ["财务", "金融", "金融数据", "财务税务"],
  支持: ["支持", "客户支持", "通用"],
  安全: ["安全", "安全合规"],
  软件研发: ["软件研发", "研发", "技术"],
  专项: ["专项", "专业", "通用办公", "综合业务"],
  法务: ["法务", "法务合规"],
  教育: ["教育", "教育培训"],
  人力资源: ["人力资源"],
  销售: ["销售", "销售增长", "客户成功"],
  文旅: ["文旅", "餐饮文旅"],
  能源: ["能源", "能源双碳"],
};

/** slug / 文件名优先于 division（跨目录行业岗） */
const SLUG_PREFIX_LABEL = [
  { test: /^(med-|healthcare-)/i, label: "医疗" },
  { test: /^(edu-|education-)/i, label: "教育" },
  { test: /^(ec-|retail-)/i, label: "零售" },
  { test: /^re-/i, label: "房地产" },
  { test: /^fs-/i, label: "金融服务" },
];

const SLUG_EXACT_LABEL = {
  "healthcare-marketing-compliance": "医疗",
  "product-manager": "产品",
  "legal-document-review": "法务合规",
  "sales-bid-proposal-writer": "招投标",
};

function shortenIndustryZh(industryZh) {
  const zh = String(industryZh || "").trim();
  return INDUSTRY_ZH_SHORT[zh] || zh;
}

function labelsEquivalent(existing, target) {
  if (existing === target) return true;
  const aliases = LABEL_ALIASES[target];
  if (aliases && aliases.includes(existing)) return true;
  const rev = LABEL_ALIASES[existing];
  if (rev && rev.includes(target)) return true;
  return false;
}

export function inferDisplayIndustryLabel(role) {
  const { slug, division, meta } = role;
  if (SLUG_EXACT_LABEL[slug]) return SLUG_EXACT_LABEL[slug];

  for (const { test, label } of SLUG_PREFIX_LABEL) {
    if (test.test(slug)) return label;
  }

  const business = inferBusinessPrefix({
    nameZh: role.nameZh,
    meta: meta || {},
    body: role.bodyMd || role.body || "",
  });
  if (business) return business;

  const fromDivision = DIVISION_DISPLAY_LABEL[division];
  if (fromDivision && fromDivision !== "专项") return fromDivision;

  const metaZh = shortenIndustryZh(meta?.industryZh);
  if (metaZh && metaZh !== "通用") return metaZh;

  const inferred = inferIndustry(meta || {}, division);
  const short = shortenIndustryZh(inferred.industryZh);
  if (short && short !== "通用" && short !== "专项") return short;
  return "综合业务";
}

export function stripDisplayPrefix(nameZh) {
  const n = String(nameZh || "").trim();
  const i = n.indexOf(NAMEZH_SEP);
  if (i >= 0) return n.slice(i + NAMEZH_SEP.length).trim();
  return n;
}

/**
 * 确保 nameZh 为「行业/部门 · 岗位名」；已有业务前缀不被 division「专项」覆盖。
 */
export function ensureIndustryLabelNameZh(role) {
  let nameZh = String(role.nameZh || "").trim();
  if (!nameZh) return role;

  const { prefix, title } = splitDisplayNameZh(nameZh);

  // 已有非弱前缀（含业务前缀）：保留，不因 division=specialized 改回专项
  if (prefix && !WEAK_PREFIXES.has(prefix)) {
    if (BUSINESS_PREFIXES.has(prefix) || prefix.length >= 2) {
      return role;
    }
  }

  const label = inferDisplayIndustryLabel(role);
  if (!label) return role;

  if (prefix && title) {
    if (labelsEquivalent(prefix, label)) {
      if (prefix === label) return role;
      return { ...role, nameZh: `${label}${NAMEZH_SEP}${title}` };
    }
    return { ...role, nameZh: `${label}${NAMEZH_SEP}${title}` };
  }

  if (nameZh.startsWith(label)) {
    const remainder = nameZh.slice(label.length).trim();
    const titlePart = remainder || nameZh;
    return { ...role, nameZh: `${label}${NAMEZH_SEP}${titlePart}` };
  }
  return { ...role, nameZh: `${label}${NAMEZH_SEP}${nameZh}` };
}
