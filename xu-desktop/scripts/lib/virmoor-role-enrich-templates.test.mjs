/**
 * @file 软件链岗位协同协议模板回归测试
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo table-driven-template-assertion
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  collaborationBlock,
  replaceCollaborationBlock,
} from "./virmoor-role-enrich-templates.mjs";

const worker = {
  slug: "engineering-backend-architect",
  nameZh: "工程研发 · 后端架构师",
  meta: { kickoffWave: "dev" },
};

test("执行岗协议强制阻塞上报并设置完成门禁", () => {
  const block = collaborationBlock(worker);
  for (const required of [
    "XU_NEED_CONFIRM:",
    "禁止静默跳过",
    "同阶段短讨论",
    "核实负责人",
    "答复时限",
    "完成门禁",
  ]) {
    assert.match(block, new RegExp(required));
  }
});

test("产品经理升级不自指且包含阻塞清单处理", () => {
  const block = collaborationBlock({
    slug: "product-manager",
    nameZh: "产品 · 产品经理",
    meta: { kickoffWave: "planning" },
  });
  assert.doesNotMatch(block, /升级路径[^\n]*交 `product-manager`/);
  assert.match(block, /PM 收阻塞清单处理/);
  assert.match(block, /待用户\/老板拍板清单/);
});

test("旧协同块可升级且重复刷新不产生副本", () => {
  const legacy = `🚨 必须遵守的规则
- 先读需求。

### 协同边界（软件链）
- **本岗负责**：旧职责。
- **升级路径**：跨岗交 PM。

### 验收标准（可检查）
- 旧验收。

### 派活上下文（PM → 本岗）
- 用户原始需求全文
- 本岗验收标准清单

📋 技术交付物
- 交付。`;
  const upgraded = replaceCollaborationBlock(legacy, worker);
  assert.ok(upgraded);
  assert.equal(upgraded.match(/XU_NEED_CONFIRM:/g)?.length, 1);
  assert.doesNotMatch(upgraded, /旧验收/);

  const refreshed = replaceCollaborationBlock(upgraded, worker);
  assert.equal(refreshed?.match(/协同边界（软件链）/g)?.length, 1);
  assert.equal(refreshed?.match(/XU_NEED_CONFIRM:/g)?.length, 1);
});
