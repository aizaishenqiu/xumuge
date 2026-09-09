/**
 * User-owned skills on disk (outside install dir and XU_HOME).
 * Default: {Documents}/虚募阁技能 — uninstall does not delete this folder.
 * Never uploaded.
 */
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { looksLikeSkillMarkdown, parseSkillMarkdown } from "../capabilities/skillMd";
import type { CapabilityPackManifest, InstalledCapabilityPack } from "../capabilities/types";
import { skillAppliesTo } from "./skillBind";

export { skillAppliesTo } from "./skillBind";

export const SKILLS_DATA_DIR_KEY = "xu.skills.dataDir";
const INDEX_FILE = "index.json";
const README_FILE = "README.md";
const DEFAULT_FOLDER = "虚募阁技能";

export interface UserSkillIndexEntry {
  id: string;
  file: string;
  enabled: boolean;
  roleId?: string;
  employeeId?: string;
}

interface UserSkillIndex {
  skills: UserSkillIndexEntry[];
}

type DirEntry = { name: string; path: string; is_dir: boolean };

function normalizeDir(raw: string): string {
  return raw.trim().replace(/[/\\]+$/, "");
}

function joinDir(root: string, ...parts: string[]): string {
  return [normalizeDir(root), ...parts.map((p) => p.replace(/^[/\\]+/, ""))].join("/");
}

export function readCustomSkillsDataDir(): string | null {
  try {
    const raw = localStorage.getItem(SKILLS_DATA_DIR_KEY)?.trim();
    return raw ? normalizeDir(raw) : null;
  } catch {
    return null;
  }
}

async function syncSetting(dir: string): Promise<void> {
  try {
    await invoke("xu_set_setting", { key: SKILLS_DATA_DIR_KEY, value: dir });
  } catch {
    /* rust playbooks still fall back to Documents */
  }
}

export async function defaultSkillsRoot(): Promise<string> {
  try {
    const docs = (await invoke<string>("xu_get_documents_dir")).trim();
    if (docs) return joinDir(docs, DEFAULT_FOLDER);
  } catch {
    /* ignore */
  }
  try {
    const home = (await invoke<string>("get_home_dir")).trim();
    if (home) return joinDir(home, "Documents", DEFAULT_FOLDER);
  } catch {
    /* ignore */
  }
  return DEFAULT_FOLDER;
}

export async function resolveSkillsDataRoot(): Promise<string> {
  const custom = readCustomSkillsDataDir();
  if (custom) {
    await syncSetting(custom);
    return custom;
  }
  try {
    const fromDb = (await invoke<string | null>("xu_get_setting", { key: SKILLS_DATA_DIR_KEY }))?.trim();
    if (fromDb) return normalizeDir(fromDb);
  } catch {
    /* ignore */
  }
  const def = await defaultSkillsRoot();
  await syncSetting(def);
  return def;
}

async function ensureDir(root: string): Promise<void> {
  const dir = normalizeDir(root);
  if (!dir) return;
  const parent = dir.replace(/[/\\][^/\\]+$/, "");
  const ws = parent || dir;
  await invoke("create_workspace_path", { workspace: ws, path: dir, isDir: true });
}

async function writeUnder(root: string, path: string, content: string): Promise<void> {
  await invoke("write_text_file", { workspace: root, path, content });
}

const README_BODY = [
  "# 虚募阁 · 我的技能",
  "",
  "此文件夹存放您自己导入的 SKILL.md / .xucap。",
  "只在本机运行，不会上传到软件服务器。",
  "卸载虚募阁不会删除本文件夹。",
  "可在「设置 → 组件市场」或「岗位库」重新选择此目录。",
  "",
].join("\n");

export async function ensureSkillsDir(): Promise<string> {
  const root = await resolveSkillsDataRoot();
  await ensureDir(root);
  await ensureDir(joinDir(root, "playbooks"));
  const readme = joinDir(root, README_FILE);
  try {
    await invoke<string>("read_text_file", { path: readme });
  } catch {
    try {
      await writeUnder(root, readme, README_BODY);
    } catch {
      /* ignore */
    }
  }
  return root;
}

export async function setSkillsDataDir(dir: string): Promise<string> {
  const next = normalizeDir(dir);
  if (!next) throw new Error("目录无效");
  await ensureDir(next);
  localStorage.setItem(SKILLS_DATA_DIR_KEY, next);
  await syncSetting(next);
  window.dispatchEvent(new CustomEvent("xu-skills-dir-changed", { detail: { path: next } }));
  return next;
}

export async function clearSkillsDataDir(): Promise<void> {
  localStorage.removeItem(SKILLS_DATA_DIR_KEY);
  const def = await defaultSkillsRoot();
  await syncSetting(def);
  window.dispatchEvent(new CustomEvent("xu-skills-dir-changed"));
}

export async function pickSkillsDataDir(): Promise<string | null> {
  const picked = await openFileDialog({
    directory: true,
    multiple: false,
    title: "选择技能目录（不要选软件安装目录）",
  });
  if (!picked || typeof picked !== "string") return null;
  return setSkillsDataDir(picked);
}

export async function skillsDataRootLabel(): Promise<string> {
  const root = await resolveSkillsDataRoot();
  return root ? `${normalizeDir(root)}/` : "{未配置}/";
}

export async function openSkillsFolder(): Promise<void> {
  const root = await ensureSkillsDir();
  await invoke("open_path", { path: root });
}

function safeFileStem(id: string): string {
  const s = id.replace(/[^a-zA-Z0-9._\u4e00-\u9fff-]+/g, "-").replace(/^-|-$/g, "");
  return (s || "skill").slice(0, 80);
}

async function readIndex(root: string): Promise<UserSkillIndex> {
  try {
    const raw = await invoke<string>("read_text_file", { path: joinDir(root, INDEX_FILE) });
    const parsed = JSON.parse(raw) as Partial<UserSkillIndex>;
    const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
    return {
      skills: skills
        .map((row) => ({
          id: String(row?.id || "").trim(),
          file: String(row?.file || "").trim(),
          enabled: row?.enabled !== false,
          roleId: String(row?.roleId || "").trim() || undefined,
          employeeId: String(row?.employeeId || "").trim() || undefined,
        }))
        .filter((r) => r.id && r.file),
    };
  } catch {
    return { skills: [] };
  }
}

async function writeIndex(root: string, index: UserSkillIndex): Promise<void> {
  await writeUnder(root, joinDir(root, INDEX_FILE), JSON.stringify(index, null, 2));
}

function skipScanName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "readme.md" || n === INDEX_FILE || n.startsWith(".");
}

function isSkillFile(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith(".md") || n.endsWith(".json") || n.endsWith(".xucap");
}

function parseFile(raw: string, path: string): Partial<CapabilityPackManifest> | null {
  try {
    if (looksLikeSkillMarkdown(raw, path)) {
      return parseSkillMarkdown(raw);
    }
    const json = JSON.parse(raw) as Partial<CapabilityPackManifest>;
    if (!json?.id || !json?.name) return null;
    return json;
  } catch {
    return null;
  }
}

async function listFiles(dir: string): Promise<DirEntry[]> {
  try {
    return await invoke<DirEntry[]>("list_dir", { path: dir, includeHidden: false });
  } catch {
    return [];
  }
}

export async function scanUserSkills(): Promise<InstalledCapabilityPack[]> {
  const root = await ensureSkillsDir();
  const index = await readIndex(root);
  const byFile = new Map(index.skills.map((s) => [s.file.replace(/\\/g, "/"), s]));
  const out: InstalledCapabilityPack[] = [];
  const seen = new Set<string>();

  const folders = [root, joinDir(root, "playbooks")];
  for (const folder of folders) {
    const entries = await listFiles(folder);
    for (const ent of entries) {
      if (ent.is_dir || skipScanName(ent.name) || !isSkillFile(ent.name)) continue;
      let raw = "";
      try {
        raw = await invoke<string>("read_text_file", { path: ent.path });
      } catch {
        continue;
      }
      const parsed = parseFile(raw, ent.path);
      if (!parsed?.id || !parsed.name) continue;
      const rel =
        folder === root ? ent.name : `playbooks/${ent.name}`;
      const idx = byFile.get(rel) || byFile.get(ent.name);
      const roleId = (idx?.roleId || parsed.roleId || "").trim() || undefined;
      const employeeId = (idx?.employeeId || parsed.employeeId || "").trim() || undefined;
      const manifest: CapabilityPackManifest = {
        id: String(parsed.id).trim(),
        name: String(parsed.name).trim(),
        description: String(parsed.description || parsed.name).trim(),
        version: String(parsed.version || "1.0.0").trim(),
        agentToolHints: String(parsed.agentToolHints || "").trim() || undefined,
        fileExtensions: Array.isArray(parsed.fileExtensions) ? parsed.fileExtensions : undefined,
        officeTools: parsed.officeTools === true,
        helpDoc: parsed.helpDoc,
        roleId,
        employeeId,
        sourcePath: ent.path,
      };
      if (seen.has(manifest.id)) continue;
      seen.add(manifest.id);
      out.push({
        manifest,
        enabled: idx ? idx.enabled !== false : true,
        userOwned: true,
      });
    }
  }
  return out;
}

export async function setUserSkillEnabled(id: string, enabled: boolean): Promise<void> {
  const root = await ensureSkillsDir();
  const index = await readIndex(root);
  const packs = await scanUserSkills();
  const hit = packs.find((p) => p.manifest.id === id);
  if (!hit?.manifest.sourcePath) throw new Error("未找到该本机技能");
  const file = hit.manifest.sourcePath.replace(/\\/g, "/");
  const rootN = root.replace(/\\/g, "/");
  const rel = file.startsWith(rootN) ? file.slice(rootN.length).replace(/^[/\\]+/, "") : file.split("/").pop() || "";
  const next: UserSkillIndexEntry[] = index.skills.filter((s) => s.id !== id);
  next.push({
    id,
    file: rel,
    enabled,
    roleId: hit.manifest.roleId,
    employeeId: hit.manifest.employeeId,
  });
  await writeIndex(root, { skills: next });
}

export async function importUserSkillFile(
  srcPath: string,
  opts?: { roleId?: string; employeeId?: string },
): Promise<InstalledCapabilityPack> {
  const root = await ensureSkillsDir();
  const raw = await invoke<string>("read_text_file", { path: srcPath });
  let parsed: Partial<CapabilityPackManifest>;
  if (looksLikeSkillMarkdown(raw, srcPath)) {
    parsed = parseSkillMarkdown(raw);
  } else {
    parsed = JSON.parse(raw) as Partial<CapabilityPackManifest>;
  }
  if (!parsed.id || !parsed.name) throw new Error("技能文件缺少 id 或 name");
  const roleId = (opts?.roleId || parsed.roleId || "").trim() || undefined;
  const employeeId = (opts?.employeeId || parsed.employeeId || "").trim() || undefined;
  const ext = srcPath.toLowerCase().endsWith(".md") ? ".md" : srcPath.toLowerCase().endsWith(".xucap") ? ".xucap" : ".json";
  const destName = `${safeFileStem(String(parsed.id))}${ext}`;
  const dest = joinDir(root, destName);
  let body = raw;
  if (ext === ".md" && roleId && !/^roleId:/m.test(raw) && raw.startsWith("---")) {
    body = raw.replace(/^---\r?\n/, `---\nroleId: ${roleId}\n`);
  } else if (ext !== ".md") {
    body = JSON.stringify(
      { ...parsed, roleId, employeeId },
      null,
      2,
    );
  }
  await writeUnder(root, dest, body);
  const index = await readIndex(root);
  const next = index.skills.filter((s) => s.id !== parsed.id);
  next.push({
    id: String(parsed.id),
    file: destName,
    enabled: true,
    roleId,
    employeeId,
  });
  await writeIndex(root, { skills: next });
  return {
    manifest: {
      id: String(parsed.id),
      name: String(parsed.name),
      description: String(parsed.description || parsed.name),
      version: String(parsed.version || "1.0.0"),
      agentToolHints: parsed.agentToolHints,
      roleId,
      employeeId,
      sourcePath: dest,
    },
    enabled: true,
    userOwned: true,
  };
}

export async function pickAndImportUserSkill(opts?: {
  roleId?: string;
}): Promise<InstalledCapabilityPack | null> {
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: "技能 / 能力包", extensions: ["md", "xucap", "json"] }],
    title: "导入 SKILL.md（仅复制到本机技能目录，不上传）",
  });
  if (!path || typeof path !== "string") return null;
  return importUserSkillFile(path, opts);
}

export async function buildUserSkillHints(
  roleId?: string | null,
  employeeId?: string | null,
): Promise<string> {
  const packs = await scanUserSkills();
  const hints = packs
    .filter((p) => p.enabled && skillAppliesTo(p.manifest, roleId, employeeId))
    .map((p) => p.manifest.agentToolHints?.trim())
    .filter(Boolean);
  if (!hints.length) return "";
  return `【本机技能 · 不上传 · 卸载软件不删除】\n${hints.join("\n\n")}`;
}
