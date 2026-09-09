/**
 * @file propose-role-prefix-and-debrand.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category role-pack
 * @algo 只读：生成「行业前缀改名 + 品牌脱敏」方案清单；不写回岗位源
 *
 * Usage:
 *   node scripts/propose-role-prefix-and-debrand.mjs
 *   node scripts/propose-role-prefix-and-debrand.mjs --out docs/audits/...
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
  path.join("docs", "audits", "2026-09-05-role-prefix-debrand-plan.md"),
);
const SRC = path.join(ROOT, "role-packs-src", LOCALE);

/** 从岗位名/正文推断业务行业前缀（仅方案，不落盘） */
const PREFIX_RULES = [
  { label: "招投标", test: /招标|投标|招投标|招采|标书|评标/ },
  { label: "政务公文", test: /公文|政务|党政|机关办文|党务工会|办文/ },
  { label: "建筑施工", test: /建筑|土木|施工造价|工程造价|监理工程师|BIM|结构工程师/ },
  { label: "跨境电商", test: /亚马逊|Amazon|跨境电商|FBA|ASIN|ACOS|ABA趋势|1688|独立站|Shopify/i },
  { label: "付费广告", test: /腾讯广告|巨量引擎|广告投放|PPC|SEM投放|付费社交|金手指·广告|投放专家/ },
  { label: "短视频运营", test: /短视频|直播带货|抖音运营|快手|视频号|小红书运营|漫剧|Flova/ },
  { label: "财务税务", test: /税务会计|税务岗|报税|增值税筹划|应付账款|应收账款|总账|出纳/ },
  { label: "人力资源", test: /招聘专员|薪酬|绩效考核|人事|劳务派遣|企业培训|培训设计师|HRBP/ },
  { label: "法务合规", test: /法务顾问|诉讼|仲裁|律师|合同审|知识产权专家|专利|劳动合规|法律合规/ },
  { label: "供应链", test: /供应链总监|库存管理|仓储|物流|采购专员|供应商管理/ },
  { label: "客户成功", test: /客户成功|外联专员|售后|高意向商机|销售外联/ },
  { label: "汽车出行", test: /汽车行业|汽车营销|车联网|懂车帝/ },
  { label: "半导体", test: /芯片|半导体|晶圆|多芯片算子/ },
  { label: "能源双碳", test: /能源管理|双碳|光伏|储能|电网/ },
  { label: "餐饮文旅", test: /餐饮运营|酒店运营|文旅|导游/ },
  { label: "医疗健康", test: /医疗健康|临床|药政|护理|医院|患者/ },
  { label: "教育培训", test: /智慧校园|教研|亲子成长|教育顾问|CBT个案|个案概念化/ },
  { label: "质量管理", test: /质量管理|CAPA|8D|持续改进专家/ },
  { label: "产品运营", test: /产品经理|增长黑客|品牌 GEO|GEO 可见度/ },
];

/** 仅在 nameZh/title 上匹配的兜底（避免正文「合规」误伤） */
const PREFIX_TITLE_FALLBACK = [
  { label: "软件研发", test: /工程师|开发专家|架构师|前端|后端/ },
  { label: "运营", test: /运营专家|运营专员/ },
];

/**
 * 品牌脱敏建议：keep=保留（平台能力名）、generic=改为通称、sample=样例脱敏
 * 方案级替换词，不执行。
 */
const DEBRAND_MAP = [
  {
    brand: "腾讯系",
    rules: [
      { from: "腾讯广告", to: "国内信息流广告平台", mode: "generic", note: "投放岗可保留平台名作能力；正文堆砌时改通称" },
      { from: "腾讯控股", to: "某港股互联网标的", mode: "sample", note: "快捷指令样例脱敏" },
      { from: "腾讯公益", to: "公益筹款平台", mode: "generic" },
      { from: "腾讯云", to: "国内公有云", mode: "generic" },
      { from: "腾讯", to: "国内互联网厂商", mode: "generic", note: "泛称；岗位名含企业微信/微信小程序见下" },
      { from: "企业微信", to: "企业即时通讯（国内）", mode: "keep-or-alias", note: "岗位本身是企微运营则可 keep" },
      { from: "微信小程序", to: "国内小程序", mode: "keep-or-alias", note: "开发岗可 keep「微信小程序」为行业技能名" },
      { from: "微信支付", to: "国内移动支付", mode: "generic" },
    ],
  },
  {
    brand: "阿里系",
    rules: [
      { from: "阿里云", to: "国内公有云", mode: "generic" },
      { from: "淘宝/天猫", to: "国内综合电商平台", mode: "generic" },
      { from: "钉钉", to: "企业协作套件（国内）", mode: "keep-or-alias" },
      { from: "支付宝", to: "国内移动支付", mode: "generic" },
      { from: "1688", to: "国内批发货源平台", mode: "generic" },
    ],
  },
  {
    brand: "字节系",
    rules: [
      { from: "抖音", to: "短视频平台", mode: "keep-or-alias", note: "运营岗可 keep" },
      { from: "巨量引擎", to: "短视频广告投放端", mode: "generic" },
      { from: "飞书", to: "企业协作套件", mode: "keep-or-alias" },
      { from: "字节跳动", to: "国内互联网厂商", mode: "generic" },
    ],
  },
  {
    brand: "华为系",
    rules: [
      { from: "华为云", to: "国内公有云", mode: "generic" },
      { from: "HarmonyOS/鸿蒙", to: "国产移动操作系统", mode: "keep-or-alias" },
      { from: "GaussDB", to: "国产分布式数据库", mode: "generic" },
      { from: "华为", to: "国内 ICT 厂商", mode: "sample" },
    ],
  },
  {
    brand: "亚马逊系",
    rules: [
      { from: "亚马逊/Amazon", to: "海外电商平台", mode: "keep-or-alias", note: "跨境岗岗位名可 keep；正文减少商标堆砌" },
      { from: "Alexa", to: "平台选品词库工具", mode: "generic" },
      { from: "FBA/ASIN/ACOS", to: "平台履约/商品/广告指标", mode: "keep-or-alias" },
    ],
  },
  {
    brand: "其它大厂/产品",
    rules: [
      { from: "百度 SEO / 文心", to: "国内搜索引擎优化 / 大模型", mode: "keep-or-alias" },
      { from: "金蝶/用友", to: "国内 ERP/财务套件", mode: "sample", note: "竞对情报样例脱敏" },
      { from: "OpenAI/ChatGPT", to: "通用大模型 API", mode: "generic" },
      { from: "Flova", to: "视频创作工具（通称）", mode: "generic", note: "第三方产品名；评估是否保留或改通称" },
    ],
  },
];

const WEAK_PREFIXES = new Set(["专项", "支持", "通用", "专业"]);

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

function inferProposedPrefix(nameZh, body, meta) {
  const titleBlob = `${nameZh}\n${meta.industryTags || ""}\n${meta.tags || ""}\n${meta.description || ""}\n${meta.catalogL4 || ""}\n${meta.roleTitle || ""}`;
  for (const rule of PREFIX_RULES) {
    if (rule.test.test(titleBlob)) return rule.label;
  }
  // 正文仅用于少数强特征行业（招投标等已在 title 覆盖）；避免「合规」全文误伤
  const bodyHead = body.slice(0, 800);
  for (const rule of PREFIX_RULES.slice(0, 6)) {
    if (rule.test.test(bodyHead)) return rule.label;
  }
  for (const rule of PREFIX_TITLE_FALLBACK) {
    if (rule.test.test(nameZh)) return rule.label;
  }
  return null;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function brandSignals(text) {
  const checks = [
    ["腾讯", /腾讯|Tencent|企业微信|微信小程序|微信支付|腾讯云|腾讯广告|腾讯公益|腾讯控股/g],
    ["阿里", /阿里巴巴|阿里云|淘宝|天猫|钉钉|支付宝|1688/g],
    ["字节", /字节跳动|ByteDance|抖音|巨量|今日头条|TikTok/g],
    ["华为", /华为|Huawei|鸿蒙|HarmonyOS|华为云|GaussDB/g],
    ["百度", /百度|Baidu|文心/g],
    ["亚马逊", /亚马逊|Amazon|Alexa|FBA|ASIN|ACOS/gi],
    ["金蝶", /金蝶|Kingdee/g],
    ["用友", /用友|Yonyou/g],
    ["OpenAI", /OpenAI|ChatGPT|GPT-4/g],
    ["Flova", /Flova/g],
  ];
  const out = [];
  for (const [name, re] of checks) {
    const hits = [...text.matchAll(re)].map((m) => m[0]);
    if (hits.length) out.push({ name, count: hits.length, samples: [...new Set(hits)].slice(0, 8) });
  }
  return out;
}

const files = walkMd(SRC);
const prefixProposals = [];
const alreadyOk = [];
const noInfer = [];
const brandDense = [];

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const nameZh = meta.nameZh || "";
  const { prefix, title, hasSep } = splitNameZh(nameZh);
  const proposed = inferProposedPrefix(nameZh, body, meta);
  const row = {
    file: rel(file),
    division: path.basename(path.dirname(file)),
    nameZh: nameZh || "(空)",
    prefix,
    title,
    proposed,
    newNameZh: proposed && title ? `${proposed} · ${title.replace(/^(专项|支持|通用|专业)\s*·\s*/, "")}` : null,
  };

  if (!hasSep || !prefix) {
    prefixProposals.push({ ...row, reason: "缺前缀" });
  } else if (WEAK_PREFIXES.has(prefix)) {
    if (proposed && proposed !== prefix) {
      // 避免「专项 · 招投标审阅」→「招投标 · 招投标审阅」重复感：若 title 已含行业词，可缩短
      let t = title;
      if (proposed === "招投标" && /^招投标/.test(t)) {
        /* keep */
      }
      row.newNameZh = `${proposed} · ${t}`;
      prefixProposals.push({ ...row, reason: "过宽前缀→业务行业" });
    } else {
      noInfer.push(row);
    }
  } else {
    alreadyOk.push(row);
  }

  const brands = brandSignals(raw);
  const heavy = brands.filter((b) => b.count >= 3);
  if (heavy.length) {
    brandDense.push({
      file: rel(file),
      nameZh: nameZh || path.basename(file, ".md"),
      brands: heavy,
    });
  }
}

prefixProposals.sort((a, b) => (a.proposed || "").localeCompare(b.proposed || "", "zh") || a.file.localeCompare(b.file));
brandDense.sort((a, b) => {
  const sa = a.brands.reduce((n, x) => n + x.count, 0);
  const sb = b.brands.reduce((n, x) => n + x.count, 0);
  return sb - sa;
});

const byLabel = new Map();
for (const p of prefixProposals) {
  const k = p.proposed || "(未推断)";
  if (!byLabel.has(k)) byLabel.set(k, []);
  byLabel.get(k).push(p);
}

const lines = [];
lines.push(`# 岗位「行业前缀改名 + 品牌脱敏」方案清单`);
lines.push(``);
lines.push(`> 生成时间：2026-09-05 · **方案文档，未改任何岗位源数据**`);
lines.push(`> 范围：\`role-packs-src/${LOCALE}\``);
lines.push(`> 依据审计：\`docs/audits/2026-09-05-role-industry-and-brand-audit.md\``);
lines.push(`> 生成脚本：\`scripts/propose-role-prefix-and-debrand.mjs\``);
lines.push(``);
lines.push(`## 0. 执行原则（待你确认后再改数据）`);
lines.push(``);
lines.push(`1. **本文件只提案**；确认前禁止写回 \`role-packs-src\`。`);
lines.push(`2. 前缀改名：把「专项/支持」里能识别业务行业的岗，改成「业务行业 · 岗位」；**不新建文件、不改 slug**（首轮只动 \`nameZh\` / 展示字段）。`);
lines.push(`3. 脱敏分级：`);
lines.push(`   - **keep**：岗位技能本身就是平台能力（如微信小程序开发）——可保留专名。`);
lines.push(`   - **generic**：正文/标签里的厂商堆砌 → 通称。`);
lines.push(`   - **sample**：快捷指令里的上市公司/友商样例 → 匿名化。`);
lines.push(`4. 建议分批：A 招投标等明确行业 → B 跨境/广告/短视频 → C 剩余专项 → D 品牌脱敏。`);
lines.push(``);
lines.push(`## 1. 新增/建议使用的业务前缀`);
lines.push(``);
lines.push(`| 建议前缀 | 用途 | 备注 |`);
lines.push(`|----------|------|------|`);
for (const rule of PREFIX_RULES) {
  lines.push(`| ${rule.label} | 从专项等迁出 | 规则：\`${rule.test}\` |`);
}
lines.push(``);
lines.push(`> 若产品希望「招投标」进独立 division 文件夹，属第二轮（搬目录）；本方案首轮只改展示前缀。`);
lines.push(``);
lines.push(`## 2. 前缀改名提案汇总`);
lines.push(``);
lines.push(`| 指标 | 数量 |`);
lines.push(`|------|------|`);
lines.push(`| 建议改前缀 | ${prefixProposals.length} |`);
lines.push(`| 过宽前缀但未能自动推断（需人工） | ${noInfer.length} |`);
lines.push(`| 已有非过宽前缀（本轮不动） | ${alreadyOk.length} |`);
lines.push(``);

for (const [label, list] of [...byLabel.entries()].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`### 2.x ${label}（${list.length}）`);
  lines.push(``);
  lines.push(`| 当前 nameZh | 建议 nameZh | 文件 |`);
  lines.push(`|------------|-------------|------|`);
  for (const r of list.slice(0, 80)) {
    const neu = r.newNameZh || "（需人工定前缀）";
    lines.push(`| ${r.nameZh} | ${neu} | \`${r.file}\` |`);
  }
  if (list.length > 80) lines.push(`| … | … | 另有 ${list.length - 80} 条 |`);
  lines.push(``);
}

// fix section numbers
let sec = 0;
const numbered = lines.map((l) => {
  if (l.startsWith("### 2.x ")) {
    sec += 1;
    return l.replace("### 2.x ", `### 2.${sec} `);
  }
  return l;
});
lines.length = 0;
lines.push(...numbered);

lines.push(`## 3. 未能自动推断的「专项/支持」（需人工）`);
lines.push(``);
lines.push(`共 ${noInfer.length} 条。样例（最多 60）：`);
lines.push(``);
for (const r of noInfer.slice(0, 60)) {
  lines.push(`- \`${r.file}\` — ${r.nameZh}`);
}
if (noInfer.length > 60) lines.push(`- …另有 ${noInfer.length - 60} 条`);
lines.push(``);

lines.push(`## 4. 品牌脱敏对照表（全局规则）`);
lines.push(``);
for (const block of DEBRAND_MAP) {
  lines.push(`### ${block.brand}`);
  lines.push(``);
  lines.push(`| 原文痕迹 | 建议写法 | 模式 | 说明 |`);
  lines.push(`|----------|----------|------|------|`);
  for (const r of block.rules) {
    lines.push(`| ${r.from} | ${r.to} | ${r.mode} | ${r.note || ""} |`);
  }
  lines.push(``);
}

lines.push(`## 5. 优先脱敏文件（单品牌命中 ≥3，人工复核）`);
lines.push(``);
lines.push(`共 ${brandDense.length} 个文件。下列为密度最高的前 80：`);
lines.push(``);
for (const h of brandDense.slice(0, 80)) {
  const brandStr = h.brands.map((b) => `${b.name}×${b.count}(${b.samples.join("/")})`).join("；");
  lines.push(`- \`${h.file}\` — **${h.nameZh}** — ${brandStr}`);
}
if (brandDense.length > 80) lines.push(`- …另有 ${brandDense.length - 80} 个`);
lines.push(``);

lines.push(`## 6. 建议落地批次（仍不自动执行）`);
lines.push(``);
lines.push(`| 批次 | 内容 | 预估规模 | 验收 |`);
lines.push(`|------|------|----------|------|`);
lines.push(`| A | 招投标 / 政务公文 / 建筑施工 前缀改名 | 见 §2 对应小节 | 列表可见「招投标 ·」等 |`);
lines.push(`| B | 跨境电商 / 付费广告 / 短视频运营 前缀 | 同上 | 专项占比下降 |`);
lines.push(`| C | 其余可推断专项 + 人工 §3 | 剩余 | 专项仅保留真正跨界岗 |`);
lines.push(`| D | 按 §4 脱敏 §5 高密度文件 | ${brandDense.length} 文件量级 | 审计脚本品牌命中下降；技能专名 keep 不误伤 |`);
lines.push(`| E | 空 frontmatter \`legal-document-review.md\` 修复 | 1 | nameZh 非空 |`);
lines.push(``);
lines.push(`## 7. 你确认后我才会做的命令（预告，本轮不跑写回）`);
lines.push(``);
lines.push("```text");
lines.push("# 示例（确认后另开任务）：");
lines.push("# node scripts/apply-role-prefix-plan.mjs --batch A --write");
lines.push("# node scripts/apply-role-debrand.mjs --mode sample --write");
lines.push("```");
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`*由 \`node scripts/propose-role-prefix-and-debrand.mjs\` 生成。*`);

const outAbs = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, lines.join("\n"), "utf8");

console.log(
  JSON.stringify(
    {
      locale: LOCALE,
      prefixProposals: prefixProposals.length,
      noInfer: noInfer.length,
      alreadyOk: alreadyOk.length,
      brandDense: brandDense.length,
      byLabel: Object.fromEntries([...byLabel.entries()].map(([k, v]) => [k, v.length])),
      out: rel(outAbs),
    },
    null,
    2,
  ),
);
