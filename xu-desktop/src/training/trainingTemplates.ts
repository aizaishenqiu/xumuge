/**
 * @file 本机训练模板：员工课程 / MCP playbook 样例下载与导入
 * @author qiuye <yjk150@qq.com>
 * @updated 2026-09-02
 * @version 1.1.0
 * @category Training
 * @algo template-seed
 */
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import employeeDemo from "./templates/employee-curriculum.demo.json";
import mcpDemo from "./templates/mcp-training.demo.json";
import {
  loadCurriculum,
  migrateCurriculum,
  saveCurriculum,
  type CurriculumDoc,
} from "../commerce/trainingLocal";
import {
  loadMcpTraining,
  saveMcpTraining,
  type McpTrainingDoc,
} from "./mcpTraining";
import { mergeCurriculumEntries } from "./xutrain";
import {
  ensureTrainingDirsAt,
  joinTrainingFile,
  readTrainingRootOrThrow,
  writeTrainingText,
} from "./trainingStore";

const EMPLOYEE_README = `# 员工训练模板说明

1. 用「本机完整训练 → 训练员工」编辑或导入本 JSON。
2. 保存后状态为草稿；点「运行评测」再「晋级」后才会注入派活提示。
3. 「更聪明」请到设置 → 模型换更强三脑；本文件只教「怎么做事」。
`;

const MCP_README = `# MCP 训练模板说明

1. 先在设置 → MCP 启用真实 Server，再「刷新工具」。
2. 本样例工具名为演示名；请对照真实工具改 toolName 后保存。
3. 保存为草稿后须「评测并晋级」才会注入 Agent。
`;

/**
 * Duty: write employee curriculum demo JSON under training root templates/.
 * Failure: throws if training root unresolved or write fails.
 */
export async function downloadEmployeeCurriculumTemplate(): Promise<string> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  const dir = joinTrainingFile(root, "templates");
  await invoke("create_workspace_path", { workspace: root, path: dir, isDir: true });
  const path = joinTrainingFile(dir, "employee-curriculum.demo.json");
  await writeTrainingText(root, path, JSON.stringify(employeeDemo, null, 2));
  await writeTrainingText(root, joinTrainingFile(dir, "README-employee.md"), EMPLOYEE_README);
  return path;
}

/**
 * Duty: write MCP training demo JSON under training root templates/.
 * Failure: throws if training root unresolved or write fails.
 */
export async function downloadMcpTrainingTemplate(): Promise<string> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  const dir = joinTrainingFile(root, "templates");
  await invoke("create_workspace_path", { workspace: root, path: dir, isDir: true });
  const path = joinTrainingFile(dir, "mcp-training.demo.json");
  await writeTrainingText(root, path, JSON.stringify(mcpDemo, null, 2));
  await writeTrainingText(root, joinTrainingFile(dir, "README-mcp.md"), MCP_README);
  return path;
}

/**
 * Duty: optional Save-As copy of employee template for user-chosen path.
 * Failure: returns null if cancelled.
 */
export async function saveEmployeeTemplateAs(): Promise<string | null> {
  const root = await readTrainingRootOrThrow();
  const picked = await saveDialog({
    defaultPath: joinTrainingFile(root, "employee-curriculum.demo.json"),
    filters: [{ name: "JSON", extensions: ["json"] }],
    title: "另存员工训练模板",
  });
  if (!picked || typeof picked !== "string") return null;
  await invoke("write_text_file", {
    workspace: root,
    path: picked,
    content: JSON.stringify(employeeDemo, null, 2),
  });
  return picked;
}

/**
 * Duty: merge bundled employee demo into local curriculum.json.
 * Failure: throws on load/save errors.
 */
export async function importEmployeeDemoIntoCurriculum(): Promise<number> {
  const cur = await loadCurriculum();
  const incoming = migrateCurriculum(employeeDemo as CurriculumDoc);
  const before = cur.entries.length;
  cur.entries = mergeCurriculumEntries(cur.entries, incoming.entries);
  await saveCurriculum(cur);
  return cur.entries.length - before;
}

/**
 * Duty: merge bundled MCP demo tools into local mcp-training.json (by toolName).
 * Failure: throws on load/save errors.
 */
export async function importMcpDemoIntoTraining(): Promise<number> {
  const doc = await loadMcpTraining();
  const demo = mcpDemo as McpTrainingDoc;
  const before = doc.tools.length;
  const keys = new Set(doc.tools.map((t) => `${t.toolName}:v${t.version || 1}`));
  for (const t of demo.tools || []) {
    const k = `${t.toolName}:v${t.version || 1}`;
    if (!keys.has(k)) {
      doc.tools.push(t);
      keys.add(k);
    }
  }
  await saveMcpTraining(doc);
  return doc.tools.length - before;
}

/** Duty: reveal training data folder in OS file manager. */
export async function openTrainingDataFolder(): Promise<void> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  await invoke("open_path", { path: root });
}

/**
 * Duty: reveal training templates/ subfolder (after template download).
 * Failure: throws if path missing or open_path fails.
 */
export async function openTrainingTemplatesFolder(): Promise<void> {
  const root = await readTrainingRootOrThrow();
  await ensureTrainingDirsAt(root);
  const dir = joinTrainingFile(root, "templates");
  await invoke("create_workspace_path", { workspace: root, path: dir, isDir: true });
  await invoke("open_path", { path: dir });
}
