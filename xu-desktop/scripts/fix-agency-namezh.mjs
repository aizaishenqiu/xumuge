/**
 * Fill English-only nameZh from scripts/localize-agency-catalog.mjs NAME_ZH map.
 * Does not rewrite prompts.
 * node scripts/fix-agency-namezh.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");
const LOCALIZE = path.join(ROOT, "scripts/localize-agency-catalog.mjs");

// Extract NAME_ZH object by evaluating the map section
const src = fs.readFileSync(LOCALIZE, "utf8");
const m = src.match(/const NAME_ZH = \{([\s\S]*?)\n\};/);
if (!m) throw new Error("NAME_ZH not found");
const NAME_ZH = new Function(`return {${m[1]}\n}`)();

function titleCaseKey(name) {
  return String(name || "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

function lookup(name, id) {
  if (NAME_ZH[name]) return NAME_ZH[name];
  const tc = titleCaseKey(name);
  if (NAME_ZH[tc]) return NAME_ZH[tc];
  // from id: design-ui-designer -> Ui Designer / UI Designer
  const fromId = titleCaseKey((id || "").replace(/^software-company__/, "").replace(/^[a-z]+-/, ""));
  if (NAME_ZH[fromId]) return NAME_ZH[fromId];
  // try full id slug words after first segment
  const parts = (id || "").replace(/^software-company__/, "").split("-");
  for (let i = 1; i < Math.min(parts.length, 4); i++) {
    const key = titleCaseKey(parts.slice(i).join("-"));
    if (NAME_ZH[key]) return NAME_ZH[key];
  }
  // manual extras for remaining
  const EXTRA = {
    "UI Designer": "UI 设计师",
    "UX Architect": "UX 架构师",
    "UX Researcher": "UX 研究员",
    "Persona Walkthrough Specialist": "用户画像走查专家",
    "AI Data Remediation Engineer": "AI 数据治理工程师",
    "AI Engineer": "AI 工程师",
    "API Platform Engineer": "API 平台工程师",
    "CMS Developer": "CMS 开发",
    "DevOps Automator": "运维自动化工程师",
    "Drupal Performance Engineer": "Drupal 性能工程师",
    "Drupal Shopping Cart Engineer": "Drupal 购物车工程师",
    "FinOps Engineer": "云成本工程师",
    "GaussDB Expert Engineer": "GaussDB 专家",
    "Internationalization Engineer": "国际化工程师",
    "USWDS Developer": "USWDS 开发",
    "Voice AI Integration Engineer": "语音 AI 集成工程师",
    "WebAssembly Engineer": "WebAssembly 工程师",
    "WeChat Mini Program Developer": "微信小程序开发",
    "WordPress Performance Engineer": "WordPress 性能工程师",
    "WordPress Shopping Cart Engineer": "WordPress 购物车工程师",
    "Godot Gameplay Scripter": "Godot 玩法脚本",
    "Godot Multiplayer Engineer": "Godot 联机工程师",
    "Godot Shader Developer": "Godot 着色器开发",
    "Roblox Avatar Creator": "Roblox 形象创作",
    "Roblox Experience Designer": "Roblox 体验设计",
    "Roblox Systems Scripter": "Roblox 系统脚本",
    "Unity Architect": "Unity 架构师",
    "Unity Editor Tool Developer": "Unity 编辑器工具开发",
    "Unity Multiplayer Engineer": "Unity 联机工程师",
    "Unity Shader Graph Artist": "Unity Shader Graph 美术",
    "Unreal Multiplayer Architect": "Unreal 联机架构师",
    "Unreal Systems Engineer": "Unreal 系统工程师",
    "Unreal Technical Artist": "Unreal 技术美术",
    "Unreal World Builder": "Unreal 世界搭建",
    "GIS Analyst": "GIS 分析师",
    "BIM/GIS Specialist": "BIM/GIS 专家",
    "Drone/Reality Mapping Specialist": "无人机实景测绘专家",
    "GeoAI/ML Engineer": "地理 AI/机器学习工程师",
    "GIS QA Engineer": "GIS 质量工程师",
    "Web GIS Developer": "Web GIS 开发",
    "Healthcare Innovation Strategist": "医疗创新策略师",
    "AEO Foundations Architect": "答案引擎优化基础架构师",
    "AI Citation Strategist": "AI 引用策略师",
    "Baidu SEO Specialist": "百度 SEO 专家",
    "Email Marketing Strategist": "邮件营销策略师",
    "LinkedIn Content Creator": "LinkedIn 内容创作者",
    "SEO Specialist": "SEO 专家",
    "TikTok Strategist": "TikTok 策略师",
    "WeChat Official Account Manager": "微信公众号运营",
    "X/Twitter Intelligence Analyst": "X/Twitter 情报分析",
    "Paid Media Auditor": "付费媒介审计师",
    "Ad Creative Strategist": "广告创意策略师",
    "PPC Campaign Strategist": "PPC 投放策略师",
    "Product Manager": "产品经理",
    "Senior Project Manager": "高级项目经理",
    "Sales Coach": "销售教练",
    "Application Security Engineer": "应用安全工程师",
    "Senior SecOps Engineer": "高级安全运维工程师",
    "macOS Spatial/Metal Engineer": "macOS 空间/Metal 工程师",
    "XR Cockpit Interaction Specialist": "XR 座舱交互专家",
    "XR Immersive Developer": "XR 沉浸式开发",
    "XR Interface Architect": "XR 界面架构师",
    "Healthcare Customer Service": "医疗客户服务",
    "Healthcare Marketing Compliance Specialist": "医疗营销合规专家",
    "HR Onboarding": "入职培训专员",
    "LSP/Index Engineer": "LSP/索引工程师",
    "Sales Data Extraction Agent": "销售数据抽取专员",
    "Sales Outreach": "销售外拓",
    "Chief of Staff": "幕僚长",
    "French Consulting Market Navigator": "法国咨询市场导航",
    "MCP Builder": "MCP 构建师",
    "Model QA Specialist": "模型质量专员",
    "ZK Steward": "ZK 管理员",
    "API Tester": "API 测试工程师",
  };
  if (EXTRA[name]) return EXTRA[name];
  return null;
}

const c = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
let n = 0;
for (const r of c.roles) {
  const zh = r.nameZh || "";
  const englishOnly = zh && /^[\x00-\x7F]+$/.test(zh) && /[A-Za-z]{3}/.test(zh);
  if (!englishOnly) continue;
  const next = lookup(zh, r.id) || lookup(r.name, r.id);
  if (next && next !== zh) {
    r.nameZh = next;
    // keep description first segment in sync lightly
    if (r.description && r.description.includes(zh)) {
      r.description = r.description.replace(zh, next);
    }
    n++;
    console.log(r.id, "->", next);
  } else {
    console.log("MISS", r.id, zh);
  }
}
fs.writeFileSync(CATALOG, JSON.stringify(c, null, 2) + "\n");
console.log("fixed", n);
