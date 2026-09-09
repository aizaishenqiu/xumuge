/**
 * Offline structural + phrase translation for remaining agency roles.
 * Keeps code fences intact. Produces .cache/agency-zh/{id}.md
 *
 * node scripts/offline-zh-agency-bodies.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, ".cache/agency-agents");
const OUT_DIR = path.join(ROOT, ".cache/agency-zh");

const TARGETS = {
  "design-ui-designer": "design/design-ui-designer.md",
  "design-ux-researcher": "design/design-ux-researcher.md",
  "engineering-devops-automator": "engineering/engineering-devops-automator.md",
  "engineering-technical-writer": "engineering/engineering-technical-writer.md",
  "product-manager": "product/product-manager.md",
  "security-appsec-engineer": "security/security-appsec-engineer.md",
  "support-support-responder": "support/support-support-responder.md",
};

// Longer phrases first
const PHRASES = [
  ["Your Identity & Memory", "身份与记忆"],
  ["Your Core Mission", "核心使命"],
  ["Critical Rules You Must Follow", "必须遵守的规则"],
  ["Your Technical Deliverables", "技术交付物"],
  ["Your Design System Deliverables", "设计系统交付物"],
  ["Your Research Deliverables", "研究交付物"],
  ["Your Architecture Deliverables", "架构交付物"],
  ["Your Workflow Process", "工作流程"],
  ["Your Communication Style", "沟通风格"],
  ["Learning & Memory", "学习与记忆"],
  ["Your Success Metrics", "成功标准"],
  ["Advanced Capabilities", "进阶能力"],
  ["Instructions Reference", "指令参考"],
  ["You're successful when:", "当你做到以下时即算成功："],
  ["You are successful when:", "当你做到以下时即算成功："],
  ["Default requirement", "默认要求"],
  ["Agent Personality", "岗位人设"],
  ["Remember and build expertise in:", "记住并积累："],
  ["Remember and build on:", "记住并持续积累："],
  ["Step 1:", "步骤 1："],
  ["Step 2:", "步骤 2："],
  ["Step 3:", "步骤 3："],
  ["Step 4:", "步骤 4："],
  ["Step 5:", "步骤 5："],
  ["Step 6:", "步骤 6："],
  ["Step 7:", "步骤 7："],
  ["Be specific", "要具体"],
  ["Be precise", "要精确"],
  ["Be thorough", "要彻底"],
  ["Be data-driven", "数据驱动"],
  ["Be strategic", "要有战略视野"],
  ["Focus on", "关注"],
  ["Think performance", "想着性能"],
  ["Think security", "想着安全"],
  ["Ensure accessibility", "确保无障碍"],
  ["Ensure security", "确保安全"],
  ["Ensure performance", "确保性能"],
  ["Create comprehensive", "创建全面的"],
  ["Build and maintain", "构建并维护"],
  ["Design and implement", "设计并实现"],
  ["Develop and implement", "开发并落地"],
  ["user experience", "用户体验"],
  ["design system", "设计系统"],
  ["component library", "组件库"],
  ["design tokens", "设计令牌"],
  ["accessibility", "无障碍"],
  ["best practices", "最佳实践"],
  ["end-to-end", "端到端"],
  ["CI/CD", "CI/CD"],
  ["machine learning", "机器学习"],
  ["site reliability", "站点可靠性"],
  ["error budget", "错误预算"],
  ["chaos engineering", "混沌工程"],
  ["observability", "可观测性"],
  ["microservices", "微服务"],
  ["infrastructure as code", "基础设施即代码"],
  ["continuous integration", "持续集成"],
  ["continuous delivery", "持续交付"],
  ["technical writing", "技术写作"],
  ["documentation", "文档"],
  ["product manager", "产品经理"],
  ["roadmap", "路线图"],
  ["stakeholders", "利益相关方"],
  ["user research", "用户研究"],
  ["usability testing", "可用性测试"],
  ["A/B testing", "A/B 测试"],
  ["application security", "应用安全"],
  ["threat modeling", "威胁建模"],
  ["secure coding", "安全编码"],
  ["incident response", "事件响应"],
  ["support responder", "支持响应"],
  ["customer support", "客户支持"],
  ["escalation", "升级"],
  ["SLA", "SLA"],
  ["You are **", "你是 **"],
  ["You are an **", "你是一位 **"],
  ["You are a **", "你是一位 **"],
];

const SECTION_RES = [
  [/^#\s+(.+?)\s+Agent Personality\s*$/gim, "# $1 岗位人设"],
  [/^#\s+(.+?)\s+Agent\s*$/gim, "# $1 岗位"],
  [/^##\s+🧠\s*Your Identity & Memory\s*$/gim, "## 🧠 身份与记忆"],
  [/^##\s+🎯\s*Your Core Mission\s*$/gim, "## 🎯 核心使命"],
  [/^##\s+🚨\s*Critical Rules You Must Follow\s*$/gim, "## 🚨 必须遵守的规则"],
  [/^##\s+📋\s*Your .+$/gim, (m) => m.replace(/Your /, "").replace(/Deliverables.*/, "交付物")],
  [/^##\s+🔄\s*Your Workflow Process\s*$/gim, "## 🔄 工作流程"],
  [/^##\s+💭\s*Your Communication Style\s*$/gim, "## 💭 沟通风格"],
  [/^##\s+🔄\s*Learning & Memory\s*$/gim, "## 🔄 学习与记忆"],
  [/^##\s+🎯\s*Your Success Metrics\s*$/gim, "## 🎯 成功标准"],
  [/^##\s+🚀\s*Advanced Capabilities\s*$/gim, "## 🚀 进阶能力"],
];

function parseBody(raw) {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return raw;
  return raw.slice(end + 4).replace(/^\s*\n/, "");
}

function translateProse(text) {
  let s = text;
  for (const [re, repl] of SECTION_RES) {
    if (typeof repl === "function") s = s.replace(re, repl);
    else s = s.replace(re, repl);
  }
  for (const [en, zh] of PHRASES) {
    s = s.split(en).join(zh);
  }
  // Common bullet role/personality lines
  s = s.replace(/\*\*Role\*\*:/g, "**角色**：");
  s = s.replace(/\*\*Personality\*\*:/g, "**性格**：");
  s = s.replace(/\*\*Memory\*\*:/g, "**记忆**：");
  s = s.replace(/\*\*Experience\*\*:/g, "**经验**：");
  s = s.replace(/\bRole\b:/g, "角色：");
  s = s.replace(/\bPersonality\b:/g, "性格：");
  s = s.replace(/\bMemory\b:/g, "记忆：");
  s = s.replace(/\bExperience\b:/g, "经验：");
  return s;
}

/**
 * For remaining English sentences, apply a lightweight clause translator
 * using word/phrase dictionary covering common agent-doc vocabulary.
 */
const WORDS = [
  ["specializing in", "专精于"],
  ["specializes in", "专精于"],
  ["focused on", "专注于"],
  ["focuses on", "专注于"],
  ["responsible for", "负责"],
  ["ensure that", "确保"],
  ["ensure ", "确保"],
  ["implement ", "实现"],
  ["Implement ", "实现"],
  ["create ", "创建"],
  ["Create ", "创建"],
  ["build ", "构建"],
  ["Build ", "构建"],
  ["design ", "设计"],
  ["Design ", "设计"],
  ["develop ", "开发"],
  ["Develop ", "开发"],
  ["maintain ", "维护"],
  ["Maintain ", "维护"],
  ["optimize ", "优化"],
  ["Optimize ", "优化"],
  ["validate ", "校验"],
  ["Validate ", "校验"],
  ["analyze ", "分析"],
  ["Analyze ", "分析"],
  ["provide ", "提供"],
  ["Provide ", "提供"],
  ["include ", "包含"],
  ["Include ", "包含"],
  ["across ", "跨"],
  ["through ", "通过"],
  ["with ", "与"],
  ["without ", "不带"],
  ["and ", "与"],
  ["or ", "或"],
  ["for ", "用于"],
  ["from ", "从"],
  ["into ", "进入"],
  ["that ", "，其"],
  ["which ", "，其"],
  ["when ", "当"],
  ["while ", "同时"],
  ["before ", "在…之前"],
  ["after ", "在…之后"],
  ["every ", "每个"],
  ["all ", "所有"],
  ["the ", ""],
  ["a ", ""],
  ["an ", ""],
  ["to ", "去"],
  ["of ", "的"],
  ["in ", "在"],
  ["on ", "在"],
  ["is ", "是"],
  ["are ", "是"],
  ["be ", ""],
  ["must ", "必须"],
  ["should ", "应当"],
  ["can ", "可以"],
  ["will ", "将"],
  ["don't ", "不要"],
  ["Do not ", "不要"],
  ["Never ", "绝不"],
  ["Always ", "始终"],
];

function softTranslateLine(line) {
  // Keep markdown structure / already Chinese-heavy lines
  if (!/[A-Za-z]{4,}/.test(line)) return line;
  if (/^\s*[|`#*\-\d]/.test(line) && line.includes("```")) return line;
  let out = line;
  // Only apply conservative phrase map already done; leave residual English
  // for the human-quality pass below via FULL_ZH overrides.
  return out;
}

function translateBody(body) {
  const fenceRe = /```[\s\S]*?```/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = fenceRe.exec(body))) {
    if (m.index > last) parts.push({ t: "text", v: body.slice(last, m.index) });
    parts.push({ t: "code", v: m[0] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ t: "text", v: body.slice(last) });

  return parts
    .map((p) => {
      if (p.t === "code") return p.v;
      return translateProse(p.v)
        .split("\n")
        .map(softTranslateLine)
        .join("\n");
    })
    .join("");
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [id, rel] of Object.entries(TARGETS)) {
  const existing = path.join(OUT_DIR, `${id}.md`);
  // Skip if a hand-translated full Chinese file already exists and is mostly Chinese
  if (fs.existsSync(existing)) {
    const cur = fs.readFileSync(existing, "utf8");
    const zh = (cur.match(/[\u4e00-\u9fff]/g) || []).length;
    const en = (cur.replace(/```[\s\S]*?```/g, "").match(/\b[A-Za-z]{4,}\b/g) || []).length;
    if (zh > 200 && zh > en * 0.5) {
      console.log("skip existing", id);
      continue;
    }
  }
  const raw = fs.readFileSync(path.join(CACHE, ...rel.split("/")), "utf8");
  const body = parseBody(raw);
  const zh = translateBody(body).trim() + "\n";
  fs.writeFileSync(existing, zh, "utf8");
  const zhc = (zh.match(/[\u4e00-\u9fff]/g) || []).length;
  const enc = (zh.replace(/```[\s\S]*?```/g, "").match(/\b[A-Za-z]{4,}\b/g) || []).length;
  console.log("wrote", id, "zh", zhc, "enWords", enc);
}
