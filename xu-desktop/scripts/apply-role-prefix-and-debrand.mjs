/**
 * @file apply-role-prefix-and-debrand.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category role-pack
 * @algo 写回 nameZh 业务前缀 + 品牌脱敏；可 --dry-run
 *
 * Usage:
 *   node scripts/apply-role-prefix-and-debrand.mjs --dry-run
 *   node scripts/apply-role-prefix-and-debrand.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NAMEZH_SEP,
  WEAK_PREFIXES,
  buildNameZhWithPrefix,
  inferBusinessPrefix,
  resolveDisplayPrefix,
  splitDisplayNameZh,
} from "./lib/virmoor-business-prefix.mjs";
import { DIVISION_DISPLAY_LABEL } from "./lib/virmoor-namezh-label.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const LOCALE = (() => {
  const i = args.indexOf("--locale");
  return i >= 0 && args[i + 1] ? args[i + 1] : "zh-CN-virmoor";
})();
const SRC = path.join(ROOT, "role-packs-src", LOCALE);

/** 脱敏：先长词后短词；技能岗 keep 的专名不在全局替换里硬删岗位名 */
const DEBRAND_REPLACEMENTS = [
  // sample / 上市公司样例
  [/腾讯控股（00700\.HK）/g, "某港股互联网标的（示例）"],
  [/腾讯控股/g, "某港股互联网标的"],
  [/查看腾讯的/g, "查看某互联网标的的"],
  [/分析下腾讯的/g, "分析下某互联网标的的"],
  [/帮我研究腾讯/g, "帮我研究某互联网标的"],
  [/金蝶软件/g, "某企业管理软件厂商"],
  [/请为金蝶/g, "请为某企业管理软件厂商"],
  [/华为云最近/g, "某国内云厂商最近"],
  // generic 厂商堆砌（保留「微信小程序」「企业微信」作为技能名时由 skip 控制）
  [/腾讯公益/g, "公益筹款平台"],
  [/腾讯广告/g, "国内信息流广告平台"],
  [/腾讯云/g, "国内公有云"],
  [/巨量引擎/g, "短视频广告投放端"],
  [/阿里云/g, "国内公有云"],
  [/字节跳动/g, "国内互联网厂商"],
  [/OpenAI/g, "通用大模型服务商"],
  [/ChatGPT/g, "通用对话大模型"],
];

/** 岗位 slug：正文保留平台技能专名，不做过激替换 */
const KEEP_BRAND_SLUGS = new Set([
  "engineering-wechat-mini-program-developer",
  "engineering-harmonyos-engineer",
  "engineering-gaussdb-expert",
  "marketing-baidu-seo-specialist",
  "marketing-weibo-strategist",
  "marketing-kuaishou-strategist",
  "paid-media-domestic-feed-buyer",
]);

function walkMd(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMd(p, out);
    else if (ent.isFile() && ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function parseFile(raw) {
  if (!raw.startsWith("---")) return { fmRaw: "", meta: {}, body: raw, hasFm: false };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { fmRaw: "", meta: {}, body: raw, hasFm: false };
  const fmRaw = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const meta = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[m[1]] = v;
  }
  return { fmRaw, meta, body, hasFm: true };
}

function quoteYaml(v) {
  const s = String(v ?? "");
  if (/[:#{}[\],&*?|>!%@`]/.test(s) || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  if (s === "" || /[\s]/.test(s)) return `"${s}"`;
  return `"${s}"`;
}

function setFmField(fmRaw, key, value) {
  const lines = fmRaw.split(/\r?\n/);
  const re = new RegExp(`^${key}:`);
  let found = false;
  const next = lines.map((line) => {
    if (!re.test(line)) return line;
    found = true;
    return `${key}: ${quoteYaml(value)}`;
  });
  if (!found) next.splice(Math.min(3, next.length), 0, `${key}: ${quoteYaml(value)}`);
  return next.join("\n");
}

function applyDebrand(text, slug) {
  if (KEEP_BRAND_SLUGS.has(slug)) {
    // 仍脱敏样例型「腾讯控股」等，保留微信/鸿蒙技能词
    let out = text;
    for (const [re, to] of DEBRAND_REPLACEMENTS) {
      if (/微信|鸿蒙|Harmony|Gauss|百度|微博|快手|巨量/.test(re.source)) continue;
      out = out.replace(re, to);
    }
    return out;
  }
  let out = text;
  for (const [re, to] of DEBRAND_REPLACEMENTS) {
    out = out.replace(re, to);
  }
  // 残留孤立「腾讯」（非技能上下文）
  out = out.replace(/(?<![企微微])腾讯(?!小程序|支付|广告|云|控股|公益)/g, "国内互联网厂商");
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

const stats = {
  scanned: 0,
  prefixChanged: 0,
  debrandChanged: 0,
  restoredEmpty: 0,
  weakLeft: 0,
  write: WRITE,
};

// 修复空文件：从 zh-CN 拷贝
const emptyLegal = path.join(SRC, "specialized", "legal-document-review.md");
const donorLegal = path.join(ROOT, "role-packs-src", "zh-CN", "specialized", "legal-document-review.md");
if (fs.existsSync(emptyLegal)) {
  const cur = fs.readFileSync(emptyLegal, "utf8").trim();
  if (!cur && fs.existsSync(donorLegal)) {
    let donor = fs.readFileSync(donorLegal, "utf8");
    const parsed = parseFile(donor);
    let fm = parsed.fmRaw;
    fm = setFmField(fm, "nameZh", "法务合规 · 法律文件审阅");
    fm = setFmField(fm, "positionZh", "法务合规 · 法律文件审阅");
    fm = setFmField(fm, "divisionZh", "专项");
    donor = `---\n${fm}\n---\n\n${parsed.body}`;
    if (WRITE) fs.writeFileSync(emptyLegal, donor, "utf8");
    stats.restoredEmpty = 1;
    console.log("[restore]", rel(emptyLegal));
  }
}

const files = walkMd(SRC);
for (const file of files) {
  stats.scanned += 1;
  let raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) continue;

  const { fmRaw, meta, body, hasFm } = parseFile(raw);
  if (!hasFm) continue;

  const slug = meta.slug || path.basename(file, ".md");
  const division = meta.division || path.basename(path.dirname(file));
  const divisionLabel = DIVISION_DISPLAY_LABEL[division] || "综合业务";

  let nameZh = meta.nameZh || "";
  const { prefix } = splitDisplayNameZh(nameZh);
  let newNameZh = nameZh;
  let fm = fmRaw;
  let changed = false;

  if (!nameZh || WEAK_PREFIXES.has(prefix)) {
    const role = { nameZh: nameZh || slug, meta, body };
    const resolved = resolveDisplayPrefix(role, divisionLabel === "专项" ? null : divisionLabel);
    const titleSrc = nameZh || meta.roleTitle || meta.positionZh || slug;
    newNameZh = buildNameZhWithPrefix(resolved, titleSrc);
    if (newNameZh !== nameZh) {
      fm = setFmField(fm, "nameZh", newNameZh);
      if (meta.positionZh && (meta.positionZh === nameZh || WEAK_PREFIXES.has(splitDisplayNameZh(meta.positionZh).prefix))) {
        fm = setFmField(fm, "positionZh", newNameZh);
      }
      if (meta.roleTitle && meta.roleTitle === splitDisplayNameZh(nameZh).title) {
        /* keep roleTitle as title-only */
      }
      // description 若以旧 nameZh 开头则替换前缀展示
      if (meta.description && nameZh && meta.description.includes(nameZh)) {
        fm = setFmField(fm, "description", meta.description.split(nameZh).join(newNameZh));
      }
      stats.prefixChanged += 1;
      changed = true;
    }
  }

  // sales-bid 等已有「销售 · 招投标」→ 升为招投标前缀
  if (nameZh && !WEAK_PREFIXES.has(prefix)) {
    const biz = inferBusinessPrefix({ nameZh, meta, body });
    if (biz && biz !== prefix && /招投标|政务公文|建筑施工/.test(biz) && prefix !== biz) {
      // 仅对销售·招投标这类纠正
      if (prefix === "销售" && biz === "招投标") {
        let title = splitDisplayNameZh(nameZh).title;
        if (title === "招投标" || title === biz) {
          title = slug.includes("proposal") || slug.includes("bid")
            ? "标书与投标方案撰写"
            : `${title}专员`;
        }
        newNameZh = `${biz}${NAMEZH_SEP}${title}`;
        fm = setFmField(fm, "nameZh", newNameZh);
        stats.prefixChanged += 1;
        changed = true;
      }
    }
  }

  let newBody = applyDebrand(body, slug);
  let newFmText = applyDebrand(fm, slug);
  if (newBody !== body || newFmText !== fm) {
    stats.debrandChanged += 1;
    changed = true;
    fm = newFmText;
  }

  const finalPrefix = splitDisplayNameZh(
    (fm.match(/^nameZh:\s*(.*)$/m) || [])[1]?.replace(/^"|"$/g, "") || newNameZh,
  ).prefix;
  if (WEAK_PREFIXES.has(finalPrefix)) stats.weakLeft += 1;

  if (changed && WRITE) {
    fs.writeFileSync(file, `---\n${fm}\n---\n\n${newBody}`, "utf8");
  }
}

console.log(JSON.stringify(stats, null, 2));
if (!WRITE) console.log("[dry-run] pass --write to apply");
