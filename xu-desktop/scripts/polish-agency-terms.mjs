/**
 * Hand-polish high-frequency MT terms across agency departments.
 * Writes back to agencyCatalog.generated.json (incl. software-company mirrors).
 *
 * node scripts/polish-agency-terms.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");

/** Order matters: longer / more specific first. */
const TERM_REPLACEMENTS = [
  // Marketing / growth
  [/\bcall to action\b/gi, "行动号召（CTA）"],
  [/\bcalls to action\b/gi, "行动号召（CTA）"],
  [/\bclick[- ]through rate\b/gi, "点击率（CTR）"],
  [/\bconversion rate\b/gi, "转化率"],
  [/\blanding pages?\b/gi, "落地页"],
  [/\bgo[- ]to[- ]market\b/gi, "上市/投放打法（GTM）"],
  [/\bvalue proposition\b/gi, "价值主张"],
  [/\bbrand voice\b/gi, "品牌调性"],
  [/\bcontent calendar\b/gi, "内容排期表"],
  [/\baudience segmentation\b/gi, "受众分层"],
  [/\buser[- ]generated content\b/gi, "用户生成内容（UGC）"],
  [/\bsearch engine optimization\b/gi, "搜索引擎优化（SEO）"],
  [/\bpay[- ]per[- ]click\b/gi, "点击计费广告（PPC）"],
  [/\bcost per acquisition\b/gi, "获客成本（CPA）"],
  [/\breturn on ad spend\b/gi, "广告支出回报（ROAS）"],
  [/\bA\/B testing\b/gi, "A/B 测试"],
  // Product / PM
  [/\bproduct roadmap\b/gi, "产品路线图"],
  [/\buser stories?\b/gi, "用户故事"],
  [/\bacceptance criteria\b/gi, "验收标准"],
  [/\bmvps?\b/gi, "最小可行产品（MVP）"],
  [/\bbacklog grooming\b/gi, "需求梳理"],
  [/\bsprint planning\b/gi, "迭代计划"],
  [/\bdefinition of done\b/gi, "完成定义（DoD）"],
  [/\bwireframes?\b/gi, "线框图"],
  [/\bmockups?\b/gi, "视觉稿"],
  [/\bpersonas?\b/gi, "用户画像"],
  // Engineering
  [/\bcode review\b/gi, "代码评审"],
  [/\bpull requests?\b/gi, "合并请求（PR）"],
  [/\bmerge requests?\b/gi, "合并请求"],
  [/\bcontinuous integration\b/gi, "持续集成（CI）"],
  [/\bcontinuous deployment\b/gi, "持续部署（CD）"],
  [/\btech debt\b/gi, "技术债"],
  [/\btechnical debt\b/gi, "技术债"],
  [/\bunit tests?\b/gi, "单元测试"],
  [/\bintegration tests?\b/gi, "集成测试"],
  [/\bend[- ]to[- ]end tests?\b/gi, "端到端测试"],
  [/\bregression tests?\b/gi, "回归测试"],
  [/\brefactors?\b/gi, "重构"],
  [/\bdesign patterns?\b/gi, "设计模式"],
  [/\bAPI endpoints?\b/gi, "接口端点"],
  [/\brate limiting\b/gi, "限流"],
  [/\bobservability\b/gi, "可观测性"],
  [/\bmonorepos?\b/gi, "单体仓库（monorepo）"],
  // Security / compliance
  [/\blegal review\b/gi, "法务审阅"],
  [/\bcompliance checklist\b/gi, "合规检查清单"],
  [/\brisk assessment\b/gi, "风险评估"],
  [/\bterms of service\b/gi, "服务条款"],
  [/\bprivacy policy\b/gi, "隐私政策"],
  [/\bdata subject rights?\b/gi, "个人信息主体权利"],
  [/\bpersonal data\b/gi, "个人信息"],
  [/\bpersonally identifiable information\b/gi, "个人身份信息（PII）"],
  [/\bnon[- ]disclosure agreement\b/gi, "保密协议（NDA）"],
  [/\bintellectual property\b/gi, "知识产权"],
  [/\bthreat model(?:ling)?\b/gi, "威胁建模"],
  [/\bpenetration test(?:ing)?\b/gi, "渗透测试"],
  [/\bvulnerability assessment\b/gi, "漏洞评估"],
  [/\bleast privilege\b/gi, "最小权限"],
  [/\baccess control\b/gi, "访问控制"],
  [/\bincident response\b/gi, "应急响应"],
  // Sales / finance / support
  [/\bpipeline management\b/gi, "销售漏斗管理"],
  [/\baccount management\b/gi, "客户成功/客户管理"],
  [/\bquota attainment\b/gi, "业绩达成"],
  [/\bcash flow\b/gi, "现金流"],
  [/\bprofit and loss\b/gi, "损益"],
  [/\bP&L\b/g, "损益（P&L）"],
  [/\bcustomer support\b/gi, "客户支持"],
  [/\bsla\b/gi, "服务级别协议（SLA）"],
  [/\bknowledge base\b/gi, "知识库"],
  // Design / testing / general
  [/\bdesign system\b/gi, "设计系统"],
  [/\baccessibility\b/gi, "无障碍"],
  [/\busability testing\b/gi, "可用性测试"],
  [/\btest cases?\b/gi, "测试用例"],
  [/\btest plans?\b/gi, "测试计划"],
  [/\bbug reports?\b/gi, "缺陷报告"],
  [/\bkey performance indicators?\b/gi, "关键绩效指标（KPI）"],
  [/\bstakeholders?\b/gi, "干系人"],
  [/\bdeliverables?\b/gi, "交付物"],
  [/\bbest practices?\b/gi, "最佳实践"],
  [/\baction items?\b/gi, "待办事项"],
  [/\bfollow[- ]ups?\b/gi, "跟进事项"],
  [/\bstatus updates?\b/gi, "状态同步"],
  // Soft MT fillers (conservative)
  [/\bwhen in doubt\b/gi, "存疑时"],
  [/\bmake sure to\b/gi, "务必"],
  [/\balways remember\b/gi, "务必牢记"],
];

/** All catalog roles with a prompt are in scope (incl. mirrors). */
function shouldPolish(role) {
  return Boolean(role?.prompt && String(role.prompt).length > 40);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
let touched = 0;
let replacements = 0;
const byDiv = {};

for (const role of catalog.roles) {
  if (!shouldPolish(role)) continue;
  let next = role.prompt;
  let local = 0;
  for (const [re, to] of TERM_REPLACEMENTS) {
    const before = next;
    next = next.replace(re, to);
    if (next !== before) {
      const matches = before.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`));
      local += matches ? matches.length : 1;
    }
  }
  if (next !== role.prompt) {
    role.prompt = next;
    touched += 1;
    replacements += local;
    const d = role.division || "?";
    byDiv[d] = (byDiv[d] || 0) + 1;
  }
}

catalog.localizedAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ touched, replacements, byDiv, roles: catalog.roles.length }, null, 2));
