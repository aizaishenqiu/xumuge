/**
 * 离线翻译岗位 prompt 中 ``` 围栏内的英文「交付模板」（非代码块）。
 * rebuild/offline 流程刻意保留 code fence，导致大量 COHERENCE CHECK 等英文模板残留。
 *
 * node scripts/localize-agency-fence-templates-zh.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");

/** 长短语优先 */
const PHRASES = [
  ["COHERENCE CHECK:", "一致性检查："],
  ["COHERENCE CHECK", "一致性检查"],
  ["CULTURAL SYSTEM:", "文化体系："],
  ["GEOGRAPHIC COHERENCE REPORT", "地理自洽报告"],
  ["CLIMATE SYSTEM:", "气候体系："],
  ["PERIOD AUTHENTICITY REPORT", "时期真实性报告"],
  ["STRUCTURAL ANALYSIS", "结构分析"],
  ["CHARACTER ARC:", "角色弧线："],
  ["PSYCHOLOGICAL PROFILE:", "心理画像："],
  ["RELATIONAL DYNAMICS:", "人际动态："],
  ["Analytical Framework:", "分析框架："],
  ["Subsistence & Economy:", "生计与经济："],
  ["Social Organization:", "社会组织："],
  ["Belief System:", "信仰体系："],
  ["Identity & Boundaries:", "身份与边界："],
  ["Internal Tensions:", "内部张力："],
  ["Physical Geography:", "自然地理："],
  ["Resource Distribution:", "资源分布："],
  ["Human Geography:", "人文地理："],
  ["Coherence Issues:", "自洽问题："],
  ["Global Factors:", "全球因素："],
  ["Regional Effects:", "区域效应："],
  ["Confidence Level:", "置信度："],
  ["Material Culture:", "物质文化："],
  ["Social Structure:", "社会结构："],
  ["Anachronism Flags:", "时代错置标记："],
  ["Common Myths About This Period:", "关于该时期的常见迷思："],
  ["Daily Life Texture:", "日常生活质感："],
  ["Controlling Idea:", "控制性主题："],
  ["Structure Model:", "结构模型："],
  ["Act Breakdown:", "幕次拆解："],
  ["Tension Curve:", "张力曲线："],
  ["Information Asymmetry:", "信息不对称："],
  ["Narrative Debts:", "叙事债务："],
  ["Structural Issues:", "结构问题："],
  ["Arc Type:", "弧线类型："],
  ["Framework:", "理论框架："],
  ["Want vs. Need:", "外在欲望 vs 内在需求："],
  ["Ghost/Wound:", "创伤/伤口："],
  ["Lie Believed:", "所信之谎："],
  ["Arc Checkpoints:", "弧线检查点："],
  ["Core Traits:", "核心特质："],
  ["Attachment Style:", "依恋类型："],
  ["Defense Mechanisms", "防御机制"],
  ["Core Wound:", "核心伤口："],
  ["Coping Strategy:", "应对策略："],
  ["Blind Spot:", "盲点："],
  ["Power Dynamic:", "权力动态："],
  ["Communication Pattern:", "沟通模式："],
  ["Unspoken Contract:", "隐性契约："],
  ["Trigger Points:", "冲突触发点："],
  ["Growth Edge:", "成长空间："],
  ["Mode of production:", "生产方式："],
  ["Exchange system:", "交换体系："],
  ["Kinship system:", "亲属制度："],
  ["Residence pattern:", "居住模式："],
  ["Political organization:", "政治组织："],
  ["Element:", "元素："],
  ["Function:", "功能："],
  ["Consistency:", "一致性："],
  ["Red Flags:", "风险点："],
  ["Real-world parallels:", "现实参照："],
  ["Recommendation:", "建议："],
  ["Region:", "区域："],
  ["Setting:", "背景设定："],
  ["Claim:", "主张："],
  ["Verdict:", "判定："],
  ["Evidence:", "证据："],
  ["Confidence:", "置信度："],
  ["Brand Purpose", "品牌使命"],
  ["Brand Vision", "品牌愿景"],
  ["Brand Mission", "品牌任务"],
  ["Brand Values", "品牌价值观"],
  ["Brand Foundation Document", "品牌基础文档"],
  ["SEARCH CONTEXT", "搜索情境"],
  ["Google query:", "搜索词："],
  ["Arrival source:", "来源渠道："],
  ["Sites seen before:", "此前访问站点："],
  ["For any quantitative claim, walk the chain:", "对任何定量主张，按链条逐步审问："],
  ["Result template that survives scrutiny:", "经得起审视的结果模板："],
  ["Question   —", "问题   —"],
  ["Measurement —", "测量   —"],
  ["Sample     —", "样本   —"],
  ["Comparison —", "比较   —"],
  ["Analysis   —", "分析   —"],
  ["Inference  —", "推断   —"],
  ["Decision   —", "决策   —"],
  ["Estimate:", "估计值："],
  ["Interval:", "区间："],
  ["Assumptions:", "假设："],
  ["Power/limits:", "功效/局限："],
  ["Bottom line:", "结论："],
  ["Ordinary World:", "平凡世界："],
  ["Midpoint Shift:", "中点转折："],
  ["Dark Night:", "至暗时刻："],
  ["Transformation:", "转变："],
  ["Setup:", "铺垫："],
  ["Confrontation:", "对抗："],
  ["Resolution:", "解决："],
  ["Openness:", "开放性："],
  ["Conscientiousness:", "尽责性："],
  ["Extraversion:", "外向性："],
  ["Agreeableness:", "宜人性："],
  ["Neuroticism:", "神经质："],
  ["Terrain:", "地形："],
  ["Climate Zone:", "气候带："],
  ["Hydrology:", "水文："],
  ["Biome:", "生物群系："],
  ["Natural Hazards:", "自然灾害："],
  ["Agricultural potential:", "农业潜力："],
  ["Settlement logic:", "聚落逻辑："],
  ["Trade routes:", "贸易路线："],
  ["Strategic value:", "战略价值："],
  ["Carrying capacity:", "环境承载力："],
  ["Axial tilt:", "地轴倾角："],
  ["Ocean currents:", "洋流："],
  ["Prevailing winds:", "盛行风："],
  ["Continental position:", "大陆位置："],
  ["Rain shadows:", "雨影效应："],
  ["Coastal moderation:", "沿岸调节："],
  ["Altitude effects:", "海拔效应："],
  ["Seasonal patterns:", "季节模式："],
  ["Diet:", "饮食："],
  ["Clothing:", "服饰："],
  ["Architecture:", "建筑："],
  ["Technology:", "技术："],
  ["Currency/Trade:", "货币/贸易："],
  ["Power:", "权力："],
  ["Class/Caste:", "阶级/种姓："],
  ["Gender roles:", "性别角色："],
  ["Religion/Belief:", "宗教/信仰："],
  ["Law:", "法律："],
  ["Model:", "理论模型："],
  ["Behavioral pattern in relationships:", "关系中的行为模式："],
  ["Triggered by:", "触发情境："],
  ["Under stress:", "压力下："],
  ["Primary:", "主要："],
];

const STEP_LINES = [
  [
    /^(\s*\d+\.\s*)Question\s+—\s*(.+)$/i,
    (_, n, rest) =>
      `${n}问题   — ${rest
        .replace(/what is actually being asked\?/i, "实际在问什么？")
        .replace(/descriptive \/ associational \/ causal/, "描述性 / 关联性 / 因果性")}`,
  ],
  [
    /^(\s*\d+\.\s*)Measurement\s+—\s*(.+)$/i,
    (_, n, rest) => `${n}测量   — ${rest.replace(/what was measured, how, and how well\?/i, "测了什么、如何测、测得如何？")}`,
  ],
  [
    /^(\s*\d+\.\s*)Sample\s+—\s*(.+)$/i,
    (_, n, rest) =>
      `${n}样本   — ${rest.replace(/who is in the data, who is missing, and to whom does it generalize\?/i, "数据包含谁、缺失谁、能推广到谁？")}`,
  ],
  [
    /^(\s*\d+\.\s*)Comparison\s+—\s*(.+)$/i,
    (_, n, rest) =>
      `${n}比较   — ${rest.replace(/compared against what\?/i, "与什么对照？").replace(/control group, baseline, counterfactual/, "对照组、基线、反事实")}`,
  ],
  [
    /^(\s*\d+\.\s*)Analysis\s+—\s*(.+)$/i,
    (_, n, rest) =>
      `${n}分析   — ${rest.replace(/how was the number computed, and were the choices pre-specified\?/i, "数字如何计算，选择是否预先指定？")}`,
  ],
  [
    /^(\s*\d+\.\s*)Inference\s+—\s*(.+)$/i,
    (_, n, rest) =>
      `${n}推断   — ${rest.replace(/how easily could chance, bias, or a confounder produce this\?/i, "偶然、偏倚或混杂多容易制造该结果？")}`,
  ],
  [
    /^(\s*\d+\.\s*)Decision\s+—\s*(.+)$/i,
    (_, n, rest) =>
      `${n}决策   — ${rest.replace(/given the uncertainty, what does this actually support doing\?/i, "给定不确定性，实际支持采取什么行动？")}`,
  ],
];

function enRatio(s) {
  const zh = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  return en + zh ? en / (en + zh) : 0;
}

function looksLikeCode(inner) {
  const t = inner.trim();
  if (/^(typescript|javascript|js|python|bash|sh|json|yaml|sql|rust|go|java|powershell)\b/i.test(t)) return true;
  if (/^\s*(import |export |const |let |var |function |class |#include|def |package |using |@|\$schema)/m.test(t))
    return true;
  if (/\b(console\.(log|error)|require\(|module\.exports|=>|{\s*"\$)/.test(t)) return true;
  if ((t.match(/[{}();=]/g) || []).length > 8 && /\b(return|if|else|for|while)\b/.test(t)) return true;
  return false;
}

function isTemplateFence(inner) {
  if (looksLikeCode(inner)) return false;
  if (enRatio(inner) < 0.35) return false;
  if (/\[[^\]]+\]/.test(inner)) return true;
  if (/^[A-Z][A-Z0-9\s:—\-/&()]+$/m.test(inner.trim().split("\n")[0])) return true;
  if (/^(#{1,3}\s+[A-Za-z]|[-*]\s+[A-Za-z]{3,}:)/m.test(inner)) return true;
  return enRatio(inner) > 0.55 && !/\b(function|import|export|const)\b/.test(inner);
}

function applyPhrases(s) {
  let out = s;
  for (const [en, zh] of PHRASES) out = out.split(en).join(zh);
  return out;
}

function translateTemplateLine(line) {
  let s = applyPhrases(line);
  for (const [re, fn] of STEP_LINES) {
    if (re.test(s)) s = s.replace(re, fn);
  }
  const hdr = s.match(/^([A-Z][A-Z0-9\s:—\-/&()]+)$/);
  if (hdr) {
    const map = {
      "COHERENCE CHECK": "一致性检查",
      "STRUCTURAL ANALYSIS": "结构分析",
      "PERIOD AUTHENTICITY REPORT": "时期真实性报告",
      "GEOGRAPHIC COHERENCE REPORT": "地理自洽报告",
    };
    if (map[hdr[1].trim()]) s = map[hdr[1].trim()];
  }
  if (/^##\s+/.test(s) && enRatio(s) > 0.4) {
    s = s
      .replace(/^##\s+Why the brand exists/, "## 品牌为何存在")
      .replace(/^##\s+Aspirational future state/, "## 愿景未来态")
      .replace(/^##\s+What the brand does/, "## 品牌做什么")
      .replace(/^##\s+Core principles/, "## 核心原则");
  }
  return s;
}

function localizeFenceInner(inner) {
  if (!isTemplateFence(inner)) return inner;
  const lines = inner.split("\n");
  const out = lines.map(translateTemplateLine);
  let joined = out.join("\n");
  joined = joined.replace(
    /A claim is only as strong as the weakest link in this chain — name it\./,
    "主张强度取决于链条中最弱一环 — 必须点名。",
  );
  return joined;
}

function localizePrompt(prompt) {
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let changed = false;
  let fences = 0;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(prompt))) {
    parts.push(prompt.slice(last, m.index));
    const lang = m[1] || "";
    const inner = m[2];
    const zh = localizeFenceInner(inner);
    if (zh !== inner) {
      changed = true;
      fences++;
      parts.push("```" + lang + (zh.startsWith("\n") ? zh : "\n" + zh) + "\n```");
    } else parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(prompt.slice(last));
  return { text: parts.join(""), changed, fences };
}

const raw = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
let rolesChanged = 0;
let totalFences = 0;
for (const r of raw.roles) {
  const { text, changed, fences } = localizePrompt(r.prompt || "");
  if (changed) {
    r.prompt = text;
    rolesChanged++;
    totalFences += fences;
  }
}
raw.fenceLocalizedAt = new Date().toISOString();
fs.writeFileSync(CATALOG, JSON.stringify(raw, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ rolesChanged, totalFences }, null, 2));
