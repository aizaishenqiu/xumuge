/**
 * @file voice-engine-capability.test.mjs
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-03
 * @version 1.0.0
 * @category test
 * @algo capability-tri-state contract
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  liftCosyOfflineCapability,
  offlineCapabilityBadge,
  resolveOfflineCapability,
} from "./voice-engine-capability.mjs";

test("resolve: missing pack → packMissing", () => {
  assert.equal(resolveOfflineCapability("cosyvoice", [], null), "packMissing");
  assert.equal(
    resolveOfflineCapability("cosyvoice", [], {
      packInstalled: false,
      synthesisAvailable: false,
    }),
    "packMissing",
  );
});

test("resolve: installed without synth → packOnly", () => {
  assert.equal(
    resolveOfflineCapability("cosyvoice", [], {
      packInstalled: true,
      synthesisAvailable: false,
    }),
    "packOnly",
  );
});

test("resolve: synthesis available → ready", () => {
  assert.equal(
    resolveOfflineCapability("cosyvoice", [], {
      packInstalled: true,
      synthesisAvailable: true,
    }),
    "ready",
  );
});

test("lift Cosy: install phase ready lifts 未装 → 已装·不可合成", () => {
  assert.equal(
    liftCosyOfflineCapability("packMissing", { installPhaseReady: true }),
    "packOnly",
  );
  assert.equal(offlineCapabilityBadge("packOnly"), "已装·不可合成");
});

test("lift Cosy: launch paths or discover also lift", () => {
  assert.equal(
    liftCosyOfflineCapability("packMissing", { launchPathsConfigured: true }),
    "packOnly",
  );
  assert.equal(
    liftCosyOfflineCapability("packMissing", { discoverOk: true }),
    "packOnly",
  );
  assert.equal(liftCosyOfflineCapability("packMissing", {}), "packMissing");
});

test("lift Cosy: does not downgrade ready", () => {
  assert.equal(liftCosyOfflineCapability("ready", {}), "ready");
  assert.equal(offlineCapabilityBadge("ready"), "可用");
  assert.equal(offlineCapabilityBadge("packMissing"), "未装");
});
