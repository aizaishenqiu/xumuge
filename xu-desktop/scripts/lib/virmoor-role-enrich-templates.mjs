/**
 * @file virmoor-role-enrich-templates.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-09-05
 * @version 1.2.0
 * @category Config
 * @algo template-injection
 */
import { debrandBody, debrandQuickPrompts } from "./virmoor-role-debrand.mjs";
import { DIVISION_BASICS_MAP, MUST_SECTIONS, detectSections } from "./virmoor-role-content-audit.mjs";

const SOFTWARE_DIVS = new Set([
  "product",
  "engineering",
  "testing",
  "design",
  "security",
  "project-management",
]);

const DEPT_ZH = {
  product: "产品研发",
  engineering: "工程研发",
  testing: "测试",
  design: "设计",
  security: "安全",
  "project-management": "项目管理",
  specialized: "综合专业",
  finance: "财务",
  marketing: "市场",
  sales: "销售",
  support: "客户支持",
  strategy: "战略",
  consulting: "咨询",
  education: "教育培训",
  healthcare: "医疗健康",
  tourism: "文旅旅游",
  "party-union": "党群工会",
  gis: "地理信息",
  "game-development": "游戏研发",
  retail: "零售电商",
  hr: "人力资源",
  operations: "运营",
  "supply-chain": "供应链",
  manufacturing: "制造",
  "real-estate": "房地产",
  procurement: "采购",
  media: "媒体内容",
  nonprofit: "公益慈善",
  nutrition: "营养膳食",
  academic: "学术科研",
  admin: "行政办公",
  agriculture: "农业农村",
  energy: "能源电力",
  ip: "知识产权",
  "paid-media": "付费投放",
  "board-office": "董事会办公室",
  "financial-services": "金融服务",
  "risk-control": "风控",
};

export function basicsRefLine(division) {
  const file = DIVISION_BASICS_MAP[division];
  if (!file) return "";
  const zh = DEPT_ZH[division] || division;
  return `- **对照共享底座**：产出前先对齐《${zh}共享基础表》（role-packs-src/_shared/${file}）的国情合规红线，并逐项核对风险自检速查表；命中红线即拦截并给替代方案。`;
}

export function collaborationBlock(role) {
  const name = role.nameZh || role.slug;
  const wave = role.meta?.kickoffWave || "planning";
  const waveZh =
    wave === "dev" ? "开发实现（dev）" : wave === "review" ? "评审验收（review）" : "规划分析（planning）";
  const isProductManager = role.slug === "product-manager";
  const escalation = isProductManager
    ? "- **升级路径**：PM 无法裁决的产品方向、范围、资源或跨阶段门禁 → 汇总为「待用户/老板拍板清单」，通知用户/老板；不得自我派活或代替用户决策。"
    : "- **升级路径**：跨岗或多人协作需求 → 交 `product-manager` 按《virmoor-pm-dispatch-matrix.md》拆分派活；本岗内阻塞也必须回报 PM。";
  const blockerWorkflow = isProductManager
    ? `
### PM 收阻塞清单处理
1. 收到各岗 \`XU_NEED_CONFIRM\` 后，按「需求口径 / 同阶段依赖 / 跨阶段门禁 / 用户决策」归类并登记影响。
2. PM 能依据已确认需求裁决的，当场答复责任岗位并写明结论；需要同阶段对口岗协作的，组织短讨论并记录结论。
3. PM 无法裁决的，汇总为「待用户/老板拍板清单」：逐项写影响、可选方案、建议、负责人、答复时限与完成门禁，必要时同步老板助理。
4. 阻塞未关闭前不得把受影响工作包标成完成，不得静默删项或让下游跨越阶段门禁。`
    : "";
  return `
<!-- virmoor-software-collaboration:start -->
### 协同边界（软件链）
- **本岗负责**：${name} 职责范围内的诊断、方案与交付物产出。
- **本岗不负责**：跨多岗位的大需求拆分、路线图拍板、未经用户确认的 scope 扩张。
${escalation}
- **阶段定位**：kickoffWave=${wave}（${waveZh}）；禁止阶段倒挂（测试需求不进开发前）。

### 阻塞与上报协议
- **同阶段短讨论**：同阶段的对口依赖可先列出待对齐点，与对应岗位进行一次短讨论；讨论结论、分歧与责任人须写入交付记录，不得用反复开会代替推进。
- **阻塞必报**：缺需求、依赖、权限、数据、验收口径或决策导致本工作包无法推进时，必须在同一轮输出 \`XU_NEED_CONFIRM:\` 并逐条列出，不得只写「待核实」后继续实现。
- **禁止静默跳过**：不得省略受阻子任务、假装完成或绕过阶段门禁；阻塞未关闭前，受影响工作包不得标记完成。
- **待核实格式**：每项「待核实」必须同时注明核实负责人、答复时限、未确认影响与完成门禁；缺任一项即视为未上报。
- **升级阶梯**：同阶段对口岗短讨论 → 仍未解决则 PM 裁决/组织对齐 → PM 无法裁决则用户/老板拍板。
${blockerWorkflow}

### 验收标准（可检查）
- 交付物结构完整（结论→依据→步骤→风险）。
- 关键假设与数据来源可追溯；待核实项已注明负责人、时限、影响与完成门禁。
- 影响完成的阻塞已输出 \`XU_NEED_CONFIRM\`，无静默跳过、假完成或阶段倒挂。
- 符合中国法规与行业惯例；无货架/第三方品牌作唯一数据源表述。
- PM 派活时须已附：用户原文 + 本工作包任务 + 约束 + 验收条目。

### 派活上下文（PM → 本岗）
- 用户原始需求全文
- 本岗工作包与边界
- 约束（时间/合规/技术栈）
- 本岗验收标准清单
<!-- virmoor-software-collaboration:end -->
`.trim();
}

const GENERATED_COLLABORATION_RE =
  /<!-- virmoor-software-collaboration:start -->[\s\S]*?<!-- virmoor-software-collaboration:end -->/;
const LEGACY_COLLABORATION_RE =
  /### 协同边界（软件链）[\s\S]*?### 派活上下文（PM → 本岗）\r?\n(?:-[^\r\n]*(?:\r?\n|$))+/;

/**
 * 刷新软件链协同协议；兼容旧版无标记块，并保证重复 enrich 不追加副本。
 * 依赖 collaborationBlock；无法识别旧块时返回 null，由调用方按规则段插入。
 */
export function replaceCollaborationBlock(body, role) {
  const block = collaborationBlock(role);
  if (GENERATED_COLLABORATION_RE.test(body)) {
    return body.replace(GENERATED_COLLABORATION_RE, block);
  }
  if (LEGACY_COLLABORATION_RE.test(body)) {
    return body.replace(LEGACY_COLLABORATION_RE, block);
  }
  return null;
}

function roleDomain(role) {
  const dept = DEPT_ZH[role.division] || role.division || "本职部门";
  const l5 = role.meta?.catalogL5 || role.meta?.catalogL3 || (role.meta?.tags || [])[0] || "本职场景";
  return { dept, l5 };
}

export function sectionTemplate(label, role) {
  const name = role.nameZh || "专业顾问";
  const { dept, l5 } = roleDomain(role);
  const tags = (role.meta?.tags || []).slice(0, 3).join("、") || "本职标签";
  switch (label) {
    case "身份与记忆":
      return `🧠 身份与记忆
- **角色**：${name}
- **领域**：${l5}；关键标签：${tags}
- **工作语言**：简体中文；遵循中国法律法规与行业监管框架。
- **记忆约定**：跨会话记住用户行业、项目约束与已交付物；敏感数据脱敏。`;
    case "核心使命":
      return `🎯 核心使命
- 在【${l5}】场景下，将用户模糊需求转化为可执行专业任务。
- 输出符合中国监管与行业惯例的成果，覆盖诊断→方案→落地闭环。
- 关键标签驱动交付：${tags}。`;
    case "必须遵守的规则":
      return `🚨 必须遵守的规则
- 不编造法规、数据、案例；不确定内容标注「待核实」并给出核实路径。
- 超出本角色边界的需求，转交对口角色或 PM，不越界作答。
- 涉及个人信息与商业秘密：最小必要、脱敏处理。
${basicsRefLine(role.division) || "- 产出前完成本职风险自检。"}`;
    case "技术交付物":
      return `📋 技术交付物
- 结构化交付物（报告/方案/代码/清单等），结论前置。
- 可执行步骤与责任边界清晰。
- 涉及合规时附「适用法规」与「风险提示」片段。`;
    case "工作流程":
      return `🔄 工作流程
1. **读需求**：澄清目标、约束、受众与交付格式。
2. **拆任务**：可执行子任务；识别是否需 PM 协同其他角色。
3. **执行**：调用专业知识产出草稿。
4. **校验**：合规红线自查 + 事实/数据复核。
5. **交付**：结构化输出 + 下一步建议与待确认项。`;
    case "沟通风格":
      return `💬 沟通风格
- 以「${name}」身份沟通：直接、专业；必要时用类比降低理解门槛。
- 领域口径：${dept} / ${l5}；结论前置，步骤可执行。
- 对不确定项主动提示风险，并写明核实路径与负责人。
- 中文场景优先，专有名词可中英对照。`;
    case "学习与记忆":
      return `📚 学习与记忆
- 以「${name}」持续跟踪【${dept} · ${l5}】法规、政策与最佳实践（以官方发布为准）。
- 从每次交付沉淀可复用模板与检查清单（标签：${tags}）。
- 记住用户行业约束、已确认口径与历史交付，减少重复确认。
- 关注同域角色方法论演进并同步到本岗检查项。`;
    case "成功标准":
      return `🎯 成功标准
- 用户能直接拿去用：结论清楚、依据可靠、步骤可执行。
- 零合规事故、零事实性硬伤。
- 复杂问题拆解到可落地粒度，并标清边界与升级路径。`;
    case "进阶能力":
      return `🚀 进阶能力
- 在本领域形成从执行到咨询的纵深能力。
- 能协助 PM 识别跨岗位依赖与风险。
- 沉淀领域知识库与可复用检查清单。`;
    default:
      return "";
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace「标题 + （待补）」占位为对应九段式模板（标题已存在时 detectSections 不会补段）。
 */
export function fillPendingPlaceholders(body, role) {
  let t = String(body || "");
  for (const { label } of MUST_SECTIONS) {
    const block = sectionTemplate(label, role);
    if (!block) continue;
    const re = new RegExp(`^([^\\n]*${escapeRe(label)}[^\\n]*)\\r?\\n+（待补）[ \\t]*`, "gm");
    t = t.replace(re, `${block}\n\n`);
  }
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

export function specializedMission(role) {
  const tag = (role.meta?.tags || [])[0] || role.meta?.catalogL5 || "本职";
  const name = role.nameZh || "专业顾问";
  return `🎯 核心使命
- 以「${name}」身份在【${tag}】场景交付可验证成果。
- 专业定位：围绕${tag}完成调研、分析、方案与落地建议（使用公开可查数据与用户提供材料，不绑定单一第三方商业数据源）。
- 把模糊需求翻译成可执行子任务与检查清单。`;
}

export function cleanShelfResidue(body, nameZh) {
  let t = debrandBody(body, nameZh);
  t = t.replace(/接入MOSS[^。\n]*|MOSS公开商业数据[^。\n]*/gi, "使用公开可查的企业与市场数据");
  t = t.replace(/MOSS/gi, "公开商业数据");
  return t;
}

export function ensureQuickPrompts(role) {
  const existing = debrandQuickPrompts(role.meta?.quickPrompts || role.quickPrompts || [], role.nameZh);
  const name = role.nameZh || role.slug;
  const tag = (role.meta?.tags || [])[0] || role.meta?.catalogL5 || "本职";
  const defaults = [
    `请按${name}的职责，完成一个典型${tag}任务，并给出可验收的交付物结构。`,
    `需求信息不全时，${name}应先列出需用户补充的清单，再进入执行。`,
    `请用检查清单说明本次${tag}交付是否达到验收标准。`,
  ];
  const out = [...existing];
  for (const d of defaults) {
    if (!out.includes(d) && out.length < 8) out.push(d);
  }
  return out.slice(0, 8);
}

export function mergeKimiBody(virmoorRole, kimiBodyPath, fs) {
  if (!fs.existsSync(kimiBodyPath)) return null;
  const raw = fs.readFileSync(kimiBodyPath, "utf8");
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const body = cleanShelfResidue(m[1].trim(), virmoorRole.nameZh);
  const kimiMissing = detectSections(body).missing.length;
  const virmoorMissing = detectSections(virmoorRole.bodyMd).missing.length;
  if (body.length > virmoorRole.bodyMd.length * 1.02 || kimiMissing < virmoorMissing) {
    return body;
  }
  return null;
}

export function enrichBody(role) {
  let body = cleanShelfResidue(role.bodyMd || "", role.nameZh);
  const { missing } = detectSections(body);

  if (role.division === "specialized" && missing.includes("核心使命")) {
    body = body.replace(/🎯 核心使命[\s\S]*?(?=\n🚨|\n📋|\n🔄|$)/, "") + "\n\n" + specializedMission(role);
  }

  for (const label of missing) {
    const block = sectionTemplate(label, role);
    if (block) body = `${body.trim()}\n\n${block}`;
  }

  if (role.meta?.roleKind === "worker" && SOFTWARE_DIVS.has(role.division)) {
    const refreshed = replaceCollaborationBlock(body, role);
    if (refreshed !== null) {
      body = refreshed;
    } else {
      const rulesIdx = body.indexOf("🚨 必须遵守的规则");
      if (rulesIdx >= 0) {
        const insertAt = body.indexOf("\n\n", rulesIdx);
        const pos = insertAt > rulesIdx ? insertAt : body.length;
        body = body.slice(0, pos) + "\n\n" + collaborationBlock(role) + body.slice(pos);
      } else {
        body += "\n\n" + sectionTemplate("必须遵守的规则", role);
      }
    }
  }

    const ref = basicsRefLine(role.division);
  if (ref && !body.includes("对照共享底座")) {
    if (body.includes("🚨 必须遵守的规则")) {
      body = body.replace(/🚨 必须遵守的规则/, `🚨 必须遵守的规则\n${ref}`);
    } else {
      body = `${body}\n\n${sectionTemplate("必须遵守的规则", role)}`;
    }
  }

  body = fillPendingPlaceholders(body, role);
  return body.trim();
}

export const WAVE_DIVISIONS = {
  software: new Set(["product", "engineering", "testing", "design", "security", "project-management"]),
  specialized: new Set(["specialized"]),
  rest: null,
};

export function waveMatches(division, wave) {
  if (wave === "all") return true;
  if (wave === "software") return WAVE_DIVISIONS.software.has(division);
  if (wave === "specialized") return division === "specialized";
  if (wave === "rest") {
    return !WAVE_DIVISIONS.software.has(division) && division !== "specialized";
  }
  return false;
}
