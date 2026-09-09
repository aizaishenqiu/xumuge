/**
 * @file 员工交付验收速检与训练结果回写
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.1.0
 * @category AgentLoop
 * @algo acceptance-evidence-heuristic
 */

import { invoke } from "@tauri-apps/api/core";

import { appendFouMessage } from "../utils/employees";

import { listDir, type FsDirEntry } from "../utils/fsBridge";

import { loadProjects, type XuProject } from "../utils/projects";

import { loadBrief, saveBrief } from "./briefStore";

import { parseAcceptanceReport } from "./acceptanceReport";

import { OFFICE_FLOOR, peerSessionTag, BOSS_PEER_ID } from "../utils/officeComms";

import { loadCodeExecPrefs } from "../utils/codeExecPrefs";
import { saveAcceptanceReviewSnapshot, maybeAutoAcceptanceRework } from "./acceptanceRework";



const OFFICE_SESSION = peerSessionTag(BOSS_PEER_ID, OFFICE_FLOOR);



const recentReview = new Map<string, number>();

const COOLDOWN_MS = 45_000;



async function walkFiles(root: string, max = 80): Promise<string[]> {

  const out: string[] = [];

  const queue = [root];

  while (queue.length && out.length < max) {

    const dir = queue.shift()!;

    let entries: FsDirEntry[] = [];

    try {

      entries = await listDir(dir, false);

    } catch {

      continue;

    }

    for (const e of entries) {

      if (out.length >= max) break;

      const name = e.name || "";

      if (/node_modules|\.git|dist|target|\.xu/i.test(name)) continue;

      if (e.is_dir) {

        queue.push(e.path);

      } else {

        out.push(e.path.replace(/\\/g, "/"));

      }

    }

  }

  return out;

}



function scoreAcceptance(acceptance: string[], filePaths: string[]): {

  hit: string[];

  miss: string[];

} {

  const blob = filePaths.join("\n").toLowerCase();

  const hit: string[] = [];

  const miss: string[] = [];

  for (const a of acceptance) {

    const tokens = a

      .toLowerCase()

      .split(/[\s,，、；;：:]+/)

      .filter((t) => t.length >= 2)

      .slice(0, 6);

    const ok =

      tokens.length === 0

        ? filePaths.length > 3

        : tokens.some((t) => {

            if (blob.includes(t)) return true;

            if (/登录|login/.test(t) && /login|auth|signin/.test(blob)) return true;

            if (/页面|界面|ui/.test(t) && /\.(vue|tsx|jsx|html)(\n|$)/i.test(blob)) return true;

            if (/接口|api/.test(t) && /(api|router|controller|route)/i.test(blob)) return true;

            return false;

          });

    (ok ? hit : miss).push(a);

  }

  return { hit, miss };

}



async function fetchLastAgentOutput(employeeId: string): Promise<string> {

  try {

    const sid = await invoke<string | null>("xu_get_employee_session", { employeeId });

    if (!sid) return "";

    const rows = await invoke<Array<{ role: string; content: string }>>("xu_list_messages", {

      sessionTag: sid,

      limit: 24,

    });

    const assistants = (rows || []).filter((m) => m.role === "assistant");

    return assistants[assistants.length - 1]?.content?.trim() || "";

  } catch {

    return "";

  }

}



export interface AcceptanceReviewResult {

  projectId: string;

  employeeId: string;

  fileCount: number;

  hit: string[];

  miss: string[];

  selfReportChecked: string[];

  selfReportOpen: string[];

  summary: string;

}



/**

 * Run after employee done/idle. Safe to call often (cooldown per project+emp).

 */

export async function runAcceptanceReview(opts: {

  projectId: string;

  employeeId: string;

  employeeName?: string;

  lastAgentOutput?: string;

}): Promise<AcceptanceReviewResult | null> {

  const prefs = await loadCodeExecPrefs();

  if (!prefs.acceptanceReviewOnDone) return null;



  const key = `${opts.projectId}:${opts.employeeId}`;

  const now = Date.now();

  if ((recentReview.get(key) || 0) + COOLDOWN_MS > now) return null;

  recentReview.set(key, now);



  const projects = await loadProjects();

  const project = projects.find((p) => p.id === opts.projectId) as XuProject | undefined;

  if (!project) return null;

  const gen = (project.generatePath || "").trim();

  if (!gen) return null;



  const brief = await loadBrief(project.id);

  if (!brief.acceptance.length && brief.status === "gathering") return null;



  const agentText =

    (opts.lastAgentOutput || "").trim() || (await fetchLastAgentOutput(opts.employeeId));

  const report = parseAcceptanceReport(agentText);



  const files = await walkFiles(gen, 100);

  let { hit, miss } = scoreAcceptance(brief.acceptance, files);

  let uiReportExcerpt = "";
  try {
    const { readUiAcceptanceReportExcerpt } = await import("../utils/uiAcceptanceReport");
    uiReportExcerpt = await readUiAcceptanceReportExcerpt(gen);
  } catch {
    /* ignore */
  }



  // Self-report: unchecked items count as miss hints

  for (const u of report.unchecked) {

    if (!miss.includes(u) && brief.acceptance.some((a) => a.includes(u) || u.includes(a))) {

      miss = [...miss, u];

    }

  }

  for (const c of report.checked) {

    const match = brief.acceptance.find((a) => a.includes(c) || c.includes(a));

    if (match && !hit.includes(match)) hit = [...hit, match];

  }



  const name = opts.employeeName || opts.employeeId;

  const summary = [

    `📋 验收速检 · ${name}`,

    report.lines.length

      ? `员工自报：已勾 ${report.checked.length} · 未勾 ${report.unchecked.length}`

      : "员工未输出 XU_ACCEPTANCE_REPORT（建议在 Skill 中要求）",

    `工作区文件约 ${files.length} 个（抽样）`,

    hit.length ? `可能已覆盖：${hit.map((h) => `「${h}」`).join("、")}` : "",

    miss.length

      ? `仍弱/未体现：${miss.map((m) => `「${m}」`).join("、")}——可返工或改派 QA`

      : brief.acceptance.length

        ? "抽样未发现明显缺口（非最终合格证明）"

        : "Brief 尚无验收条，仅统计落盘文件",

    uiReportExcerpt ? `UI 验收报告摘要：\n${uiReportExcerpt.slice(0, 600)}` : "",

    `Brief v${brief.version || 0} · ${brief.status}`,

  ]

    .filter(Boolean)

    .join("\n");



  if (miss.length && brief.status === "executing") {

    try {

      brief.decisions = [

        ...brief.decisions.filter((d) => !d.startsWith("验收速检：")),

        `验收速检：${name} 仍弱 ${miss.length} 条 @ ${new Date().toLocaleString()}`,

      ].slice(-12);

      await saveBrief(brief);

    } catch {

      /* ignore */

    }

  }



  try {

    await appendFouMessage({

      sessionTag: OFFICE_SESSION,

      employeeId: opts.employeeId,

      role: "system",

      content: summary,

    });

  } catch {

    /* ignore */

  }



  const result: AcceptanceReviewResult = {

    projectId: opts.projectId,

    employeeId: opts.employeeId,

    fileCount: files.length,

    hit,

    miss,

    selfReportChecked: report.checked,

    selfReportOpen: report.unchecked,

    summary,

  };

  try {

    await saveAcceptanceReviewSnapshot(opts.projectId, result);

  } catch {

    /* ignore */

  }

  try {

    const { recordAcceptanceOutcome } = await import("../training/outcomes");

    await recordAcceptanceOutcome(result);

  } catch {

    /* 训练结果旁路失败不影响验收与返工闭环 */

  }

  try {

    const autoMsg = await maybeAutoAcceptanceRework({ project: project!, result });

    if (autoMsg) {

      await appendFouMessage({

        sessionTag: OFFICE_SESSION,

        employeeId: opts.employeeId,

        role: "system",

        content: autoMsg,

      });

    }

  } catch {

    /* ignore */

  }

  return result;

}


