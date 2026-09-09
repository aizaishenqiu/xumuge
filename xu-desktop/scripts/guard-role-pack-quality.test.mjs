/**
 * @file guard-role-pack-quality 单测
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo none
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRoleMarkdown } from "./guard-role-pack-quality.mjs";

const GOOD = `---
id: "demo-role"
slug: demo-role
nameZh: "演示岗"
division: engineering
---
🎯 核心使命
做好演示。

🚨 必须遵守的规则
1. 需求不清先追问；阻塞须 XU_NEED_CONFIRM 开会上报。

🎯 成功标准
验收通过。
`;

const BAD_NO_MEETING = `---
id: "bad-role"
slug: bad-role
nameZh: "坏岗位"
division: engineering
---
🎯 核心使命
写代码。

🚨 必须遵守的规则
1. 代码要绿。

🎯 成功标准
编译通过。
`;

describe("guard-role-pack-quality", () => {
  it("accepts role with sections and meeting duty", () => {
    assert.deepEqual(validateRoleMarkdown("good.md", GOOD), []);
  });

  it("rejects missing meeting duty", () => {
    const errs = validateRoleMarkdown("bad.md", BAD_NO_MEETING);
    assert.ok(errs.some((e) => /meeting duty/i.test(e)));
  });

  it("rejects missing frontmatter fields", () => {
    const errs = validateRoleMarkdown(
      "x.md",
      `---
id: "x"
---
🎯 核心使命
a
🚨 必须遵守的规则
XU_NEED_CONFIRM
🎯 成功标准
b
`,
    );
    assert.ok(errs.some((e) => /nameZh/.test(e)));
    assert.ok(errs.some((e) => /slug/.test(e)));
  });
});
