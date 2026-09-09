/**
 * @file virmoor-fill-pending.test.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.0.0
 * @category test
 * @algo replace （待补） section placeholders
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fillPendingPlaceholders, enrichBody } from "./virmoor-role-enrich-templates.mjs";

const role = {
  slug: "sales-outreach",
  division: "specialized",
  nameZh: "专项 · 外联专员",
  meta: { catalogL5: "销售外联", tags: ["外联"] },
};

test("fills 沟通风格 and 学习与记忆 placeholders", () => {
  const body = `💬 沟通风格
（待补）

📚 学习与记忆
（待补）
`;
  const out = fillPendingPlaceholders(body, role);
  assert.equal(out.includes("（待补）"), false);
  assert.match(out, /💬 沟通风格\n- 以「专项 · 外联专员」身份/);
  assert.match(out, /📚 学习与记忆\n- 以「专项 · 外联专员」持续跟踪/);
});

test("enrichBody fills placeholders even when headers already exist", () => {
  const out = enrichBody({
    ...role,
    bodyMd: `🧠 身份与记忆
- 角色

🎯 核心使命
- 使命

🚨 必须遵守的规则
- 规则

📋 技术交付物
- 交付

🔄 工作流程
1. 读需求

💬 沟通风格
（待补）

📚 学习与记忆
（待补）

🎯 成功标准
- 标准

🚀 进阶能力
- 进阶
`,
  });
  assert.equal(out.includes("（待补）"), false);
});
