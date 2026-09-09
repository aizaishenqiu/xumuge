/**
 * @file audit-role-industry-and-brands.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category role-pack
 * @algo 只读审计：nameZh 行业前缀 + 品牌/大厂痕迹；不改数据
 *
 * Usage:
 *   node scripts/audit-role-industry-and-brands.mjs
 *   node scripts/audit-role-industry-and-brands.mjs --locale zh-CN-virmoor --out docs/audits/...
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function argVal(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const LOCALE = argVal("--locale", "zh-CN-virmoor");
const OUT = argVal(
  "--out",
  path.join("docs", "audits", "2026-09-05-role-industry-and-brand-audit.md"),
);

const SRC = path.join(ROOT, "role-packs-src", LOCALE);

/** 期望在岗位库中有成体系覆盖的行业/场景关键词（用于缺口提示） */
const EXPECTED_INDUSTRY_KEYWORDS = [
  { key: "招投标", aliases: ["招标", "投标", "招采", "标书", "评标", "招投标"] },
  { key: "政务公文", aliases: ["公文", "政务", "党政", "机关事务", "党务"] },
  { key: "建筑施工", aliases: ["建筑", "施工", "造价", "监理", "BIM", "工程造价"] },
  { key: "汽车制造", aliases: ["汽车", "整车", "零部件", "车联网"] },
  { key: "物流仓储", aliases: ["物流", "仓储", "快递", "干线", "供应链"] },
  { key: "保险精算", aliases: ["保险", "精算", "核保", "理赔"] },
  { key: "证券投行", aliases: ["证券", "投行", "券商", "资管", "投资者关系"] },
  { key: "银行信贷", aliases: ["银行", "信贷", "对公", "零售银行"] },
  { key: "能源电力", aliases: ["能源", "电力", "光伏", "风电", "电网", "储能", "双碳"] },
  { key: "半导体芯片", aliases: ["半导体", "芯片", "晶圆", "EDA"] },
  { key: "生物制药", aliases: ["制药", "生物医药", "临床", "药政", "医疗"] },
  { key: "餐饮酒店", aliases: ["餐饮", "酒店", "连锁门店", "文旅"] },
  { key: "电商直播", aliases: ["直播", "电商", "店铺", "带货"] },
  { key: "跨境贸易", aliases: ["跨境", "外贸", "报关", "清关"] },
  { key: "法律诉讼", aliases: ["诉讼", "仲裁", "律师", "法务", "合规"] },
  { key: "税务筹划", aliases: ["税务", "报税", "增值税", "所得税", "财务"] },
  { key: "人力资源", aliases: ["人力资源", "招聘", "薪酬", "绩效", "劳务", "HR"] },
  { key: "网络安全", aliases: ["安全", "等保", "渗透", "SOC", "安全运营"] },
];

/** 大厂/平台品牌（中文优先；排除纯产品协议名需人工复核） */
const BRAND_PATTERNS = [
  { brand: "腾讯", re: /腾讯|Tencent|WeChat\s*Pay|微信支付|企业微信|腾讯云|QQ\s*音乐|微信小程序/gi },
  { brand: "阿里巴巴", re: /阿里巴巴|阿里云|Alibaba|Aliyun|淘宝|天猫|钉钉|支付宝|菜鸟/gi },
  { brand: "字节跳动", re: /字节跳动|ByteDance|抖音|今日头条|飞书(?!运营)|TikTok/gi },
  { brand: "百度", re: /百度|Baidu|文心一言/gi },
  { brand: "华为", re: /华为|Huawei|鸿蒙|HarmonyOS|华为云|GaussDB/gi },
  { brand: "京东", re: /京东|JD\.com|京东云/gi },
  { brand: "美团", re: /美团|Meituan/gi },
  { brand: "网易", re: /网易|NetEase/gi },
  { brand: "拼多多", re: /拼多多|Pinduoduo|PDD/gi },
  { brand: "小米", re: /小米|Xiaomi|MIUI/gi },
  { brand: "微软", re: /微软|Microsoft|Azure(?!\s*OpenAI)|Office\s*365|GitHub\s*Copilot/gi },
  { brand: "谷歌", re: /谷歌|Google(?!\s*Font)|Gemini\s*API|GCP/gi },
  { brand: "苹果", re: /苹果公司|Apple\s*Inc|App\s*Store(?!\s*审核)|iOS\s*App\s*Store/gi },
  { brand: "亚马逊", re: /亚马逊|Amazon(?!\s*Web)|AWS(?!\s*CLI)|Kindle/gi },
  { brand: "OpenAI", re: /OpenAI|ChatGPT|GPT-4|GPT-3\.5/gi },
  { brand: "金蝶", re: /金蝶|Kingdee/gi },
  { brand: "用友", re: /用友|Yonyou/gi },
  { brand: "Salesforce", re: /Salesforce/gi },
  { brand: "Oracle", re: /Oracle(?!\s*JDK)/gi },
  { brand: "SAP", re: /\bSAP\b/gi },
  { brand: "快手", re: /快手|Kuaishou/gi },
  { brand: "小红书", re: /小红书|RED\s*Note|Xiaohongshu/gi },
  { brand: "微博", re: /微博|Weibo/gi },
  { brand: "B站", re: /哔哩哔哩|Bilibili|\bB站\b/gi },
];

function walkMd(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMd(p, out);
    else if (ent.isFile() && ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const meta = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[m[1]] = v;
  }
  return { meta, body };
}

function splitNameZh(nameZh) {
  const s = String(nameZh || "").trim();
  const sep = " · ";
  const i = s.indexOf(sep);
  if (i <= 0) return { prefix: "", title: s, hasSep: false };
  return { prefix: s.slice(0, i).trim(), title: s.slice(i + sep.length).trim(), hasSep: true };
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function countHits(text, re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  const hits = [];
  let m;
  while ((m = r.exec(text)) !== null) {
    hits.push(m[0]);
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return hits;
}

function snippetAround(text, needle, radius = 40) {
  const i = text.indexOf(needle);
  if (i < 0) return "";
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + needle.length + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const files = walkMd(SRC);
const roles = [];
const prefixCounts = new Map();
const noPrefix = [];
const weakPrefix = []; // 专项 / 通用 / 支持 等过宽
const brandHits = new Map(); // brand -> [{file, nameZh, matches, snippet}]
const keywordCoverage = new Map();

for (const { key } of EXPECTED_INDUSTRY_KEYWORDS) {
  keywordCoverage.set(key, { nameZhHits: [], bodyOnlyHits: [], files: [] });
}

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const division = path.basename(path.dirname(file));
  const slug = path.basename(file, ".md");
  const nameZh = meta.nameZh || "";
  const { prefix, title, hasSep } = splitNameZh(nameZh);
  const full = `${nameZh}\n${body}\n${JSON.stringify(meta)}`;

  roles.push({ file: rel(file), division, slug, nameZh, prefix, title, hasSep });

  if (!hasSep || !prefix) {
    noPrefix.push({ file: rel(file), nameZh: nameZh || "(空)", division });
  } else {
    prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
    if (["专项", "通用", "支持", "专业"].includes(prefix)) {
      weakPrefix.push({ file: rel(file), nameZh, division });
    }
  }

  for (const { key, aliases } of EXPECTED_INDUSTRY_KEYWORDS) {
    const hitInName = aliases.some((a) => nameZh.includes(a) || title.includes(a));
    const hitInBody = aliases.some((a) => body.includes(a) || String(meta.industryTags || "").includes(a));
    const bucket = keywordCoverage.get(key);
    if (hitInName) {
      bucket.nameZhHits.push({ file: rel(file), nameZh });
      bucket.files.push(rel(file));
    } else if (hitInBody) {
      bucket.bodyOnlyHits.push({ file: rel(file), nameZh });
    }
  }

  for (const { brand, re } of BRAND_PATTERNS) {
    const hits = countHits(full, re);
    if (!hits.length) continue;
    if (!brandHits.has(brand)) brandHits.set(brand, []);
    const uniq = [...new Set(hits.map((h) => h))];
    brandHits.get(brand).push({
      file: rel(file),
      nameZh: nameZh || slug,
      division,
      matches: uniq.slice(0, 12),
      matchCount: hits.length,
      snippet: snippetAround(full, uniq[0]),
    });
  }
}

const prefixSorted = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1]);
const brandSorted = [...brandHits.entries()].sort((a, b) => b[1].length - a[1].length);

const thinKeywords = [];
const missingKeywords = [];
for (const { key } of EXPECTED_INDUSTRY_KEYWORDS) {
  const c = keywordCoverage.get(key);
  const n = c.nameZhHits.length;
  if (n === 0) missingKeywords.push({ key, bodyOnly: c.bodyOnlyHits.length });
  else if (n < 3) thinKeywords.push({ key, count: n, samples: c.nameZhHits.slice(0, 5) });
}

const biddingRoles = roles.filter(
  (r) => /招标|投标|招投标|招采|标书/.test(r.nameZh) || /招标|投标|招投标/.test(r.slug),
);

const lines = [];
lines.push(`# 岗位数据审计：行业完整性 & 大厂/品牌痕迹`);
lines.push(``);
lines.push(`> 生成时间：2026-09-05 · 只读审计，**未改**任何岗位源数据`);
lines.push(`> 扫描目录：\`role-packs-src/${LOCALE}\``);
lines.push(`> 脚本：\`scripts/audit-role-industry-and-brands.mjs\``);
lines.push(``);
lines.push(`## 1. 总览`);
lines.push(``);
lines.push(`| 指标 | 数值 |`);
lines.push(`|------|------|`);
lines.push(`| 岗位文件数 | ${roles.length} |`);
lines.push(`| nameZh 含「行业 · 岗位」分隔符 | ${roles.length - noPrefix.length} |`);
lines.push(`| **缺行业前缀** | **${noPrefix.length}** |`);
lines.push(`| 过宽前缀（专项/通用/支持/专业） | ${weakPrefix.length} |`);
lines.push(`| 不同前缀种类数 | ${prefixCounts.size} |`);
lines.push(`| 命中品牌规则的岗位文件数（去重按品牌累计） | ${[...brandHits.values()].reduce((n, a) => n + a.length, 0)} |`);
lines.push(`| 品牌种类数 | ${brandHits.size} |`);
lines.push(``);
const divisionCounts = new Map();
for (const r of roles) {
  divisionCounts.set(r.division, (divisionCounts.get(r.division) || 0) + 1);
}
const divisionSorted = [...divisionCounts.entries()].sort((a, b) => b[1] - a[1]);

lines.push(`## 2. 行业前缀 / 目录分布`);
lines.push(``);
lines.push(`### 2.0 目录（division）岗位数`);
lines.push(``);
lines.push(`| division | 岗位数 |`);
lines.push(`|----------|--------|`);
for (const [d, n] of divisionSorted) {
  lines.push(`| ${d} | ${n} |`);
}
lines.push(``);
lines.push(`### 2.0b nameZh 前缀分布（Top）`);
lines.push(``);
lines.push(`| 前缀 | 岗位数 |`);
lines.push(`|------|--------|`);
for (const [p, n] of prefixSorted.slice(0, 40)) {
  lines.push(`| ${p} | ${n} |`);
}
if (prefixSorted.length > 40) {
  lines.push(`| …其余 ${prefixSorted.length - 40} 种 | ${prefixSorted.slice(40).reduce((s, [, n]) => s + n, 0)} |`);
}
lines.push(``);
lines.push(`### 2.1 缺「 · 」前缀的岗位`);
lines.push(``);
if (!noPrefix.length) {
  lines.push(`无。所有 nameZh 均含「行业 · 岗位」形态。`);
} else {
  lines.push(`共 ${noPrefix.length} 条：`);
  lines.push(``);
  for (const r of noPrefix.slice(0, 80)) {
    lines.push(`- \`${r.file}\` — \`${r.nameZh}\``);
  }
  if (noPrefix.length > 80) lines.push(`- …另有 ${noPrefix.length - 80} 条`);
}
lines.push(``);
lines.push(`### 2.2 过宽前缀（易被看成「没有行业」）`);
lines.push(``);
lines.push(
  `大量岗位挂在 **「专项 · …」**：从列表上看像「没行业」，其实是目录归类为 specialized，而不是「招投标 / 建筑 / 政务」等业务行业标签。`,
);
lines.push(``);
lines.push(`| 过宽前缀 | 数量 |`);
lines.push(`|----------|------|`);
for (const p of ["专项", "通用", "支持", "专业"]) {
  lines.push(`| ${p} | ${prefixCounts.get(p) || 0} |`);
}
lines.push(``);
lines.push(`「专项」样例（最多 40）：`);
lines.push(``);
for (const r of weakPrefix.filter((x) => x.nameZh.startsWith("专项")).slice(0, 40)) {
  lines.push(`- \`${r.file}\` — ${r.nameZh}`);
}
const specialCount = weakPrefix.filter((x) => x.nameZh.startsWith("专项")).length;
if (specialCount > 40) lines.push(`- …另有 ${specialCount - 40} 条「专项」`);
lines.push(``);
lines.push(`## 3. 招投标等行业覆盖（关键词抽查）`);
lines.push(``);
lines.push(
  `说明：下列「覆盖」指 **nameZh/岗位名含关键词**；若仅正文提到则记入 body-only，不算成体系行业岗。`,
);
lines.push(``);
lines.push(`| 期望行业场景 | nameZh 命中岗位数 | 仅正文命中数 | 判定 |`);
lines.push(`|--------------|-------------------|--------------|------|`);
for (const { key } of EXPECTED_INDUSTRY_KEYWORDS) {
  const c = keywordCoverage.get(key);
  const n = c.nameZhHits.length;
  let verdict = "有覆盖";
  if (n === 0) verdict = c.bodyOnlyHits.length ? "仅正文提及，无独立岗位名" : "**疑似缺口**";
  else if (n < 3) verdict = "偏薄（&lt;3）";
  lines.push(`| ${key} | ${n} | ${c.bodyOnlyHits.length} | ${verdict} |`);
}
lines.push(``);
lines.push(`### 3.1 招投标相关岗位（已有）`);
lines.push(``);
if (!biddingRoles.length) {
  lines.push(`**未发现** nameZh/slug 含招投标关键词的岗位。`);
} else {
  lines.push(`共 ${biddingRoles.length} 条（注意：前缀多为「专项」，不是「招投标 ·」）：`);
  lines.push(``);
  for (const r of biddingRoles) {
    lines.push(`- \`${r.file}\` — **${r.nameZh}**`);
  }
}
lines.push(``);
lines.push(`### 3.2 疑似缺口 / 偏薄行业`);
lines.push(``);
if (!missingKeywords.length && !thinKeywords.length) {
  lines.push(`抽查关键词均有 ≥3 个 nameZh 命中。`);
} else {
  if (missingKeywords.length) {
    lines.push(`**疑似缺口（nameZh 0 命中）：**`);
    lines.push(``);
    for (const m of missingKeywords) {
      lines.push(
        `- **${m.key}**：岗位名无该场景；正文零散提及 ${m.bodyOnly} 处（不等于已建行业岗）。`,
      );
    }
    lines.push(``);
  }
  if (thinKeywords.length) {
    lines.push(`**偏薄（nameZh &lt;3）：**`);
    lines.push(``);
    for (const t of thinKeywords) {
      lines.push(`- **${t.key}**（${t.count}）：`);
      for (const s of t.samples) lines.push(`  - \`${s.file}\` — ${s.nameZh}`);
    }
  }
}
lines.push(``);
lines.push(`### 3.3 行业完整性结论（不改数据，仅诊断）`);
lines.push(``);
lines.push(`1. **形式完整**：绝大多数 nameZh 已有「X · Y」前缀，并非完全没行业字。`);
lines.push(
  `2. **业务行业不完整**：招投标、建筑、政务等常见业务场景，要么挤在「专项」下，要么 nameZh 覆盖偏薄/缺失；用户体感「很多岗位没有行业（如招标）」主要来自这里。`,
);
lines.push(
  `3. **建议（未执行）**：为招投标等建独立前缀或 division（如「招投标 · 审阅专家」），并从「专项」迁出；缺口行业补岗需产品拍板，本报告不改源数据。`,
);
lines.push(``);
lines.push(`## 4. 大厂 / 平台品牌痕迹（类似腾讯）`);
lines.push(``);
lines.push(
  `下列命中含**正当平台能力名**（如「微信小程序开发」「百度 SEO」）与**疑似源材料未脱敏**混在一起，需人工区分；本表一律列出，**未改文件**。`,
);
lines.push(``);
lines.push(`| 品牌 | 命中岗位文件数 |`);
lines.push(`|------|----------------|`);
for (const [brand, list] of brandSorted) {
  lines.push(`| ${brand} | ${list.length} |`);
}
lines.push(``);

let brandSection = 0;
for (const [brand, list] of brandSorted) {
  brandSection += 1;
  lines.push(`### 4.${brandSection} ${brand}（${list.length}）`);
  lines.push(``);
  const sorted = [...list].sort((a, b) => b.matchCount - a.matchCount);
  for (const h of sorted.slice(0, 60)) {
    lines.push(
      `- \`${h.file}\` — ${h.nameZh} · 命中 ${h.matchCount} 次 · 词例：\`${h.matches.join("`, `")}\``,
    );
    if (h.snippet) lines.push(`  - 摘录：…${h.snippet}…`);
  }
  if (sorted.length > 60) lines.push(`- …另有 ${sorted.length - 60} 条`);
  lines.push(``);
}

lines.push(`## 5. 高风险人工复核清单（品牌密度高）`);
lines.push(``);
const dense = [];
for (const [brand, list] of brandHits) {
  for (const h of list) {
    if (h.matchCount >= 5) dense.push({ brand, ...h });
  }
}
dense.sort((a, b) => b.matchCount - a.matchCount);
if (!dense.length) {
  lines.push(`无单文件单品牌 ≥5 次命中。`);
} else {
  lines.push(`单文件对同一品牌规则命中 ≥5 次（优先人工看）：`);
  lines.push(``);
  for (const h of dense.slice(0, 80)) {
    lines.push(
      `- **${h.brand}** ×${h.matchCount} — \`${h.file}\` — ${h.nameZh}`,
    );
  }
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`*本报告由 \`node scripts/audit-role-industry-and-brands.mjs\` 生成。*`);

const outAbs = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, lines.join("\n"), "utf8");

console.log(
  JSON.stringify(
    {
      locale: LOCALE,
      roles: roles.length,
      noPrefix: noPrefix.length,
      weakPrefix: weakPrefix.length,
      brands: brandHits.size,
      brandFiles: [...brandHits.values()].reduce((n, a) => n + a.length, 0),
      biddingRoles: biddingRoles.length,
      missingKeywords: missingKeywords.map((m) => m.key),
      thinKeywords: thinKeywords.map((t) => t.key),
      out: rel(outAbs),
    },
    null,
    2,
  ),
);
