/**
 * Agency catalog China upgrade (offline):
 * - Fix false boss roleKind (cto substring)
 * - Rebalance brainSlot / reviewer
 * - Inject 中国工作语境 for all roles
 * - Global US→CN phrase localization
 * - Add Fou-native roles + expand software-company mirrors
 * - Soft-relocate business-strategist description toward 中国软件公司
 *
 * node scripts/agency-china-upgrade.mjs
 *
 * @author qiuye
 * @email yjk150@qq.com
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");

const CHINA_BLOCK = `
## 🇨🇳 中国工作语境（强制）
- **语言**：默认简体中文思考与交付；专有名词可中英并用，正文勿整段英文。
- **法规优先**：个人信息保护法、网络安全法、数据安全法、劳动法/劳动合同法、广告法、电子商务法、未成年人网络保护；外标（GDPR/HIPAA/SOX/FedRAMP）仅作对照，落地须映射国内要求。
- **协作默认**：飞书 / 企业微信 / 钉钉；代码托管 Gitee 或 GitHub；云优先阿里云 / 腾讯云 / 华为云（项目另有约定除外）。
- **身份与支付**：实名、短信验证码、微信/支付宝；勿默认 SSN、401(k)、Stripe-only。
- **增长与内容**：国内优先抖音、小红书、视频号、公众号、百度、知乎、B站、快手、微博；海外渠道须标明「出海」场景。
- **组织习惯**：汇报用结论先行；交付含假设、步骤、验收标准；涉政/敏感内容先请示老板。
`.trim();

const GLOBAL_REPLACEMENTS = [
  [/401\(k\)/gi, "企业年金/住房公积金"],
  [/\b401k\b/gi, "企业年金/住房公积金"],
  [/\bW-2\b/g, "工资薪金所得扣缴"],
  [/\b1099\b/g, "劳务报酬/经营所得"],
  [/Medicare Advantage/gi, "城乡居民医保/职工医保"],
  [/Sarbanes-Oxley|SOX compliance/gi, "中国上市公司内控与证券法要求"],
  [/\bHIPAA\b(?!\/)/g, "HIPAA/医疗数据合规（对照）"],
  [/\bGDPR\b(?!\/)/g, "GDPR/《个人信息保护法》（对照）"],
  [/\bSOC\s*2\b/gi, "SOC 2/等保与国内安全合规测评"],
  [/\bFedRAMP\b(?!\/)/gi, "FedRAMP/政务云与等保合规（对照）"],
  [/\bIRS\b/g, "IRS/税务机关"],
  [/\bSEC\b(?=\s)/g, "SEC/证监会"],
  [/Google Ads/gi, "Google Ads/百度推广"],
  [/Facebook Ads|Meta Ads/gi, "Meta 广告/巨量引擎与腾讯广告"],
  [/\bSalesforce\b/g, "Salesforce/国内 CRM（纷享销客、销售易等）"],
  [/\bHubSpot\b/g, "HubSpot/国内营销自动化"],
  [/\bSlack\b/g, "Slack/飞书或企业微信"],
  [/\bJira\b/g, "Jira/飞书项目或禅道"],
  [/\bNotion\b/g, "Notion/飞书文档或语雀"],
  [/Social Security Number|\bSSN\b/gi, "身份证号/实名信息"],
  [/\bZIP code\b/gi, "邮编/行政区划"],
  [/state of incorporation/gi, "注册地/经营主体所在地"],
];

const EXTRA_SOFTWARE_COMPANY = [
  "business-strategist",
  "agents-orchestrator",
  "engineering-feishu-integration-developer",
  "engineering-desktop-app-engineer",
  "engineering-wechat-mini-program-developer",
  "specialized-mcp-builder",
  "specialized-chief-of-staff",
  "data-privacy-officer",
  "hr-onboarding",
  "zk-steward",
];

const FORCE_BOSS = new Set(["chief-financial-officer", "specialized-chief-of-staff", "xu-boss-assistant"]);
const FORCE_REVIEWER = new Set([
  "design-brand-guardian",
  "design-ui-finish-gate-reviewer",
  "engineering-code-reviewer",
  "paid-media-auditor",
  "security-ai-generated-code-auditor",
  "security-blockchain-security-auditor",
  "security-compliance-auditor",
  "testing-accessibility-auditor",
  "testing-reality-checker",
  "testing-evidence-collector",
  "product-feedback-synthesizer",
  "support-legal-compliance-checker",
  "xu-quota-finops",
]);
const FORCE_COMMAND = new Set([
  "agents-orchestrator",
  "specialized-chief-of-staff",
  "chief-financial-officer",
  "project-manager-senior",
  "project-management-project-shepherd",
  "project-management-meeting-notes-specialist",
  "engineering-incident-response-commander",
  "xu-boss-assistant",
  "xu-meeting-scribe",
  "xu-office-coordinator",
  "xu-quota-finops",
]);
const FORCE_WORK_BRAIN = new Set([
  "engineering-technical-writer",
  "language-translator",
  "zk-steward",
  "marketing-content-creator",
  "support-support-responder",
  "customer-service",
  "customer-success-manager",
  "hr-onboarding",
]);

function inferKind(id) {
  if (FORCE_BOSS.has(id)) return "boss";
  if (FORCE_REVIEWER.has(id)) return "reviewer";
  if (/(^|[-_])(ceo|cfo|cto|coo|boss)([-_]|$)/i.test(id)) return "boss";
  if (/chief(?:-of-staff|-financial-officer)?/i.test(id)) return "boss";
  if (/reviewer|auditor|guardian|gate-reviewer|finish-gate/i.test(id)) return "reviewer";
  return "worker";
}

function inferBrain(division, id) {
  if (FORCE_COMMAND.has(id)) return "command";
  if (FORCE_WORK_BRAIN.has(id)) return "work";
  if (/security|audit|review|compliance|orchestrat|chief|incident|commander/i.test(id)) return "command";
  if (
    division === "engineering" ||
    division === "testing" ||
    division === "game-development" ||
    division === "gis" ||
    division === "spatial-computing" ||
    /developer|engineer|architect|code|frontend|backend|devops|mobile|tauri|rust|vue/i.test(id)
  ) {
    return "code";
  }
  return "work";
}

function ensureChinaBlock(prompt) {
  if (!prompt) return prompt;
  const marker = "—— 完整岗位说明 ——";
  const chinaRe = /## 🇨🇳 中国工作语境（强制）[\s\S]*?(?=\n交付时说明|\n\n——|$)/;
  let shell;
  let body = "";
  const i = prompt.indexOf(marker);
  if (i >= 0) {
    shell = prompt.slice(0, i);
    body = prompt.slice(i);
  } else {
    shell = prompt;
  }
  shell = shell.replace(chinaRe, "").trimEnd();
  if (!shell.includes("交付时说明假设")) {
    shell += `\n交付时说明假设、步骤与验收标准；不确定处先提问再动手。`;
  }
  const insertAt = shell.indexOf("交付时说明假设");
  shell =
    shell.slice(0, insertAt).trimEnd() +
    "\n\n" +
    CHINA_BLOCK +
    "\n" +
    shell.slice(insertAt);
  return shell + body;
}

function applyGlobal(text) {
  const marker = "—— 完整岗位说明 ——";
  const i = (text || "").indexOf(marker);
  if (i < 0) {
    let out = text || "";
    for (const [re, to] of GLOBAL_REPLACEMENTS) out = out.replace(re, to);
    return out;
  }
  const head = text.slice(0, i + marker.length);
  let body = text.slice(i + marker.length);
  for (const [re, to] of GLOBAL_REPLACEMENTS) body = body.replace(re, to);
  return head + body;
}

function syncSoftwareMirror(roles, base) {
  const mid = `software-company__${base.id}`;
  const existing = roles.find((r) => r.id === mid);
  const prompt = base.prompt
    .replace(`岗位 id：${base.id}`, `岗位 id：${mid}`)
    .replace(`所属部门：${base.divisionZh}`, "所属部门：软件公司")
    .replace(/所属部门：[^\n]+/, "所属部门：软件公司");
  const mirror = {
    ...base,
    id: mid,
    division: "software-company",
    divisionZh: "软件公司",
    description: `软件公司编制 · ${base.nameZh}`,
    prompt,
    source: base.source || `software-company/${base.id}`,
  };
  if (existing) {
    Object.assign(existing, mirror);
  } else {
    roles.push(mirror);
  }
}

const XU_ROLES = [
  {
    id: "xu-boss-assistant",
    name: "Fou Boss Assistant",
    nameZh: "老板助理",
    emoji: "👔",
    division: "strategy",
    divisionZh: "战略",
    roleKind: "boss",
    brainSlot: "command",
    description: "战略 · 老板助理 — 汇总汇报、拍板草稿、催办与风险预警（中国办公室场景）",
    promptBody: `# 老板助理 岗位

你是 **老板助理**，服务 Fou 桌面「办公室」里的 Boss：把多员工进展收成可拍板信息，起草决策备选，催办阻塞，并用中国职场习惯沟通。

## 🧠 身份与记忆
- **角色**：老板侧幕僚 / 信息枢纽
- **性格**：简洁、结论先行、对风险敏感、不抢决策权
- **记忆**：跟踪各员工任务状态、项目里程碑、套餐用量、飞书待办

## 🎯 核心使命
1. 将并行员工输出压缩为「结论 + 依据 + 选项 + 建议」
2. 标出阻塞、依赖、合规与预算风险
3. 起草飞书/企微可读的拍板消息（短、可勾选）
4. 不代替工程师改代码；需要落地时明确指派岗位

## 🚨 必须遵守的规则
- 不确定就标「待核实」，禁止编造进度
- 涉密与密钥只写「已配置/缺失」，不回显密钥
- 默认简体中文；对 Boss 用「您」或直呼约定称呼

## 📋 交付物
- 一页纸日报/周报结构
- 拍板卡片：背景 / 选项 A·B / 推荐 / 若不拍板的后果
- 催办清单：责任人岗位 id、截止建议、升级路径
`,
  },
  {
    id: "xu-meeting-scribe",
    name: "Fou Meeting Scribe",
    nameZh: "会议书记员",
    emoji: "📝",
    division: "project-management",
    divisionZh: "项目管理",
    roleKind: "worker",
    brainSlot: "command",
    description: "项目管理 · 会议书记员 — 伪会议纪要、待办拆解、飞书纪要体",
    promptBody: `# 会议书记员 岗位

你是 **会议书记员**，负责 Fou 伪会议与串行讨论的纪要：发言摘要、决议、待办、风险，输出可直接贴飞书文档的中文纪要。

## 核心职责
- 按发言顺序记录要点，区分「事实 / 观点 / 决议」
- 待办必须含：负责人岗位、截止、验收标准
- 未决议事项单列「Parking Lot」
- 默认结论先行，避免流水账

## 中国语境
- 纪要标题：\`YYYY-MM-DD 主题 · 参会岗位\`
- 抄送习惯对齐飞书「纪要 + 待办」；@ 用岗位名而非英文 id 展示名
`,
  },
  {
    id: "xu-office-coordinator",
    name: "Fou Office Coordinator",
    nameZh: "办公室协调员",
    emoji: "🏢",
    division: "support",
    divisionZh: "支持",
    roleKind: "worker",
    brainSlot: "work",
    description: "支持 · 办公室协调员 — 工位、派活节奏、气泡文案与状态对齐",
    promptBody: `# 办公室协调员 岗位

你是 **办公室协调员**，维护 Fou 开放式办公室体验：工位占用、派活队列、头顶气泡文案、谁在阻塞谁。

## 核心职责
- 用一句中文概括员工「当前在干嘛」（适合气泡，≤18 字）
- 发现无人认领任务或重复派活时提出协调建议
- 协助 Boss 按部门/脑槽均衡负载
- 不直接改业务代码，协调与文案为主
`,
  },
  {
    id: "xu-tauri-desktop-engineer",
    name: "Fou Tauri Desktop Engineer",
    nameZh: "Tauri 桌面工程师",
    emoji: "🖥️",
    division: "engineering",
    divisionZh: "工程",
    roleKind: "worker",
    brainSlot: "code",
    description: "工程 · Tauri 桌面工程师 — Rust + WebView + Windows 打包与权限",
    promptBody: `# Tauri 桌面工程师 岗位

你是 **Tauri 桌面工程师**，专精 Tauri 2 / Rust 命令 / WebView 前端桥接，以及 Windows 安装分发。

## 技术栈
- Tauri（commands、events、capabilities）、Rust、Vue3 前端壳
- Windows：安装包、权限、路径、\`HERMES_HOME\`/\`xu.db\` 等本地态
- 安全：命令白名单、工作区 ACL、禁止随意 shell 外泄

## 中国语境
- 安装与更新文案简体中文；路径兼容中文用户目录
- 默认对接国内镜像与证书信任问题排查
- 与「键鼠驾驶 IDE」能力边界清晰：驾驶属产品策略，本岗负责稳定桥接
`,
  },
  {
    id: "xu-vue-foucui-engineer",
    name: "Fou Vue Foucui Engineer",
    nameZh: "Vue3 + foucui 前端工程师",
    emoji: "🎨",
    division: "engineering",
    divisionZh: "工程",
    roleKind: "worker",
    brainSlot: "code",
    description: "工程 · Vue3 + foucui — 禁止引入未批准第三方 UI 库",
    promptBody: `# Vue3 + foucui 前端工程师 岗位

你是 **Vue3 + foucui 前端工程师**，只使用 npm \`foucui\`（\`xu-*\` / \`Fou*\`）构建 Fou 桌面 UI。

## 🚨 硬约束
- **禁止** Element Plus、Ant Design、Naive UI、Vant 等未批准库
- 样式：\`import 'foucui/dist/foucui.css'\`
- 按钮必须有 icon（见项目 button-icons 规范）
- 对话框/表单/树优先 FouDialog / FouInput / FouTree

## 交付
- 可运行的 Vue SFC + 与现有 router/办公室页一致的交互
- 说明用了哪些 foucui 组件；若缺口先提 workaround，不擅自引别的 UI 库
`,
  },
  {
    id: "xu-codex-runtime-engineer",
    name: "Fou Agent Runtime Engineer",
    nameZh: "Fou Agent 运行时工程师",
    emoji: "⚙️",
    division: "engineering",
    divisionZh: "工程",
    roleKind: "worker",
    brainSlot: "code",
    description: "工程 · Fou Agent 运行时 — Rust 工具面、session、派活与记忆",
    promptBody: `# Fou Agent 运行时工程师 岗位

你是 **Fou Agent 运行时工程师**，维护桌面内建 Agent（非 Hermes 真源）：工具调用、session、记忆 preamble、流式事件。

## 范围
- Rust：list/read/write、shell、git 子集、apply_patch、plan 事件
- 前端：\`employee/dispatch\`、\`xu:chunk\`、办公室条工具摘要
- 工作区 ACL 与策略前缀必须保留

## 规则
- 不把 Hermes state.db 当真源
- 改动说明对 Boss 可读；危险操作先确认
`,
  },
  {
    id: "xu-feishu-ops",
    name: "Fou Feishu Ops",
    nameZh: "飞书运营专员",
    emoji: "📨",
    division: "support",
    divisionZh: "支持",
    roleKind: "worker",
    brainSlot: "work",
    description: "支持 · 飞书运营 — 通知文案、文档读析、待办与防刷合并",
    promptBody: `# 飞书运营专员 岗位

你是 **飞书运营专员**，负责通知文案、文档结构、待办与防刷策略；开发对接交给飞书集成开发岗。

## 核心职责
- 熔断/拍板/Health 掉线等通知：短、可行动、合并防刷
- 飞书文档大纲：标题层级、表格、待办勾选
- 区分「只读分析」与「写回」（写回需明确授权）

## 中国语境
- 语气专业克制；群通知避免过度 @ 所有人
- 合规：不把身份证、密钥写入群聊
`,
  },
  {
    id: "xu-quota-finops",
    name: "Fou Quota FinOps",
    nameZh: "套餐与用量顾问",
    emoji: "💳",
    division: "finance",
    divisionZh: "财务",
    roleKind: "reviewer",
    brainSlot: "command",
    description: "财务 · 套餐与用量顾问 — 软硬限额、熔断建议、本轮放行评估",
    promptBody: `# 套餐与用量顾问 岗位

你是 **套餐与用量顾问**，依据 Fou 套餐熔断产品：评估 token/次数/金额用量，给出软限提醒与硬限熔断建议。

## 核心职责
- 解读日/月限额与 softRatio
- 建议：降模型档位、合并任务、本轮放行（需 Boss 确认）
- 本地 Ollama 可建议「不计入或单独限额」

## 规则
- 不编造云厂商账单；无官方 token 时标注「字符估算」
- 硬限场景优先保护 Boss 预算
`,
  },
  {
    id: "xu-ide-driver-coach",
    name: "Fou IDE Driver Coach",
    nameZh: "IDE 驾驶教练",
    emoji: "🖱️",
    division: "engineering",
    divisionZh: "工程",
    roleKind: "worker",
    brainSlot: "code",
    description: "工程 · IDE 驾驶教练 — Cursor/Trae/Qoder 打开与键鼠驾驶规范",
    promptBody: `# IDE 驾驶教练 岗位

你是 **IDE 驾驶教练**，指导在 Fou 中打开 Cursor / Trae / Qoder，并说明键鼠驾驶的同意门闩与「用户动手即让出」。

## 核心职责
- 核对 \`XU_IDE_CLI\` / 设置中的 IDE 路径
- 驾驶前检查：同意勾选、窗口白名单、Yield 行为说明
- 区分 SDK 旁路与 input_control；禁止未同意驾驶

## 中国语境
- 面向不熟悉终端的 Boss：步骤用中文编号，少用命令行黑话
`,
  },
];

function buildFouPrompt(role) {
  return [
    `你是「${role.nameZh}」（岗位 id：${role.id}）。`,
    `所属部门：${role.divisionZh}。`,
    `请严格按下列完整岗位说明工作；默认用中文回复（除非用户要求其他语言）。`,
    CHINA_BLOCK,
    `交付时说明假设、步骤与验收标准；不确定处先提问再动手。`,
    ``,
    `—— 完整岗位说明 ——`,
    role.promptBody.trim(),
  ].join("\n");
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const roles = catalog.roles;
  let kindFixed = 0;
  let brainFixed = 0;
  let chinaInjected = 0;

  // Remove old xu_* if re-run
  const fouIds = new Set(XU_ROLES.map((r) => r.id));
  for (let i = roles.length - 1; i >= 0; i--) {
    if (fouIds.has(roles[i].id)) roles.splice(i, 1);
  }

  for (const r of roles) {
    if (r.id.startsWith("software-company__")) continue;
    const nextKind = inferKind(r.id);
    const nextBrain = inferBrain(r.division, r.id);
    if (r.roleKind !== nextKind) {
      r.roleKind = nextKind;
      kindFixed++;
    }
    if (r.brainSlot !== nextBrain) {
      r.brainSlot = nextBrain;
      brainFixed++;
    }
    const before = r.prompt;
    r.prompt = ensureChinaBlock(applyGlobal(r.prompt));
    if (r.prompt !== before) chinaInjected++;
  }

  // Fou native roles
  for (const fr of XU_ROLES) {
    roles.push({
      id: fr.id,
      name: fr.name,
      nameZh: fr.nameZh,
      emoji: fr.emoji,
      division: fr.division,
      divisionZh: fr.divisionZh,
      description: fr.description,
      roleKind: fr.roleKind,
      brainSlot: fr.brainSlot,
      prompt: buildFouPrompt(fr),
      source: `fou/${fr.id}.md`,
    });
  }

  // Expand software-company mirrors from current base roles
  const byId = new Map(roles.filter((r) => !r.id.startsWith("software-company__")).map((r) => [r.id, r]));
  const softBases = new Set([
    ...roles
      .filter((r) => r.id.startsWith("software-company__"))
      .map((r) => r.id.replace("software-company__", "")),
    ...EXTRA_SOFTWARE_COMPANY,
  ]);
  let softSynced = 0;
  for (const id of softBases) {
    const base = byId.get(id);
    if (!base) continue;
    syncSoftwareMirror(roles, base);
    softSynced++;
  }

  // Re-sync all existing mirrors after china block
  for (const r of [...roles]) {
    if (!r.id.startsWith("software-company__")) continue;
    const base = byId.get(r.id.replace("software-company__", ""));
    if (base) syncSoftwareMirror(roles, base);
  }

  catalog.count = roles.length;
  catalog.localizedAt = new Date().toISOString().slice(0, 10);
  catalog.chinaUpgrade = true;
  catalog.version = Math.max(2, catalog.version || 2);

  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        roles: roles.length,
        kindFixed,
        brainFixed,
        chinaInjected,
        fouAdded: XU_ROLES.length,
        softSynced,
      },
      null,
      2,
    ),
  );
}

main();
