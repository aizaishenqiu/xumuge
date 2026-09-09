/**
 * Pre-release security checklist gate (architecture, DDoS, auth, secrets, etc.).
 */
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import type { XuProject } from "./projects";
import { mkdirRecursive, writeTextUnderWorkspace } from "./fsBridge";

export const SECURITY_DIR = ".xu/security";
export const SECURITY_CHECKLIST = `${SECURITY_DIR}/RELEASE_CHECKLIST.md`;

export const SECURITY_SECTIONS = [
  { id: "arch", title: "架构稳固", items: ["单点故障与容灾", "限流熔断", "水平扩展", "配置外置", "灰度与回滚"] },
  { id: "ddos", title: "DDoS / 滥用防护", items: ["网关/WAF", "Rate limit", "连接数限制", "慢查询保护", "CDN/静态资源"] },
  { id: "auth", title: "鉴权与权限", items: ["登录与会话", "RBAC/越权", "敏感 API 鉴权", "最小权限"] },
  { id: "input", title: "输入与注入", items: ["SQL 注入", "XSS/CSRF", "文件上传", "路径穿越"] },
  { id: "secrets", title: "密钥与配置", items: ["无硬编码密钥", ".env 不入库", "密钥轮换"] },
  { id: "deps", title: "依赖与漏洞", items: ["锁文件", "CVE 扫描", "过期依赖处理"] },
  { id: "transport", title: "传输与边界", items: ["HTTPS/TLS", "CORS", "安全响应头", "Cookie 属性"] },
  { id: "ops", title: "可观测与应急", items: ["审计日志", "告警", "备份恢复", "事故 runbook"] },
] as const;

function joinRoot(root: string, sub: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const s = sub.replace(/^[/\\]+/, "");
  return `${r}/${s}`.replace(/\\/g, "/");
}

function buildChecklistMarkdown(project: XuProject): string {
  const lines = [
    `# 上线安全清单 · ${project.name}`,
    "",
    "> QA 波后由安全审查波填写；结项前每类至少勾选一项 `[x]`。",
    "",
  ];
  for (const sec of SECURITY_SECTIONS) {
    lines.push(`## ${sec.title}`, "");
    for (const item of sec.items) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function ensureSecurityChecklistDraft(project: XuProject): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return;
  const abs = joinRoot(gen, SECURITY_CHECKLIST);
  if (await exists(abs)) return;
  await mkdirRecursive(gen, joinRoot(gen, SECURITY_DIR));
  await writeTextUnderWorkspace(gen, SECURITY_CHECKLIST, buildChecklistMarkdown(project));
}

export type SecuritySectionStatus = {
  title: string;
  checked: number;
  ok: boolean;
};

export function parseSecurityChecklist(text: string): SecuritySectionStatus[] {
  const out: SecuritySectionStatus[] = [];
  let current: SecuritySectionStatus | null = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (current) out.push(current);
      current = { title: h[1].trim(), checked: 0, ok: false };
      continue;
    }
    if (current && /^\s*-\s*\[x\]/i.test(line)) {
      current.checked += 1;
      current.ok = true;
    }
  }
  if (current) out.push(current);
  return out;
}

export async function hasSecurityChecklistPassed(project: XuProject): Promise<{
  ok: boolean;
  missingSections: string[];
}> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return { ok: false, missingSections: SECURITY_SECTIONS.map((s) => s.title) };
  const abs = joinRoot(gen, SECURITY_CHECKLIST);
  try {
    if (!(await exists(abs))) {
      return { ok: false, missingSections: SECURITY_SECTIONS.map((s) => s.title) };
    }
    const text = await readTextFile(abs);
    if (!/\[x\]/i.test(text)) {
      return { ok: false, missingSections: SECURITY_SECTIONS.map((s) => s.title) };
    }
    const parsed = parseSecurityChecklist(text);
    const requiredTitles = SECURITY_SECTIONS.map((s) => s.title);
    const missing: string[] = [];
    for (const title of requiredTitles) {
      const row = parsed.find((p) => p.title === title);
      if (!row?.ok) missing.push(title);
    }
    return { ok: missing.length === 0, missingSections: missing };
  } catch {
    return { ok: false, missingSections: SECURITY_SECTIONS.map((s) => s.title) };
  }
}

export type SecurityGateFail =
  | "no_security_checklist"
  | "security_empty"
  | "security_incomplete"
  | "ok";

export async function checkSecurityGate(project: XuProject): Promise<{
  ok: boolean;
  reason: SecurityGateFail;
  message: string;
  missingSections?: string[];
}> {
  const gen = (project.generatePath || "").trim();
  if (!gen) {
    return {
      ok: false,
      reason: "no_security_checklist",
      message: "缺少生成路径，无法校验安全清单。",
    };
  }
  const abs = joinRoot(gen, SECURITY_CHECKLIST);
  try {
    if (!(await exists(abs))) {
      return {
        ok: false,
        reason: "no_security_checklist",
        message: "缺少 .xu/security/RELEASE_CHECKLIST.md。请先完成安全审查波。",
      };
    }
    const text = await readTextFile(abs);
    if (!/\[x\]/i.test(text)) {
      return {
        ok: false,
        reason: "security_empty",
        message: "安全清单尚无已勾选项 [x]。请完成架构/DDoS/鉴权等检查并勾选。",
      };
    }
    const { ok, missingSections } = await hasSecurityChecklistPassed(project);
    if (!ok) {
      return {
        ok: false,
        reason: "security_incomplete",
        message: `安全清单未完成必选类目：${missingSections.join("、")}。每类至少勾选一项。`,
        missingSections,
      };
    }
    return { ok: true, reason: "ok", message: "" };
  } catch {
    return {
      ok: false,
      reason: "no_security_checklist",
      message: "无法读取安全清单。",
    };
  }
}

export function buildSecurityWaveTask(project: XuProject, bossText: string): string {
  const root = (project.generatePath || "").trim();
  const boss = bossText.trim().slice(0, 1200);
  return [
    "【Boss 开工 · 安全审查波次】",
    boss,
    `项目：${project.name}`,
    `【可写目录】${root}`,
    `【必须】填写并勾选 ${SECURITY_CHECKLIST}：`,
    "· 架构稳固（单点/限流/灰度回滚）",
    "· DDoS/滥用（WAF、Rate limit、CDN）",
    "· 鉴权与权限（会话、RBAC、越权）",
    "· 输入与注入（SQL/XSS/CSRF/上传/路径穿越）",
    "· 密钥与配置（无硬编码、.env 不入库）",
    "· 依赖与 CVE",
    "· HTTPS/CORS/安全头",
    "· 日志告警与事故 runbook",
    "每类至少勾选一项 [x]。无安全岗时由 QA/架构师兼审。",
    "禁止未勾选就宣称「可上线」。",
  ].join("\n");
}
