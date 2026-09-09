/**
 * @file copywritingSkillScaffold.ts 文案交付 Skill + templates/copy + 风格记忆脚手架
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 1.1.0
 * @category AgentLoop
 * @algo brief-synced-copy-templates
 */
import { mkdirRecursive, writeTextUnderWorkspace, readTextFile } from "../utils/fsBridge";
import type { RequirementBrief } from "./briefTypes";
import { formatBriefSummary } from "./briefTypes";

const TEMPLATES: { file: string; body: string }[] = [
  {
    file: "wechat-official.md",
    body: `# {{标题}}

> 作者：{{作者}} · 预计发布：{{发布日期}}

## 开头（3 行内抓住读者）

{{开头钩子}}

## 正文

### {{小标题1}}

{{段落1}}

### {{小标题2}}

{{段落2}}

## 结尾 CTA（只保留一个）

{{行动号召}}

---

内部备注（勿发）：{{内部备注}}
`,
  },
  {
    file: "feishu-announcement.md",
    body: `# 【公告】{{标题}}

**对象**：{{受众}}  
**生效**：{{生效时间}}  
**发布人**：{{发布人}}

## 一句话结论

{{结论}}

## 说明

{{说明正文}}

## 请大家

- [ ] {{待办1}}
- [ ] {{待办2}}

## 联系人

有问题找 {{联系人}}（{{联系方式}}）。
`,
  },
  {
    file: "product-update.md",
    body: `# {{产品名}} {{版本号}} 更新说明

**发布日期**：{{发布日期}}

## 用户能立刻感知到的变化

1. {{收益1}}
2. {{收益2}}
3. {{收益3}}

## 怎么用

{{使用指引}}

## 已知限制

{{已知限制}}

## 反馈

问题请反馈至 {{反馈渠道}}。
`,
  },
  {
    file: "sales-outreach.md",
    body: `{{称呼}}你好，

我是 {{自我介绍}}。注意到贵司在 {{触发场景}}，想请教 2 分钟：{{核心问题}}。

若方便，可否本周约 15 分钟通话？我这边 {{可选时段}}。

谢谢，  
{{署名}}  
{{联系方式}}
`,
  },
  {
    file: "press-release-short.md",
    body: `# {{标题}}

**地点**：{{地点}}　**时间**：{{时间}}

## 导语

{{导语}}

## 要点

- {{要点1}}
- {{要点2}}
- {{要点3}}

## 引语（可选）

「{{引语}}」—— {{引语来源}}

## 关于 {{机构名}}

{{机构简介}}

媒体联络：{{媒体联络}}
`,
  },
];

function copyStyleSeed(brief: RequirementBrief): string {
  const goal = String(brief.goal || "").trim().slice(0, 200);
  return `# 文案风格（项目记忆）

> 写文案前必读。用户说「记住文案风格：…」时用 write_file 更新本文件；可同时 /记住 写入全局记忆。

## Brief 摘要（脚手架写入，可改）

${goal || "（确认需求后自动填入目标一句）"}

## 气质一句

（例：稳重克制、少形容词；或：亲和口语、像同事聊天）

## 禁用词

- （例：赋能、闭环、抓手、打造一站式）

## 常用称呼

- 对内：
- 对外：

## CTA 偏好

（例：只保留一个行动号召；按钮文案用动词开头）

## 示例句（可选）

- 好例子：
- 坏例子：
`;
}

function skillCopywritingDelivery(brief: RequirementBrief): string {
  return `---
name: 文案交付
description: 中文成稿——先读风格再套模板；落盘交付；发送须老板确认（L4）
id: copywriting-delivery
briefVersion: ${brief.version || 0}
updatedAt: ${brief.updatedAt}
---

# 文案交付 Skill（Brief v${brief.version || 0}）

成稿落在项目文件夹；发送是另一回事。先读风格，再套模板，最后请老板确认再发。

## 当前 Brief（以 v${brief.version || 0} 为准，旧版作废）

\`\`\`
${formatBriefSummary(brief)}
\`\`\`

## 开工顺序

0. \`read_file\` \`.xu/copy-style.md\`（气质 / 禁用词 / 称呼 / CTA）；用户说「记住文案风格：…」→ \`write_file\` 更新该文件（可同时建议 /记住）
1. 体裁：只选一类（见 \`templates/copy/\`）
2. \`read_file\` 对应模板
3. 替换 \`{{占位符}}\`，并按风格文件改语气；未知写「待老板确认」或先提问
4. \`write_file\` 到 \`deliverables/copy/\`；要 Word 再用 \`office_write_docx\` / \`office_apply_template\`
5. **禁止声称已发送**；飞书/企微等须用户确认（L4）

## 硬禁令

- 禁止挂机个人微信 / 千牛 / 未授权渠道自动发信
- 禁止空洞套话与编造数据、客户名、发布时间
- 广告法敏感表述须提示老板
- 成稿不得违反 \`.xu/copy-style.md\` 中的禁用词与气质

## 模板

- \`templates/copy/wechat-official.md\`
- \`templates/copy/feishu-announcement.md\`
- \`templates/copy/product-update.md\`
- \`templates/copy/sales-outreach.md\`
- \`templates/copy/press-release-short.md\`
`;
}

/**
 * Write copywriting Skill + style memory + markdown templates under generatePath.
 * Overwrites Skill and copy-style seed; always refreshes template files.
 */
export async function scaffoldCopywritingSkills(
  generatePath: string,
  brief: RequirementBrief,
): Promise<string[]> {
  const root = generatePath.replace(/[/\\]+$/, "");
  if (!root) return [];

  await mkdirRecursive(root, ".xu/skills/copywriting-delivery");
  await mkdirRecursive(root, ".xu");
  await mkdirRecursive(root, "templates/copy");
  await mkdirRecursive(root, "deliverables/copy");

  const skillRel = ".xu/skills/copywriting-delivery/SKILL.md";
  const styleRel = ".xu/copy-style.md";
  await writeTextUnderWorkspace(root, skillRel, skillCopywritingDelivery(brief));

  const written: string[] = [`${root}/${skillRel}`.replace(/\\/g, "/")];
  // Preserve user-edited style memory; only seed when missing.
  const styleAbs = `${root}/${styleRel}`.replace(/\\/g, "/");
  let styleExists = false;
  try {
    const existing = await readTextFile(styleAbs);
    styleExists = Boolean(existing && existing.trim());
  } catch {
    styleExists = false;
  }
  if (!styleExists) {
    await writeTextUnderWorkspace(root, styleRel, copyStyleSeed(brief));
  }
  written.push(styleAbs);
  for (const t of TEMPLATES) {
    const rel = `templates/copy/${t.file}`;
    await writeTextUnderWorkspace(root, rel, t.body);
    written.push(`${root}/${rel}`.replace(/\\/g, "/"));
  }
  written.push(`${root}/deliverables/copy`.replace(/\\/g, "/"));
  return written;
}

/** Relative paths for dispatch hints. */
export function copywritingSkillRelPaths(brief?: RequirementBrief | null): string[] {
  const v = brief?.version ? ` v${brief.version}` : "";
  const tag = v ? `（Brief${v}）` : "";
  return [
    `.xu/skills/copywriting-delivery/SKILL.md${tag}`,
    ".xu/copy-style.md",
    "templates/copy/*.md",
  ];
}
