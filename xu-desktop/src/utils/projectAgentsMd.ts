/**
 * First-class repo spec (AGENTS.md) — same path for read + write, outside the app install dir.
 */
import { invoke } from "@tauri-apps/api/core";
import { writeTextUnderWorkspace } from "./fsBridge";

export function agentsMdPath(workspaceRoot: string): string {
  return `${workspaceRoot.replace(/[/\\]+$/, "")}/AGENTS.md`;
}

export function buildAgentsMdBody(opts: { projectName: string; playbookPath?: string }): string {
  const playbook = opts.playbookPath?.trim() || "REQUIREMENTS_PLAYBOOK.md";
  return [
    `# AGENTS.md · ${opts.projectName}`,
    "",
    "本仓库由虚募阁员工执行。此文件与 playbook 同目录，升级软件不会覆盖（写在项目生成路径内）。",
    "",
    "## 必读",
    "",
    `- 操作说明：\`${playbook}\``,
    "- 先读本文件与 playbook，再用 list_dir / read_file 核实目录，禁止猜测布局。",
    "",
    "## 写码闭环",
    "",
    "1. 小步修改：优先 `apply_patch` / `write_file`。",
    "2. 每轮写入后，若仓库已有脚本则跑 lint/test（`pnpm test` / `npm test` / `cargo test` 等以 package.json / Cargo.toml 为准）。",
    "3. 失败则立刻再改，最多两轮；禁止空口声称「已通过」。",
    "4. 可用 `git`：status / diff / log / add / commit；`push` 需老板审批后推到已配置的 remote（默认 origin）。",
    "",
    "## 老板补充",
    "",
    "若消息带「老板补充 / 中途转向」，优先按补充调整当前任务，不要另起无关项目。",
    "",
    "## 禁止",
    "",
    "- 复制或仿制虚募阁本身",
    "- 把密钥、`.env` 提交进仓库",
    "- 未经审批 `git push` 到未配置的陌生 URL",
    "",
  ].join("\n");
}

export async function writeProjectAgentsMd(opts: {
  workspaceRoot: string;
  projectName: string;
  playbookPath?: string;
}): Promise<string> {
  const path = agentsMdPath(opts.workspaceRoot);
  await writeTextUnderWorkspace(
    opts.workspaceRoot,
    path,
    buildAgentsMdBody({ projectName: opts.projectName, playbookPath: opts.playbookPath }),
  );
  return path;
}

export async function readAgentsMdExcerpt(workspaceRoot: string, maxChars = 3500): Promise<string> {
  const path = agentsMdPath(workspaceRoot);
  try {
    const raw = await invoke<string>("read_text_file", { path });
    const t = (raw || "").trim();
    if (!t) return "";
    return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
  } catch {
    return "";
  }
}

export function agentsMdDispatchHint(excerpt: string, path: string): string {
  if (!excerpt.trim()) {
    return `【仓库规范】若存在 \`${path}\` 必须先读再改代码。`;
  }
  return `【仓库规范 AGENTS.md】\n${excerpt}`;
}

export const WRITEBACK_LOOP_HINT = [
  "【写后闭环】每次 apply_patch / write_file 后：",
  "若工作区有 package.json / Cargo.toml / go.mod，用 shell_exec 跑仓库已有的 lint 或 test（不要发明不存在的脚本）。",
  "失败则立刻修补，最多再两轮；测试没配则至少 list_dir 确认文件真实存在。",
].join("\n");
