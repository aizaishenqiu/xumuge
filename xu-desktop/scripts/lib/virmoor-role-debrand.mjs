/**
 * @file virmoor-role-debrand.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category role-pack
 * @algo 规则推导岗位名/slug + 正文去 WorkBuddy/腾讯货架品牌化
 */
import fs from "node:fs";
import path from "node:path";
import { slugifyToken, inferTaxonomyFields } from "./role-taxonomy.mjs";

export const UMBRELLA_NAMES = new Set([
  "鹏城信息AI专家",
  "企鹅教师助手",
  "鹏城信息",
]);

export const BRAND_KEYWORDS =
  /WorkBuddy|workbuddy|GoodBuddy|workbuddyopen|企鹅教师助手|鹏城信息AI专家|腾讯成长守护|腾讯技术公益|腾讯未保营地|MOSS增长谋士|Cordys\s*CRM|Rightly|牛卡福万金油/i;

export const THIRD_PARTY_PRODUCT =
  /Cordys\s*CRM|Rightly\s*合规|通达信[：:]|万方数据|牛卡福/i;

export const REAL_PERSON_PATTERN =
  /^(北京大学|清华大学|复旦大学|浙江大学)?[^，,]{2,8}(教授|副教授|博士|老师|院士)|^(莫博士|齐亮|司玉琦|花叔|左木莲安|陈丰伟|马滢)/;

export const QUIRKY_SUFFIX = /(推推|铺得精|剪神神|合规规|分支通|营销通|三表通|实验通|索引引|传声声|验真真|老铁铁|旱宝|空间界|多元元|医合合|单有潜|衣塑真|排错匠|视频匠|推文文)$/;

const ROLE_AXIS_SUFFIX = {
  经营管理: "总监",
  产品: "产品经理",
  技术研发: "工程师",
  设计: "设计师",
  内容创作: "创作顾问",
  市场营销: "营销顾问",
  销售商务: "销售顾问",
  客户运营: "运营专员",
  人力资源: "HR 顾问",
  财务税务: "财务顾问",
  法务合规: "合规顾问",
  医疗健康: "医疗顾问",
  教育培训: "教育顾问",
  战略咨询: "咨询顾问",
  安全风控: "安全顾问",
  供应链制造: "供应链顾问",
  游戏空间: "游戏顾问",
  政务公共: "政务顾问",
};

const ENGINE_TO_ROLE = {
  引擎: "工程师",
  专家团: "专家组",
  指导员: "顾问",
};

export function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("missing frontmatter");
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === "true") meta[key] = true;
    else if (val === "false") meta[key] = false;
    else if (val.startsWith("[") && val.endsWith("]")) {
      meta[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    } else if (val.startsWith('"') && val.endsWith('"')) {
      meta[key] = val.slice(1, -1).replace(/\\"/g, '"');
    } else meta[key] = val;
  }
  return { meta, bodyMd: m[2].trim() };
}

export function yamlQuote(s) {
  const v = String(s ?? "");
  if (!v) return '""';
  if (/[:#\n\r"'\\[\]{}]/.test(v) || v.startsWith(" ") || v.endsWith(" ")) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `"${v}"`;
}

function cleanDescriptionText(desc) {
  let t = String(desc || "").trim();
  t = t
    .replace(/Buddy\s*应用配置/g, "应用市场配置")
    .replace(/GoodBuddy/gi, "")
    .replace(/\bBuddy\b/gi, "桌面端")
    .replace(BRAND_KEYWORDS, "")
    .trim();
  for (const umb of UMBRELLA_NAMES) {
    t = t.replace(new RegExp(umb, "g"), "").trim();
  }
  const parts = t.split(/[-—–|]/).map((p) => p.trim()).filter(Boolean);
  const filtered = parts.filter((p) => !UMBRELLA_NAMES.has(p) && p.length >= 2);
  if (filtered.length) return filtered[0];
  return t.replace(/[-—–|]/g, "").trim();
}

function normalizeProfessionTitle(text) {
  let t = String(text || "").trim();
  if (!t) return "";
  for (const [from, to] of Object.entries(ENGINE_TO_ROLE)) {
    if (t.endsWith(from) && t.length > from.length) {
      const base = t.slice(0, -from.length);
      if (base.length >= 2) t = base + to;
    }
  }
  if (/顾问$|工程师$|专员$|经理$|总监$|分析师$|设计师$|教练$|规划师$/.test(t)) return t;
  if (t.length >= 4 && !QUIRKY_SUFFIX.test(t)) return t;
  return "";
}

export function isQuirkyName(nameZh) {
  const n = String(nameZh || "").trim();
  if (!n) return true;
  if (UMBRELLA_NAMES.has(n)) return true;
  if (BRAND_KEYWORDS.test(n)) return true;
  if (/\bBuddy\b/i.test(n)) return true;
  if (/GoodBuddy/i.test(n)) return true;
  if (QUIRKY_SUFFIX.test(n)) return true;
  if (REAL_PERSON_PATTERN.test(n)) return true;
  if (THIRD_PARTY_PRODUCT.test(n)) return true;
  if (n.length <= 3) return true;
  if (/(.)\1{1,2}$/.test(n) && n.length <= 6) return true;
  return false;
}

export function isProfessionalName(nameZh) {
  const n = String(nameZh || "").trim();
  if (!n || isQuirkyName(n)) return false;
  return /经理|工程师|专员|顾问|总监|分析师|设计师|教练|规划师|专家|师$|官$|员$/.test(n);
}

export function deriveNameZh(meta) {
  const current = String(meta.nameZh || meta.roleTitle || "").trim();
  const descClean = cleanDescriptionText(meta.description || meta.profession || "");
  const fromDesc = normalizeProfessionTitle(descClean);

  if (fromDesc && !isQuirkyName(fromDesc)) return fromDesc;

  if (isProfessionalName(current)) return current;

  const catalogL5 = String(meta.catalogL5 || meta.catalogL3 || "").trim();
  const axis = String(meta.roleAxis || "").trim();
  const axisSuffix = ROLE_AXIS_SUFFIX[axis] || "顾问";
  if (catalogL5 && catalogL5.length >= 4 && !/^(AI|IT|HR|QA|PM)$/i.test(catalogL5)) {
    const base = catalogL5.replace(/[/、]/g, "").slice(0, 12);
    const candidate = `${base}${axisSuffix.includes(base) ? "" : axisSuffix}`;
    if (candidate.length >= 4 && !isQuirkyName(candidate)) return candidate;
  }

  const tags = Array.isArray(meta.tags) ? meta.tags.filter(Boolean) : [];
  if (tags.length) {
    const tagBase = tags[0].slice(0, 10);
    const candidate = `${tagBase}${axisSuffix}`;
    if (candidate.length >= 4 && !isQuirkyName(candidate)) return candidate;
  }

  if (fromDesc) return fromDesc;
  if (descClean.length >= 4) return descClean;
  return current || "专业顾问";
}

export function buildSemanticSlug(division, nameZh, meta, oldSlug) {
  const old = String(oldSlug || "").trim();
  if (old && !old.startsWith("ex_") && /^[a-z0-9]+(-[a-z0-9]+)*$/i.test(old)) {
    return old.slice(0, 64);
  }

  const candidates = [
    slugifyToken(cleanDescriptionText(meta.description)),
    slugifyToken(meta.catalogL5),
    slugifyToken(nameZh),
    ...((meta.tags || []).map((t) => slugifyToken(t))),
  ].filter((s) => s && s.length >= 3);

  let base = candidates[0] || "";
  if (!base || base.length < 3) {
    const tail = old.replace(/^ex_/i, "").slice(0, 10).toLowerCase();
    base = `role-${tail}`;
  }
  base = base.slice(0, 48).replace(/-+$/g, "");
  return `${division}-${base}`.slice(0, 64);
}

export function auditIssues(meta, slug, bodyMd) {
  const issues = [];
  const nameZh = meta.nameZh || "";
  if (String(slug).startsWith("ex_")) issues.push("ex_slug");
  if (UMBRELLA_NAMES.has(nameZh)) issues.push("umbrella_name");
  if (isQuirkyName(nameZh)) issues.push("quirky_name");
  if (BRAND_KEYWORDS.test(nameZh) || BRAND_KEYWORDS.test(bodyMd || "")) issues.push("brand_keyword");
  if (REAL_PERSON_PATTERN.test(nameZh)) issues.push("real_person");
  if (THIRD_PARTY_PRODUCT.test(nameZh)) issues.push("third_party_product");
  if (meta.originSource === "market") issues.push("market_origin");
  if (meta.marketId) issues.push("market_id");
  return issues;
}

const BODY_OLD_NICKNAMES =
  /知文文|小法同学|技美美|留洋洋|刘小排|钱守通|懂秘|马滢老师|鹏城信息AI专家|企鹅教师助手/g;

export function debrandBody(bodyMd, nameZh) {
  let t = String(bodyMd || "");
  const reps = [
    [/workbuddyopen/gi, "虚幕阁开放平台"],
    [/GoodBuddy/gi, "协作助手"],
    [/Buddy\s*应用配置/g, "应用市场配置"],
    [/Buddy\s*配置/g, "应用配置"],
    [/WorkBuddy\s*个人版/gi, "虚幕阁桌面端"],
    [/WorkBuddy/gi, "虚幕阁 Fou 桌面端"],
    [/workbuddy/gi, "虚幕阁"],
    [/企鹅教师助手/g, nameZh],
    [/鹏城信息AI专家/g, nameZh],
    [/腾讯成长守护/g, "未成年人成长守护"],
    [/腾讯健康系统小程序/g, "主流防沉迷平台"],
    [/腾讯技术公益/g, "技术公益"],
    [/腾讯未保营地/g, "未成年人保护教育"],
    [/MOSS增长谋士/g, "增长策略顾问"],
    [/Cordys\s*CRM\s*助手/gi, "CRM 实施顾问"],
    [/Cordys\s*CRM/gi, "主流 CRM"],
    [/Rightly\s*合规辅助专业版/gi, "合规辅助顾问"],
    [/优先复用 zh-kimi 同域角色/g, "优先复用虚幕阁同域角色"],
    [/关注同域 zh-kimi 角色库/g, "关注同域虚幕阁角色库"],
    [/zh-kimi 模板/g, "虚幕阁岗位模板"],
    [/虚幕阁 Fou 桌面端open/gi, "虚幕阁开放平台"],
  ];
  for (const [re, rep] of reps) t = t.replace(re, rep);
  t = t.replace(new RegExp(`以「[^」]+」的专业身份`, "g"), `以「${nameZh}」的专业身份`);
  t = t.replace(new RegExp(`你是「[^」]+」`, "g"), `你是「${nameZh}」`);
  t = t.replace(
    /你是「[^」]+」，一名扎根中国市场的[^，,]+(?=，隶属)/g,
    `你是「${nameZh}」，一名扎根虚幕阁市场的专业从业者`,
  );
  t = t.replace(/一名扎根中国市场[^，]*(?:，[^，]*)*?，隶属/g, "一名扎根虚幕阁市场的专业从业者，隶属");
  t = t.replace(BODY_OLD_NICKNAMES, nameZh);
  t = t.replace(/贴合中国国情的[^级]+级交付/g, "贴合中国国情的专业级交付");
  return t;
}

export function mergeQuickPrompts(a, b) {
  const out = [];
  const seen = new Set();
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      const k = String(p).trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out.slice(0, 8);
}

export function debrandTags(tags, nameZh) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) =>
      debrandBody(String(t), nameZh)
        .replace(/workbuddyopen/gi, "开放平台")
        .replace(/Buddy\s*配置/gi, "应用配置")
        .replace(/\bBuddy\b/gi, "桌面端")
        .replace(/GoodBuddy/gi, ""),
    )
    .filter(Boolean);
}

export function debrandDescription(desc, nameZh) {
  return cleanDescriptionText(debrandBody(String(desc || ""), nameZh));
}

export function debrandQuickPrompts(prompts, nameZh) {
  if (!Array.isArray(prompts)) return [];
  return prompts.map((p) =>
    debrandBody(String(p), nameZh)
      .replace(/WorkBuddy/gi, "虚幕阁")
      .replace(/企鹅教师助手/g, nameZh)
      .replace(/鹏城信息AI专家/g, nameZh),
  );
}

export function buildFrontmatter(meta, slug, division, nameZh, quickPrompts) {
  const tax = inferTaxonomyFields({ ...meta, nameZh, roleTitle: nameZh, division }, slug, division);
  const divisionZh = meta.catalogL2 || meta.divisionZh || division;
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const industryTags = tax.industryTags?.length ? tax.industryTags : tags;
  const description = String(meta.description || "").slice(0, 500);
  const relSource = `${division}/${slug}.md`;

  const lines = [
    "---",
    `id: ${yamlQuote(slug)}`,
    `slug: ${slug}`,
    `nameZh: ${yamlQuote(nameZh)}`,
    `industryId: ${tax.industryId}`,
    `industryZh: ${yamlQuote(tax.industryZh)}`,
    `industryTags: [${industryTags.map((t) => yamlQuote(t)).join(", ")}]`,
    `positionId: ${slug}`,
    `positionZh: ${yamlQuote(nameZh)}`,
    `positionCategory: ${tax.positionCategory}`,
    `positionCategoryZh: ${yamlQuote(tax.positionCategoryZh)}`,
  ];
  if (tax.positionSubCategory) lines.push(`positionSubCategory: ${tax.positionSubCategory}`);
  lines.push(
    `division: ${division}`,
    `divisionZh: ${yamlQuote(divisionZh)}`,
    `emoji: ${yamlQuote(meta.emoji || "👤")}`,
    `roleKind: ${meta.roleKind || "worker"}`,
    `brainSlot: ${meta.brainSlot || "work"}`,
    `kickoffWave: ${meta.kickoffWave || "planning"}`,
    `tags: [${tags.map((t) => yamlQuote(t)).join(", ")}]`,
    `description: ${yamlQuote(description)}`,
    `source: ${yamlQuote(relSource)}`,
    `originSource: virmoor`,
    `autoGenerated: false`,
    `expertType: ${yamlQuote(meta.expertType || "agent")}`,
    `lifecycleStatus: ${meta.lifecycleStatus || "published"}`,
    `catalogL1: ${yamlQuote(meta.catalogL1 || "")}`,
    `catalogL2: ${yamlQuote(meta.catalogL2 || "")}`,
    `catalogL3: ${yamlQuote(meta.catalogL3 || "")}`,
    `catalogL4: ${yamlQuote(nameZh)}`,
    `catalogL5: ${yamlQuote(meta.catalogL5 || "")}`,
    `roleAxis: ${yamlQuote(meta.roleAxis || "")}`,
    `roleTitle: ${yamlQuote(nameZh)}`,
    `recoRank: 0`,
    `useCount: 0`,
    `marketId: ""`,
    `version: ${yamlQuote(String(meta.version || "1.0.0"))}`,
    `quickPrompts: [${quickPrompts.map((t) => yamlQuote(t)).join(", ")}]`,
    "---",
    "",
  );
  return lines.join("\n");
}

export function walkMdFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMdFiles(p));
    else if (ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}
