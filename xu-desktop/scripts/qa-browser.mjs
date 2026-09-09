#!/usr/bin/env node
/**
 * Fou QA browser helper — Playwright Chromium.
 * Usage: node scripts/qa-browser.mjs '{"action":"open","url":"...","workspace":"..."}'
 */
import fs from "node:fs";
import path from "node:path";

function fail(error) {
  console.log(JSON.stringify({ ok: false, error: String(error) }));
  process.exit(0);
}

function ok(extra = {}) {
  console.log(JSON.stringify({ ok: true, ...extra }));
}

function statePath(workspace) {
  return path.join(workspace, "qa", "runs", ".browser-state.json");
}

function readState(workspace) {
  try {
    return JSON.parse(fs.readFileSync(statePath(workspace), "utf8"));
  } catch {
    return {};
  }
}

function writeState(workspace, state) {
  const p = statePath(workspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

let playwright;
try {
  playwright = await import("playwright");
} catch (e) {
  fail(
    `playwright 未安装：请在项目根目录执行 pnpm add -D playwright && pnpm exec playwright install chromium。原始错误: ${e?.message || e}`,
  );
}

const raw = process.argv[2];
if (!raw) fail("缺少 JSON 参数");

let cmd;
try {
  cmd = JSON.parse(raw);
} catch (e) {
  fail(`JSON 解析失败: ${e.message}`);
}

const action = String(cmd.action || "");
const workspace = String(cmd.workspace || process.cwd());
fs.mkdirSync(path.join(workspace, "qa", "runs"), { recursive: true });

const { chromium } = playwright;
const state = readState(workspace);

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (state.url) {
      try {
        await page.goto(state.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch {
        /* ignore stale url */
      }
    }
    const result = await fn(page);
    try {
      state.url = page.url();
      writeState(workspace, state);
    } catch {
      /* ignore */
    }
    return result;
  } finally {
    await browser.close();
  }
}

function resolveUrl(baseUrl, url) {
  const u = String(url || "").trim();
  if (!u) return baseUrl || "about:blank";
  if (/^https?:\/\//i.test(u)) return u;
  const base = String(baseUrl || "").replace(/\/$/, "");
  return `${base}${u.startsWith("/") ? u : `/${u}`}`;
}

async function runStep(page, step, baseUrl, workspace, runId, scenarioId, stepIndex) {
  const action = String(step.action || "").trim();
  if (action === "open" || action === "goto") {
    const url = resolveUrl(baseUrl, step.url || step.startUrl);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    return;
  }
  if (action === "click") {
    const selector = String(step.selector || "");
    if (!selector) throw new Error("click 需要 selector");
    await page.click(selector, { timeout: 15000 });
    return;
  }
  if (action === "type") {
    const selector = String(step.selector || "");
    const text = String(step.text ?? "");
    if (!selector) throw new Error("type 需要 selector");
    await page.fill(selector, text, { timeout: 15000 });
    return;
  }
  if (action === "assert") {
    const selector = String(step.selector || "body");
    const expect = step.expect != null ? String(step.expect) : "";
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: "visible", timeout: 15000 });
    if (expect && expect !== "visible") {
      const content = await loc.innerText();
      if (!content.includes(expect)) {
        throw new Error(`assert 文本不匹配：期望包含 ${JSON.stringify(expect)}`);
      }
    }
    if (step.text != null) {
      const content = await loc.innerText();
      const expectText = String(step.text);
      if (!content.includes(expectText)) {
        throw new Error(`assert 文本不匹配：期望包含 ${JSON.stringify(expectText)}`);
      }
    }
    return;
  }
  if (action === "screenshot") {
    const name =
      String(step.name || `ui-${runId}-${scenarioId}-${stepIndex}.png`).replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
    const out = path.join(workspace, "qa", "runs", name);
    await page.screenshot({ path: out, fullPage: true });
    return out;
  }
  throw new Error(`未知 step action: ${action}`);
}

try {
  if (action === "open" || action === "goto") {
    const url = String(cmd.url || "about:blank");
    await withPage(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      state.url = page.url();
      writeState(workspace, state);
      ok({ action, url: page.url() });
    });
  } else if (action === "click") {
    const selector = String(cmd.selector || "");
    if (!selector) fail("click 需要 selector");
    await withPage(async (page) => {
      await page.click(selector, { timeout: 15000 });
      ok({ action, selector });
    });
  } else if (action === "type") {
    const selector = String(cmd.selector || "");
    const text = String(cmd.text ?? "");
    if (!selector) fail("type 需要 selector");
    await withPage(async (page) => {
      await page.fill(selector, text, { timeout: 15000 });
      ok({ action, selector, len: text.length });
    });
  } else if (action === "assert") {
    const selector = String(cmd.selector || "body");
    const expectText = cmd.text != null ? String(cmd.text) : null;
    await withPage(async (page) => {
      const loc = page.locator(selector).first();
      await loc.waitFor({ state: "visible", timeout: 15000 });
      if (expectText) {
        const content = await loc.innerText();
        if (!content.includes(expectText)) {
          fail(`assert 文本不匹配：期望包含 ${JSON.stringify(expectText)}`);
        }
      }
      ok({ action, selector, text: expectText });
    });
  } else if (action === "screenshot") {
    const name = String(cmd.name || `shot-${Date.now()}.png`).replace(
      /[\\/:*?"<>|]/g,
      "_",
    );
    const out = path.join(workspace, "qa", "runs", name);
    await withPage(async (page) => {
      await page.screenshot({ path: out, fullPage: true });
      ok({ action, path: out });
    });
  } else if (action === "run-scenario") {
    const scenariosRel = String(cmd.scenariosFile || ".xu/qa/ui-scenarios.json");
    const scenariosPath = path.isAbsolute(scenariosRel)
      ? scenariosRel
      : path.join(workspace, scenariosRel);
    if (!fs.existsSync(scenariosPath)) {
      fail(`缺少 ui-scenarios.json：${scenariosPath}`);
    }
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
    } catch (e) {
      fail(`ui-scenarios.json 解析失败: ${e?.message || e}`);
    }
    const baseUrl = String(doc.baseUrl || cmd.baseUrl || "http://127.0.0.1:5340").replace(/\/$/, "");
    const scenarios = Array.isArray(doc.scenarios) ? doc.scenarios : [];
    const runId = String(cmd.runId || Date.now());
    const results = [];
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      for (const scenario of scenarios) {
        const scenarioId = String(scenario.id || "unknown");
        if (scenario.startUrl) {
          await page.goto(resolveUrl(baseUrl, scenario.startUrl), {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        }
        let stepIndex = 0;
        for (const step of scenario.steps || []) {
          stepIndex += 1;
          const row = { scenarioId, step: stepIndex, ok: true, error: "", screenshotPath: "" };
          try {
            const shot = await runStep(page, step, baseUrl, workspace, runId, scenarioId, stepIndex);
            if (shot) row.screenshotPath = shot;
          } catch (e) {
            row.ok = false;
            row.error = String(e?.message || e);
            try {
              const shotName = `ui-fail-${runId}-${scenarioId}-${stepIndex}.png`.replace(
                /[\\/:*?"<>|]/g,
                "_",
              );
              const shotPath = path.join(workspace, "qa", "runs", shotName);
              await page.screenshot({ path: shotPath, fullPage: true });
              row.screenshotPath = shotPath;
            } catch {
              /* ignore screenshot failure */
            }
            results.push(row);
            break;
          }
          results.push(row);
        }
      }
    } finally {
      await browser.close();
    }
    const failed = results.filter((r) => !r.ok).length;
    ok({
      action,
      runId,
      results,
      passed: failed === 0 && results.length > 0,
      failed,
      total: results.length,
    });
  } else {
    fail(`未知 action: ${action}`);
  }
} catch (e) {
  fail(e?.message || e);
}
