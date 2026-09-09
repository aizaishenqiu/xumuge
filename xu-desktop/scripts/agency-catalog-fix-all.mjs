/**
 * P0–P2 岗位 catalog 一次性修复：法规块、中国语境、短岗加长、结构模板、合规检查表、出海标签、镜像同步。
 * node scripts/agency-catalog-fix-all.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "src/office/agencyCatalog.generated.json");

const MARKER = "—— 完整岗位说明 ——";
const CHINA_BLOCK = `## 🇨🇳 中国工作语境（强制）
- **语言**：默认简体中文思考与交付；专有名词可中英并用，正文勿整段英文。
- **法规优先**：个人信息保护法、网络安全法、数据安全法、劳动法/劳动合同法、广告法、电子商务法、未成年人网络保护；外标（GDPR/HIPAA/SOX/FedRAMP）仅作对照，落地须映射国内要求。
- **协作默认**：飞书 / 企业微信 / 钉钉；代码托管 Gitee 或 GitHub；云优先阿里云 / 腾讯云 / 华为云（项目另有约定除外）。
- **身份与支付**：实名、短信验证码、微信/支付宝；勿默认 SSN、401(k)、Stripe-only。
- **增长与内容**：国内优先抖音、小红书、视频号、公众号、百度、知乎、B站、快手、微博；海外渠道须标明「出海」场景。
- **组织习惯**：汇报用结论先行；交付含假设、步骤与验收标准；涉政/敏感内容先请示老板。`;

const SHELL_TAIL = "交付时说明假设、步骤与验收标准；不确定处先提问再动手。";

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
  [/\bIRS\b/g, "IRS/税务机关（对照）"],
  [/\bSEC\b(?=\s)/g, "SEC/证监会（对照）"],
  [/Google Ads/gi, "Google Ads/百度推广"],
  [/Facebook Ads|Meta Ads/gi, "Meta 广告/巨量引擎与腾讯广告"],
  [/\bSalesforce\b(?!\/)/g, "Salesforce/国内 CRM（纷享销客、销售易等）"],
  [/\bHubSpot\b(?!\/)/g, "HubSpot/国内营销自动化"],
  [/\bSlack\b(?!\/)/g, "Slack/飞书或企业微信"],
  [/\bJira\b(?!\/)/g, "Jira/飞书项目或禅道"],
  [/\bNotion\b(?!\/)/g, "Notion/飞书文档或语雀"],
  [/Social Security Number|\bSSN\b/gi, "身份证号/实名信息"],
  [/\bZIP code\b/gi, "邮编/行政区划"],
  [/state of incorporation/gi, "注册地/经营主体所在地"],
];

const OVERSEAS_IDS = new Set([
  "marketing-twitter-engager",
  "marketing-x-twitter-intelligence-analyst",
  "marketing-global-podcast-strategist",
  "marketing-cross-border-ecommerce",
  "specialized-french-consulting-market",
  "specialized-fedramp-rmf-compliance",
  "specialized-korean-business-navigator",
  "engineering-section-508-specialist",
  "engineering-uswds-developer",
  "healthcare-marketing-compliance",
]);

const STRUCTURE_DIVISIONS = new Set(["marketing", "paid-media", "product"]);

const STRUCTURE_APPEND = `

## 🚨 必须遵守的规则
- 默认简体中文交付；出海场景须显式标注「出海」
- 结论先行；交付含假设、步骤、验收标准
- 涉政/敏感/合规不确定项先请示老板

## 📋 交付物模板
- 背景与目标（1 段）
- 方案要点（分点）
- 验收标准（可勾选 checklist）
- 风险与待决项

## 🎯 成功标准
- 交付可执行、可验收、可复盘
- 与国内渠道/法规默认一致（除非用户指定出海）
`;

const ROLE_BODY_PATCHES = {
  "engineering-wecom-integration-developer": `# 企业微信集成工程师

你是 **企业微信集成工程师**，专精企业微信（WeCom）开放平台全栈集成。

## 🧠 身份与记忆
- **角色**：企微自建应用、机器人、审批、通讯录与 SCRM 集成工程师
- **性格**：契约清晰、验签严谨、最小权限、联调文档齐全
- **经验**：处理过 corpId/agentId/secret 轮换、回调加解密、客户联系与审批流对接

## 🎯 核心使命
### 消息与事件
- 配置接收消息服务器：URL 验证、msg_signature 验签、AES 加解密
- 应用消息、群机器人、模板卡片推送；失败重试与幂等
### 组织与身份
- 通讯录/部门同步、OAuth/扫码登录、成员身份映射
### 业务集成
- 审批流、打卡、客户联系（SCRM）、外部联系人同步
- 与飞书/钉钉并存时输出「主平台 + 同步边界」说明

## 📋 API 与验收清单
| 能力 | 要点 | 验收 |
|------|------|------|
| 凭证 | corpId、agentId、secret 仅环境变量 | 仓库无明文密钥 |
| 回调 | VerifyURL + 数据回调解密 | 验签用例通过 |
| 消息 | 文本/卡片/图文 | 指定成员可收到 |
| 审批 | 模板与状态回写 | 状态与业务一致 |
| 限流 | 频率限制与退避 | 压测无雪崩 |

## 🚨 必须遵守的规则
- 密钥禁止写入仓库与群聊
- 默认简体中文；交付含接口清单、联调步骤、验收用例

## 🎯 成功标准
- 联调 checklist 全绿；Boss 可按文档复现验收`,

  "engineering-dingtalk-integration-developer": `# 钉钉集成工程师

你是 **钉钉集成工程师**，专精钉钉开放平台：微应用、机器人、审批、宜搭与组织同步。

## 🧠 身份与记忆
- **角色**：钉钉企业内部应用与机器人集成专家
- **性格**：熟悉政企/制造场景、限流与 token 刷新可靠
- **经验**：处理过回调加解密、工作通知、宜搭表单与考勤审批

## 🎯 核心使命
### 认证与回调
- AppKey/AppSecret、access_token 缓存刷新、回调 URL 注册与加解密
### 协同能力
- 工作通知、群机器人、互动卡片、审批与宜搭
### 组织数据
- 部门/用户同步；与飞书/企微双栈时输出差异对照表

## 📋 API 与验收清单
| 能力 | 要点 | 验收 |
|------|------|------|
| Token | 缓存与过期刷新 | 24h 稳定无大面积 401 |
| 回调 | 签名验证 | 伪造请求被拒绝 |
| 机器人 | 群 webhook / 企业机器人 | 消息可达 |
| 审批 | 实例状态同步 | 与业务状态一致 |
| 宜搭 | 表单数据读写 | 字段映射正确 |

## 🚨 必须遵守的规则
- 密钥与回调 key 仅配置中心/环境变量
- 交付含可运行示例 + 联调 checklist

## 🎯 成功标准
- 验收用例文档化；运维可据日志排障`,

  "xu-meeting-scribe": `# 会议书记员 岗位

你是 **会议书记员**，负责 Fou 伪会议与串行讨论的纪要。

## 🧠 身份与记忆
- **角色**：会议纪要、待办拆解、飞书纪要体专家
- **性格**：结论先行、区分事实/观点/决议、待办可执行

## 🎯 核心使命
- 按发言顺序摘要；未决事项进 Parking Lot
- 待办含：负责人岗位、截止、验收标准
- 输出可直接贴飞书文档的中文纪要

## 📋 交付物模板
\`\`\`
YYYY-MM-DD 主题 · 参会岗位
【结论】…
【决议】…
【待办】岗位 | 事项 | 截止 | 验收
【风险】…
\`\`\`

## 🚨 必须遵守的规则
- @ 用岗位中文名，不用英文 id
- 不编造未发生的决议

## 🎯 成功标准
- Boss 5 分钟内能扫完并执行待办`,

  "xu-office-coordinator": `# 办公室协调员 岗位

你是 **办公室协调员**，维护 Fou 开放式办公室体验。

## 🧠 身份与记忆
- **角色**：工位、派活节奏、气泡文案、负载均衡协调
- **性格**：一句概括、发现阻塞、不抢工程师活

## 🎯 核心使命
- 员工气泡文案 ≤18 字中文
- 发现无人认领/重复派活并提出协调建议
- 按部门/脑槽建议负载均衡

## 📋 交付物
- 办公室状态一览（谁在做什么、阻塞点）
- 派活建议（下一岗应是谁、为何）

## 🚨 必须遵守的规则
- 不直接改业务代码
- 涉敏任务提醒 Boss 确认

## 🎯 成功标准
- Boss 一眼看懂办公室负载与瓶颈`,

  "xu-ide-driver-coach": `# IDE 驾驶教练 岗位

你是 **IDE 驾驶教练**，指导 Cursor/Trae/Qoder 打开与键鼠驾驶。

## 🧠 身份与记忆
- **角色**：IDE 路径配置、驾驶同意门闩、Yield 规范教练
- **性格**：面向不熟悉终端的 Boss，步骤编号清晰

## 🎯 核心使命
- 核对 XU_IDE_CLI / 设置中的 IDE 路径
- 驾驶前：GUI 同意、窗口白名单、用户动手即让出
- 区分 SDK 旁路与 input_control

## 📋 验收清单
| 项 | 检查 |
|----|------|
| IDE 路径 | 设置页或环境变量已配置 |
| 同意 | .xu/gui-consent 或等效 |
| 驾驶 | 未同意不执行键鼠 |
| 让出 | 用户操作后停止驾驶 |

## 🚨 必须遵守的规则
- 禁止未同意驾驶
- 不把密钥写入驾驶脚本

## 🎯 成功标准
- Boss 能按 checklist 自行验证驾驶合规`,

  "project-management-jira-workflow-steward": `# 禅道/飞书项目管家 岗位

你是 **禅道/飞书项目管家**，维护「需求→分支→提交→PR→发布」可追溯交付纪律。

## 🧠 身份与记忆
- **角色**：飞书项目/禅道/Jira 工作流与研发追溯专家
- **性格**：拒绝匿名代码；工单与分支必须可关联

## 🎯 核心使命
- 定义状态流：待办→进行中→评审→完成
- 分支命名、PR 模板、发布记录与工单 ID 绑定
- 国内默认飞书项目或禅道；Jira 仅作对照

## 📋 交付物
- 工作流状态图 + 字段必填规则
- PR/合并 checklist
- 发布与回滚记录模板

## 🚨 必须遵守的规则
- 无工单 ID 不合并（可配置例外须 Boss 批准）
- 不把流程变成官僚；保持可审查

## 🎯 成功标准
- 任意线上问题可追溯到工单与提交`,
};

const COMPLIANCE_CHECKLISTS = {
  "support-content-moderation-specialist": `

## ✅ 合规检查表（法条 → 动作）
| # | 检查项 | 依据 | 动作 |
|---|--------|------|------|
| 1 | 广告极限词 | 广告法 | 扫描「最」「第一」「国家级」等，给出替换建议 |
| 2 | 涉政涉暴恐 | 网络安全/内容规定 | 敏感词+人工复核 |
| 3 | 谣言侵权 | 民法典/著作权 | 溯源要求与下架建议 |
| 4 | 未成年人 | 未成年人网络保护 | 适龄提示与诱导消费检查 |
| 5 | 平台规则 | 抖音/微信/小红书细则 | 对照平台禁限条款表 |
| 6 | 模型输出 | 生成式 AI 管理办法 | 幻觉事实、隐私、诱导转账拦截 |
| 7 | 记录留痕 | 内部审计 | 审核结论、修改建议、词库版本号`,

  "security-cross-border-data-advisor": `

## ✅ 数据出境检查表
| # | 场景 | 法规要点 | 动作 |
|---|------|----------|------|
| 1 | 境外云区域 | 数据安全法/个保法 | 盘点数据类型与存储地域 |
| 2 | 第三方 SDK | 出境规定 | 识别境外服务器与回传字段 |
| 3 | 母公司访问 | 安全评估 | 是否触发安全评估/标准合同 |
| 4 | 重要数据 | 目录与申报 | 是否属于重要数据出境 |
| 5 | 匿名化 | 技术措施 | 评估是否真匿名化 |
| 6 | 用户同意 | 个保法 | 单独同意与告知是否充分 |
| 7 | 整改优先级 | 风险分级 | 输出 P0/P1 改造清单`,

  "security-mlps-compliance-advisor": `

## ✅ 等保 2.0 检查表（摘录）
| 控制域 | 检查动作 |
|--------|----------|
| 定级备案 | 系统类型、二级/三级建议、备案材料清单 |
| 安全物理环境 | 机房/云责任共担边界 |
| 通信网络 | 分区隔离、访问控制、入侵防范 |
| 安全区域边界 | 防火墙/WAF/堡垒机 |
| 安全计算环境 | 身份鉴别、日志审计、恶意代码防范 |
| 安全管理中心 | 集中管控、告警、基线 |
| 管理制度 | 制度样本、记录、培训与演练 |
| 差距整改 | 技术+管理项优先级与迎检问答`,
};

function dedupeCorruption(text) {
  let out = text || "";
  const loops = [
    ["《个人信息保护法》/《个人信息保护法》", "《个人信息保护法》"],
    ["《个人信息保护法》与医疗数据合规/《个人信息保护法》与医疗数据合规", "《个人信息保护法》与医疗数据合规"],
    ["政务云与等保合规（对照）/政务云与等保合规（对照）", "政务云与等保合规（对照）"],
    ["国内 纷享销客、销售易等/国内 纷享销客、销售易等", "国内 纷享销客、销售易等"],
    ["Jira/飞书项目或禅道/Jira/飞书项目或禅道", "Jira/飞书项目或禅道"],
    ["飞书项目或禅道/飞书项目或禅道", "飞书项目或禅道"],
  ];
  for (let pass = 0; pass < 8; pass++) {
    for (const [bad, good] of loops) {
      while (out.includes(bad)) out = out.split(bad).join(good);
    }
  }
  out = out.replace(/((?:飞书项目\/禅道\/Jira\/|Jira\/飞书项目或禅道\/){2,})/g, "飞书项目/禅道/Jira/");
  return out;
}

function splitPrompt(prompt) {
  const i = (prompt || "").indexOf(MARKER);
  if (i < 0) return { shell: prompt || "", body: "" };
  return {
    shell: prompt.slice(0, i),
    body: prompt.slice(i),
  };
}

function refreshChinaBlock(shell) {
  let s = shell.replace(/## 🇨🇳 中国工作语境（强制）[\s\S]*?(?=\n交付时说明|\n\n——|$)/, "").trimEnd();
  if (!s.includes(SHELL_TAIL)) {
    s += `\n${SHELL_TAIL}\n`;
  }
  const insertAt = s.indexOf(SHELL_TAIL);
  if (insertAt >= 0) {
    s = s.slice(0, insertAt).trimEnd() + "\n\n" + CHINA_BLOCK + "\n" + s.slice(insertAt);
  } else {
    s += "\n\n" + CHINA_BLOCK + "\n";
  }
  return s;
}

function applyGlobalBody(body) {
  let out = body;
  for (const [re, to] of GLOBAL_REPLACEMENTS) out = out.replace(re, to);
  return dedupeCorruption(out);
}

function rebuildShell(role) {
  const nameZh = role.nameZh || role.name;
  return [
    `你是「${nameZh}」（岗位 id：${role.id}）。`,
    `所属部门：${role.divisionZh || role.division}。`,
    `请严格按下列完整岗位说明工作；默认用中文回复（除非用户要求其他语言）。`,
    "",
    CHINA_BLOCK,
    "",
    SHELL_TAIL,
  ].join("\n");
}

function replaceBody(prompt, newBody) {
  const { shell } = splitPrompt(prompt);
  const cleanShell = refreshChinaBlock(dedupeCorruption(shell));
  return cleanShell + "\n" + MARKER + "\n" + newBody.trim() + "\n";
}

function ensureStructureSections(body, division) {
  if (!STRUCTURE_DIVISIONS.has(division)) return body;
  let b = body;
  if (!/必须遵守/.test(b)) b += STRUCTURE_APPEND.split("## 📋")[0];
  if (!/交付物/.test(b)) {
    b += STRUCTURE_APPEND.match(/## 📋[\s\S]*?## 🎯/)[0];
  }
  if (!/成功标准/.test(b)) {
    b += STRUCTURE_APPEND.match(/## 🎯 成功标准[\s\S]*/)[0];
  }
  return b;
}

function expandShortRole(role, body) {
  if (body.length >= 900) return body;
  let b = body;
  if (!/工作流程/.test(b)) {
    b += `\n## 🔄 工作流程\n1. 澄清需求、范围与验收标准\n2. 输出方案、假设与风险\n3. 执行/联调/落地\n4. 交付文档与复盘建议\n`;
  }
  if (!/成功标准/.test(b)) {
    b += `\n## 🎯 成功标准\n- Boss 可按验收标准独立确认完成\n- 不确定项已标注「待核实」\n- 默认符合中国工作语境（协作/法规/渠道）\n`;
  }
  return b;
}

function appendChecklist(body, roleId) {
  const extra = COMPLIANCE_CHECKLISTS[roleId];
  if (!extra || body.includes("✅")) return body;
  return body.trimEnd() + extra;
}

function syncSoftwareMirror(roles, base) {
  const mid = `software-company__${base.id}`;
  const existing = roles.find((r) => r.id === mid);
  const prompt = base.prompt
    .replace(`岗位 id：${base.id}`, `岗位 id：${mid}`)
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
  if (existing) Object.assign(existing, mirror);
  else roles.push(mirror);
}

function tagOverseas(role) {
  if (!OVERSEAS_IDS.has(role.id)) return;
  const tags = new Set(role.tags || []);
  tags.add("出海");
  role.tags = [...tags];
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const roles = catalog.roles;
  const stats = {
    chinaRefreshed: 0,
    bodyPatched: 0,
    structureFixed: 0,
    complianceChecklists: 0,
    overseasTagged: 0,
    jiraRenamed: 0,
    mirrorsSynced: 0,
  };

  const jira = roles.find((r) => r.id === "project-management-jira-workflow-steward");
  if (jira) {
    jira.nameZh = "禅道/飞书项目管家";
    jira.name = "禅道/飞书项目管家";
    jira.description = "项目管理 · 禅道/飞书项目管家 — 飞书项目/禅道工作流、需求-分支-PR 可追溯";
    stats.jiraRenamed++;
  }

  for (const role of roles) {
    if (role.id.startsWith("software-company__")) continue;

    if (role.nameZh) role.name = role.nameZh;

    const rebuiltShell = rebuildShell(role);
    let body = splitPrompt(role.prompt || "").body;
    if (!body.startsWith(MARKER)) body = MARKER + "\n" + (body || "").trim();
    body = applyGlobalBody(body);
    stats.chinaRefreshed++;

    if (ROLE_BODY_PATCHES[role.id]) {
      body = MARKER + "\n" + ROLE_BODY_PATCHES[role.id].trim() + "\n";
      stats.bodyPatched++;
    } else {
      const bodyContent = body.slice(MARKER.length);
      let newBody = bodyContent;
      const before = newBody;
      newBody = ensureStructureSections(newBody, role.division);
      newBody = expandShortRole(role, newBody);
      newBody = appendChecklist(newBody, role.id);
      if (newBody !== before) {
        if (COMPLIANCE_CHECKLISTS[role.id] && newBody.includes("✅")) stats.complianceChecklists++;
        if (STRUCTURE_DIVISIONS.has(role.division) && /必须遵守/.test(newBody)) stats.structureFixed++;
      }
      body = MARKER + "\n" + newBody.trim() + "\n";
    }

    role.prompt = dedupeCorruption(rebuiltShell + "\n" + body.replace(/^\n+/, ""));

    tagOverseas(role);
    if (role.tags?.includes("出海")) stats.overseasTagged++;
  }

  const bases = roles.filter((r) => !r.id.startsWith("software-company__"));
  for (const base of bases) {
    syncSoftwareMirror(roles, base);
    stats.mirrorsSynced++;
  }

  catalog.count = roles.length;
  catalog.catalogFixAt = new Date().toISOString();
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(stats, null, 2));
}

main();
