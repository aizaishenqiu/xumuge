/**
 * Offline structural Chinese-ization of agency prompts (no network).
 * - Keeps full body (never truncates)
 * - Translates section headers + common phrases via glossary
 * - Adds Chinese instruction shell; strips 参考来源
 *
 * node scripts/zh-gloss-agency.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/office/agencyCatalog.generated.json");

const HEADER = [
  [/^#\s+(.+?)\s+Agent Personality\s*$/gim, "# $1 岗位人设"],
  [/^##\s+[^\n]*Identity & Memory\s*$/gim, "## 🧠 身份与记忆"],
  [/^##\s+[^\n]*Core Mission\s*$/gim, "## 🎯 核心使命"],
  [/^##\s+[^\n]*Critical Rules[^\n]*$/gim, "## 🚨 必须遵守的规则"],
  [/^##\s+[^\n]*Technical Deliverables\s*$/gim, "## 📋 技术交付物"],
  [/^##\s+[^\n]*Workflow Process\s*$/gim, "## 🔄 工作流程"],
  [/^##\s+[^\n]*Communication Style\s*$/gim, "## 💭 沟通风格"],
  [/^##\s+[^\n]*Learning & Memory\s*$/gim, "## 🔄 学习与记忆"],
  [/^##\s+[^\n]*Success Metrics\s*$/gim, "## 🎯 成功标准"],
  [/^##\s+[^\n]*Advanced Capabilities\s*$/gim, "## 🚀 进阶能力"],
  [/^###\s+/gm, "### "],
];

const GLOSS = [
  [/You are\s+\*\*(.+?)\*\*/g, "你是 **$1**"],
  [/\bRole\b:/g, "角色："],
  [/\bPersonality\b:/g, "性格："],
  [/\bMemory\b:/g, "记忆："],
  [/\bExperience\b:/g, "经验："],
  [/\bDefault requirement\b:/gi, "默认要求："],
  [/\bYour Core Mission\b/g, "核心使命"],
  [/\bCritical Rules You Must Follow\b/g, "必须遵守的规则"],
  [/\bTechnical Deliverables\b/g, "技术交付物"],
  [/\bWorkflow Process\b/g, "工作流程"],
  [/\bCommunication Style\b/g, "沟通风格"],
  [/\bSuccess Metrics\b/g, "成功标准"],
  [/\bAdvanced Capabilities\b/g, "进阶能力"],
  [/\bIdentity & Memory\b/g, "身份与记忆"],
  [/\bmust\b/gi, "必须"],
  [/\bshould\b/gi, "应当"],
  [/\bnever\b/gi, "绝不"],
  [/\balways\b/gi, "始终"],
  [/\bWhen\b/g, "当"],
  [/\bIf\b/g, "如果"],
  [/\bDo not\b/g, "不要"],
  [/\bDon't\b/g, "不要"],
  [/参考来源：https?:\/\/[^\s]+/g, ""],
];

function glossBody(body) {
  let s = body;
  for (const [re, to] of HEADER) s = s.replace(re, to);
  for (const [re, to] of GLOSS) s = s.replace(re, to);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function rebuildPrompt(r) {
  const marker = "—— 完整岗位说明 ——";
  let body = r.prompt.includes(marker)
    ? r.prompt.slice(r.prompt.indexOf(marker) + marker.length)
    : r.prompt;
  body = glossBody(body);
  return [
    `你是「${r.nameZh || r.name}」（岗位 id：${r.id}）。`,
    `所属部门：${r.divisionZh || r.division}。`,
    `请严格按下列完整岗位说明工作；默认用中文回复（除非用户要求其他语言）。`,
    `下列说明含完整能力、规则、交付物与流程（由英文原版完整导入并做了中文结构本地化）；执行时用中文思考与输出。`,
    `交付时说明假设、步骤与验收标准；不确定处先提问再动手。`,
    ``,
    marker,
    body,
  ].join("\n");
}

const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
for (const r of data.roles) {
  r.prompt = rebuildPrompt(r).replace(/参考来源：https?:\/\/[^\s]+/g, "");
}
data.glossAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("glossed", data.roles.length);
