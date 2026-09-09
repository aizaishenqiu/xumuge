/**
 * @file virmoor-namezh-label.test.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-05
 * @version 1.1.0
 * @category test
 * @algo ensureIndustryLabelNameZh 保留业务前缀
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ensureIndustryLabelNameZh } from "./virmoor-namezh-label.mjs";

test("preserves 招投标 prefix over specialized division", () => {
  const out = ensureIndustryLabelNameZh({
    slug: "specialized-role-vhfyffqou6",
    division: "specialized",
    nameZh: "招投标 · 招投标审阅专家",
    meta: {},
  });
  assert.equal(out.nameZh, "招投标 · 招投标审阅专家");
});

test("rewrites weak 专项 via business inference", () => {
  const out = ensureIndustryLabelNameZh({
    slug: "x",
    division: "specialized",
    nameZh: "专项 · 招投标管理顾问",
    meta: { tags: "招投标管理" },
  });
  assert.match(out.nameZh, /^招投标 · /);
});
