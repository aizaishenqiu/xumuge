<script setup lang="ts">
/**
 * @file IDE 源代码管理：逐层选路径、加仓与按仓上传
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @updated 2026-09-05
 * @version 1.4.0
 * @category UI
 * @algo ide-git-sqlite-registry
 */
import { onApiCatch } from "../../../utils/userFacingError";
import { FouButton, FouDialog, fouAlert, fouMsg } from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { toRelativePath } from "../../../utils/chatWorkspace";
import {
  mergeBlockReason,
  readCodeReviewGate,
  type CodeReviewGate,
} from "../../../utils/codeReviewGate";
import { mainCommitBlockReason } from "../../../utils/gitBranchPolicy";
import type { ProjectGitConfig } from "../../../utils/projects";
import type { LintDiagnostic } from "../../../utils/workspaceLint";
import { toUserError } from "../../../utils/userFacingError";

const props = defineProps<{
  workingDir: string | null;
  projectGit?: ProjectGitConfig | null;
  diagnostics?: LintDiagnostic[];
}>();

type GitRemoteInfo = { name: string; url: string };
type GitRepoInfo = {
  path: string;
  name: string;
  branch: string;
  remotes: GitRemoteInfo[];
};
type GitResolvedPath = GitRepoInfo & { relative: string; kind: string };
type FsEntry = { name: string; path: string; is_dir: boolean };
type GitRemoteRow = { id: string; name: string; url: string; provider: string };
type GitRepoRow = {
  id: string;
  localPath: string;
  displayName: string;
  defaultBranch: string;
  lastBranch: string;
  cloudFullName: string;
  remotes: GitRemoteRow[];
};
type GitAccountView = { provider: string; username: string; hasToken: boolean; baseUrl?: string };
type GitCloudRepo = { fullName: string; cloneUrl: string };
type TokenProvider = "gitee" | "github" | "custom";

const SKIP_SCOPE_DIRS = new Set([
  "node_modules",
  "dist",
  "target",
  "vendor",
  "build",
  ".next",
  ".xu",
  "out",
]);

const loading = ref(false);
const discovering = ref(false);
const gitRepos = ref<GitRepoInfo[]>([]);
const registeredRepos = ref<GitRepoRow[]>([]);
const selectedRepoId = ref("");
const selectedRepoPath = ref("");
const selectedRemoteName = ref("");
const uploadScopeRel = ref("");
const scopeKind = ref<"repo" | "dir" | "file">("repo");
const browseCwd = ref("");
const browseEntries = ref<FsEntry[]>([]);
const browseLoading = ref(false);
const applyingRepo = ref(false);
const statusLines = ref<string[]>([]);
const branchLine = ref("");
const commitMsg = ref("");
const pushing = ref(false);
const fetching = ref(false);
const pulling = ref(false);
const syncing = ref(false);
const merging = ref(false);
const reviewGate = ref<CodeReviewGate | null>(null);
const branchOptions = ref<string[]>([]);
const branchSelectOptions = computed(() =>
  branchOptions.value.map((b) => ({ value: b, label: b })),
);
const selectedBranch = ref("");
const diffOpen = ref(false);
const diffTitle = ref("");
const diffText = ref("");
const diffLoading = ref(false);
const tokenOpen = ref(false);
const tokenProvider = ref<TokenProvider>("gitee");
const tokenUsername = ref("");
const tokenSecret = ref("");
const tokenBaseUrl = ref("");
const cloudRepos = ref<GitCloudRepo[]>([]);
const cloudBusy = ref(false);
const accounts = ref<GitAccountView[]>([]);
const importOpen = ref(false);
const importBusy = ref(false);
const importCandidates = ref<GitRepoInfo[]>([]);
const importPromptDone = ref(false);

function xuUser(): string {
  try {
    const raw = localStorage.getItem("xu.auth.session");
    if (!raw) return "local";
    const s = JSON.parse(raw) as { user?: { username?: string; id?: string } };
    return (s.user?.username || s.user?.id || "local").trim() || "local";
  } catch {
    return "local";
  }
}

function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}

function shortRemoteUrl(url: string): string {
  const cleaned = url.trim().replace(/\.git$/i, "");
  const ssh = cleaned.match(/^.+@([^:]+):(.+)$/);
  if (ssh) {
    const parts = ssh[2].split("/").filter(Boolean);
    return `${ssh[1]}/${parts.slice(-2).join("/")}`;
  }
  try {
    const u = new URL(cleaned);
    const parts = u.pathname.split("/").filter(Boolean);
    return `${u.host}/${parts.slice(-2).join("/")}`;
  } catch {
    return cleaned.length > 40 ? `…${cleaned.slice(-36)}` : cleaned;
  }
}

function providerFromUrl(url: string): TokenProvider | "" {
  const u = url.toLowerCase();
  if (u.includes("gitee.com")) return "gitee";
  if (u.includes("github.com")) return "github";
  if (
    u.startsWith("http://") ||
    u.startsWith("https://") ||
    u.includes("git@") ||
    u.startsWith("ssh://")
  ) {
    return "custom";
  }
  return "";
}

function cloudLabelFromUrl(url: string, fallback = ""): string {
  const short = shortRemoteUrl(url);
  const parts = short.split("/");
  if (parts.length >= 2) return parts.slice(-2).join("/");
  return fallback || short || url;
}

function repoWorkspace(): string {
  return selectedRepoPath.value.trim();
}

function joinAbs(base: string, name: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${sep}${name}`;
}

function parentDir(path: string): string {
  const n = path.replace(/[\\/]+$/, "");
  const i = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
  if (i <= 0) return n;
  if (/^[a-zA-Z]:$/.test(n.slice(0, i))) return n.slice(0, i + 1);
  return n.slice(0, i);
}

function isUnderOrSame(child: string, parent: string): boolean {
  const c = child.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const p = parent.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return c === p || c.startsWith(`${p}/`);
}

const repoSelectOptions = computed(() => {
  const map = new Map<string, { value: string; label: string }>();
  for (const r of registeredRepos.value) {
    map.set(r.localPath.replace(/\\/g, "/").toLowerCase(), {
      value: r.localPath,
      label: r.displayName || r.localPath,
    });
  }
  for (const r of gitRepos.value) {
    const key = r.path.replace(/\\/g, "/").toLowerCase();
    if (map.has(key)) continue;
    map.set(key, {
      value: r.path,
      label: r.branch ? `${r.name}（${r.branch}）` : r.name,
    });
  }
  return [...map.values()];
});

const currentRegistered = computed(() =>
  registeredRepos.value.find((r) => samePath(r.localPath, selectedRepoPath.value)),
);

const currentRepo = computed(() =>
  gitRepos.value.find((r) => samePath(r.path, selectedRepoPath.value)),
);

const isSelectedRegistered = computed(() => !!currentRegistered.value);

const remoteSelectOptions = computed(() => {
  const fromDb = currentRegistered.value?.remotes ?? [];
  if (fromDb.length) {
    return fromDb.map((r) => ({
      value: r.name,
      label: r.url ? `${r.name} · ${shortRemoteUrl(r.url)}` : r.name,
    }));
  }
  return (currentRepo.value?.remotes ?? []).map((r) => ({
    value: r.name,
    label: r.url ? `${r.name} · ${shortRemoteUrl(r.url)}` : r.name,
  }));
});

const localCloudSeed = computed((): GitCloudRepo[] => {
  const want = tokenProvider.value;
  const byUrl = new Map<string, GitCloudRepo>();
  const add = (cloneUrl: string, fullName: string) => {
    const url = cloneUrl.trim();
    if (!url) return;
    if (providerFromUrl(url) !== want) return;
    if (!byUrl.has(url)) {
      byUrl.set(url, { fullName: fullName || cloudLabelFromUrl(url), cloneUrl: url });
    }
  };
  for (const repo of registeredRepos.value) {
    for (const r of repo.remotes) {
      add(r.url, repo.cloudFullName || cloudLabelFromUrl(r.url));
    }
  }
  for (const r of currentRepo.value?.remotes ?? []) {
    add(r.url, cloudLabelFromUrl(r.url));
  }
  return [...byUrl.values()];
});

const cloudSelectOptions = computed(() => {
  const byUrl = new Map<string, { value: string; label: string }>();
  for (const c of localCloudSeed.value) {
    byUrl.set(c.cloneUrl, { value: c.cloneUrl, label: c.fullName });
  }
  for (const c of cloudRepos.value) {
    byUrl.set(c.cloneUrl, { value: c.cloneUrl, label: c.fullName });
  }
  return [...byUrl.values()];
});
const selectedCloudUrl = ref("");
const pasteRemoteUrl = ref("");
const bindBusy = ref(false);
const accountHint = computed(() => {
  const a = accounts.value.find((x) => x.provider === tokenProvider.value);
  const name =
    tokenProvider.value === "github"
      ? "GitHub"
      : tokenProvider.value === "custom"
        ? "自建 Git"
        : "Gitee";
  if (!a?.hasToken) {
    if (tokenProvider.value === "custom") {
      return `尚未保存 ${name} 账户凭证（服务器地址 + 用户名 + 令牌/密码）`;
    }
    if (tokenProvider.value === "github") {
      return `尚未保存 ${name} 账户凭证（私人令牌；用户名可选）`;
    }
    return `尚未保存 ${name} 账户凭证（用户名 + 私人令牌）`;
  }
  const who = a.username ? `${a.username} · ` : "";
  return `${who}已保存 ${name} 账户凭证；令牌留空表示不改动`;
});

const tokenUsernamePlaceholder = computed(() => {
  if (tokenProvider.value === "gitee") return "Gitee 登录用户名（必填）";
  if (tokenProvider.value === "custom") return "自建 Git 用户名（必填）";
  return "GitHub 用户名（可选）";
});

const hasProviderToken = computed(() =>
  !!accounts.value.find((x) => x.provider === tokenProvider.value)?.hasToken,
);

const cloudEmptyHint = computed(() => {
  if (cloudSelectOptions.value.length) return "";
  if (tokenProvider.value === "custom") {
    return "自建 Git 无云端列表，请用下方「粘贴地址」绑定仓库";
  }
  if (!hasProviderToken.value) {
    return `请先点「账户」保存 ${tokenProvider.value === "github" ? "GitHub" : "Gitee"} 凭证并点「刷新」，或在下方粘贴远程地址绑定`;
  }
  return "点「刷新」拉取账号下仓库，或粘贴 HTTPS 地址绑定";
});

const registeredListRows = computed(() =>
  registeredRepos.value.map((r) => {
    const remote = r.remotes.find((x) => x.name === "origin") || r.remotes[0];
    return {
      id: r.id,
      path: r.localPath,
      name: r.displayName || r.localPath,
      remoteShort: remote?.url ? shortRemoteUrl(remote.url) : "未绑定远程",
      active: samePath(r.localPath, selectedRepoPath.value),
    };
  }),
);

const browseFolders = computed(() => browseEntries.value.filter((e) => e.is_dir));
const browseFiles = computed(() => browseEntries.value.filter((e) => !e.is_dir));

const canGoUp = computed(() => {
  const root = props.workingDir?.trim();
  const cwd = browseCwd.value.trim();
  if (!cwd) return false;
  if (root && samePath(cwd, root)) return false;
  return parentDir(cwd).length > 0 && parentDir(cwd) !== cwd;
});

const breadcrumbs = computed(() => {
  const cwd = browseCwd.value.trim();
  const root = props.workingDir?.trim();
  if (!cwd) return [] as { label: string; path: string }[];
  if (root && isUnderOrSame(cwd, root)) {
    const rel = toRelativePath(root, cwd);
    const parts = rel === "." ? [] : rel.split(/[\\/]/).filter(Boolean);
    const out: { label: string; path: string }[] = [{ label: "工作区", path: root }];
    let acc = root;
    for (const part of parts) {
      acc = joinAbs(acc, part);
      out.push({ label: part, path: acc });
    }
    return out;
  }
  return [{ label: cwd.split(/[\\/]/).filter(Boolean).pop() || cwd, path: cwd }];
});

const scopeHint = computed(() => {
  if (scopeKind.value === "file" && uploadScopeRel.value) return uploadScopeRel.value;
  if (uploadScopeRel.value) return `${uploadScopeRel.value}/`;
  return currentRepo.value?.name ? `整个 ${currentRepo.value.name}` : "整个当前仓库";
});

const defaultBranch = computed(() => props.projectGit?.defaultBranch?.trim() || "");
const lintErrorCount = computed(
  () => (props.diagnostics ?? []).filter((d) => d.severity === "error").length,
);
const mergeBlocked = computed(() => mergeBlockReason(reviewGate.value, lintErrorCount.value));
const mainBlocked = computed(() => mainCommitBlockReason(currentBranchName()));

async function refreshReviewGate() {
  const ws = props.workingDir?.trim();
  if (!ws) {
    reviewGate.value = null;
    return;
  }
  reviewGate.value = await readCodeReviewGate(ws);
}

function parseStatus(raw: string) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  branchLine.value = lines.find((l) => l.startsWith("##")) ?? "";
  statusLines.value = lines.filter((l) => !l.startsWith("##"));
}

function parseBranches(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let name = t.replace(/^\*\s+/, "");
    if (name.includes(" -> ")) continue;
    if (name.startsWith("remotes/")) {
      name = name.replace(/^remotes\/[^/]+\//, "");
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function currentBranchName(): string {
  const m = branchLine.value.match(/^##\s+([^.\s]+)/);
  return m?.[1] ?? "";
}

function relPathFromStatus(line: string): string {
  const path = line.slice(3).trim();
  const ws = repoWorkspace();
  return ws ? toRelativePath(ws, path) : path;
}

function absPathFromStatus(line: string): string {
  const path = line.slice(3).trim();
  const ws = repoWorkspace();
  if (!ws) return path;
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/")) return path;
  const sep = ws.includes("\\") ? "\\" : "/";
  return `${ws.replace(/[\\/]+$/, "")}${sep}${path.replace(/\//g, sep)}`;
}

function joinRepoPath(rel: string): string {
  const ws = repoWorkspace();
  if (!ws) return rel;
  if (!rel) return ws;
  const sep = ws.includes("\\") ? "\\" : "/";
  return `${ws.replace(/[\\/]+$/, "")}${sep}${rel.replace(/\//g, sep)}`;
}

function inScope(line: string): boolean {
  if (!uploadScopeRel.value) return true;
  const rel = relPathFromStatus(line).replace(/\\/g, "/");
  const s = uploadScopeRel.value.replace(/\\/g, "/");
  if (scopeKind.value === "file") return rel === s;
  return rel === s || rel.startsWith(`${s}/`);
}

const visibleStatusLines = computed(() => statusLines.value.filter(inScope));

function pickDefaultRemote() {
  const names = remoteSelectOptions.value.map((r) => r.value);
  const last = currentRegistered.value?.lastBranch;
  if (currentRegistered.value?.remotes.some((r) => r.name === selectedRemoteName.value)) {
    return;
  }
  const remotes =
    currentRegistered.value?.remotes?.length
      ? currentRegistered.value.remotes
      : currentRepo.value?.remotes ?? [];
  const samePlatform = remotes.find(
    (r) => names.includes(r.name) && providerFromUrl(r.url) === tokenProvider.value,
  );
  if (samePlatform) {
    selectedRemoteName.value = samePlatform.name;
    return;
  }
  const preferred = props.projectGit?.pushRemote?.trim();
  if (preferred && names.includes(preferred)) {
    selectedRemoteName.value = preferred;
    return;
  }
  if (names.includes("origin")) {
    selectedRemoteName.value = "origin";
    return;
  }
  selectedRemoteName.value = names[0] ?? "";
  if (last && branchOptions.value.includes(last)) {
    selectedBranch.value = last;
  }
}

/** When cloud platform changes, keep「上传到」 on a same-host remote. */
function alignUploadRemoteToProvider(opts?: { notify?: boolean }) {
  const remotes =
    currentRegistered.value?.remotes?.length
      ? currentRegistered.value.remotes
      : currentRepo.value?.remotes ?? [];
  const current = remotes.find((r) => r.name === selectedRemoteName.value);
  if (current && providerFromUrl(current.url) === tokenProvider.value) return;
  const hit = remotes.find((r) => providerFromUrl(r.url) === tokenProvider.value);
  if (hit) {
    selectedRemoteName.value = hit.name;
    return;
  }
  if (current && providerFromUrl(current.url) && providerFromUrl(current.url) !== tokenProvider.value) {
    selectedRemoteName.value = "";
    if (opts?.notify) {
      fouMsg.info(
        `当前远程属于 ${providerFromUrl(current.url) === "github" ? "GitHub" : "Gitee"}，已清空「上传到」选中，请绑定或选择对应平台远程`,
      );
    }
  }
}

function remotesForUpsert(remotes: GitRemoteInfo[]) {
  return remotes
    .filter((r) => r.name.trim() && r.url.trim())
    .map((r) => ({
      name: r.name,
      url: r.url,
      provider: providerFromUrl(r.url) || null,
    }));
}

function mergeResolvedRepo(info: GitRepoInfo) {
  if (!gitRepos.value.some((r) => samePath(r.path, info.path))) {
    gitRepos.value = [...gitRepos.value, info].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  } else {
    gitRepos.value = gitRepos.value.map((r) => (samePath(r.path, info.path) ? { ...r, ...info } : r));
  }
  applyingRepo.value = true;
  selectedRepoPath.value = info.path;
}

async function loadBrowseEntries() {
  const dir = browseCwd.value.trim();
  if (!dir) {
    browseEntries.value = [];
    return;
  }
  browseLoading.value = true;
  try {
    const entries = await invoke<FsEntry[]>("list_dir", { path: dir, includeHidden: false });
    browseEntries.value = entries.filter((e) => !SKIP_SCOPE_DIRS.has(e.name) && !e.name.startsWith("."));
  } catch {
    browseEntries.value = [];
  } finally {
    browseLoading.value = false;
  }
}

async function syncRepoFromPath(abs: string, asFile: boolean) {
  try {
    const resolved = await invoke<GitResolvedPath>("git_resolve_path", { path: abs });
    mergeResolvedRepo(resolved);
    uploadScopeRel.value = resolved.relative;
    scopeKind.value =
      asFile || resolved.kind === "file" ? "file" : resolved.relative ? "dir" : "repo";
    // 仅已登记仓库才自动 upsert；避免浏览时抢先登记导致导入弹窗被跳过
    const already = registeredRepos.value.some((r) => samePath(r.localPath, resolved.path));
    if (already) {
      void registerLocalPath(resolved.path, resolved.name, resolved.remotes).catch(() => undefined);
    }
    pickDefaultRemote();
    await refresh();
  } catch {
    if (repoWorkspace() && isUnderOrSame(abs, repoWorkspace())) {
      const rel = toRelativePath(repoWorkspace(), abs);
      uploadScopeRel.value = rel === "." ? "" : rel.replace(/\\/g, "/");
      scopeKind.value = asFile ? "file" : uploadScopeRel.value ? "dir" : "repo";
    }
  } finally {
    await nextTick();
    applyingRepo.value = false;
  }
}

async function enterDir(abs: string) {
  browseCwd.value = abs;
  await loadBrowseEntries();
  await syncRepoFromPath(abs, false);
}

async function goUp() {
  if (!canGoUp.value) return;
  await enterDir(parentDir(browseCwd.value));
}

async function goBreadcrumb(path: string) {
  await enterDir(path);
}

async function selectFile(abs: string) {
  await syncRepoFromPath(abs, true);
}

async function pickFolderJump() {
  const selected = await openFileDialog({
    directory: true,
    multiple: false,
    defaultPath: browseCwd.value || props.workingDir?.trim() || undefined,
  });
  if (typeof selected !== "string" || !selected.trim()) return;
  await enterDir(selected);
}

async function pickFileJump() {
  const selected = await openFileDialog({
    directory: false,
    multiple: false,
    defaultPath: browseCwd.value || props.workingDir?.trim() || undefined,
  });
  if (typeof selected !== "string" || !selected.trim()) return;
  const parent = parentDir(selected);
  browseCwd.value = parent;
  await loadBrowseEntries();
  await syncRepoFromPath(selected, true);
}

async function loadRegistry() {
  registeredRepos.value = await invoke<GitRepoRow[]>("git_registry_list", { xuUser: xuUser() });
  const hit = registeredRepos.value.find((r) => samePath(r.localPath, selectedRepoPath.value));
  selectedRepoId.value = hit?.id ?? registeredRepos.value[0]?.id ?? "";
}

async function registerLocalPath(abs: string, displayName?: string, remotes?: GitRemoteInfo[]) {
  const list = remotesForUpsert(remotes ?? []);
  const row = await invoke<GitRepoRow>("git_registry_upsert", {
    xuUser: xuUser(),
    localPath: abs,
    displayName: displayName ?? null,
    defaultBranch: currentBranchName() || null,
    remotes: list.length ? list : null,
  });
  await loadRegistry();
  selectedRepoId.value = row.id;
  return row;
}

async function loadAccounts() {
  accounts.value = await invoke<GitAccountView[]>("git_account_list", { xuUser: xuUser() });
}

async function addRepo() {
  const selected = await openFileDialog({
    directory: true,
    multiple: false,
    defaultPath: props.workingDir?.trim() || undefined,
  });
  if (typeof selected !== "string" || !selected.trim()) return;
  try {
    const resolved = await invoke<GitResolvedPath>("git_resolve_path", { path: selected });
    mergeResolvedRepo(resolved);
    await registerLocalPath(resolved.path, resolved.name, resolved.remotes);
    pickDefaultRemote();
    await enterDir(resolved.path);
    fouMsg.success(`已登记仓库 ${resolved.name}`);
  } catch (e) {
    void fouAlert(`${toUserError(e)}。请选择含 Git 的文件夹。`, "Git");
  }
}

async function removeRegisteredRepo() {
  const id = currentRegistered.value?.id || selectedRepoId.value;
  if (!id) return;
  await invoke("git_registry_remove", { xuUser: xuUser(), repoId: id });
  await loadRegistry();
  gitRepos.value = gitRepos.value.filter((r) => !samePath(r.path, selectedRepoPath.value));
  applyingRepo.value = true;
  selectedRepoPath.value = registeredRepos.value[0]?.localPath ?? gitRepos.value[0]?.path ?? "";
  selectedRepoId.value = registeredRepos.value[0]?.id ?? "";
  pickDefaultRemote();
  const nextBrowse = selectedRepoPath.value || props.workingDir?.trim() || "";
  if (nextBrowse) await enterDir(nextBrowse);
  else {
    await nextTick();
    applyingRepo.value = false;
  }
}

function fillAccountFormFromSaved() {
  const a = accounts.value.find((x) => x.provider === tokenProvider.value);
  tokenUsername.value = a?.username ?? "";
  tokenBaseUrl.value = a?.baseUrl ?? "";
  tokenSecret.value = "";
}

function openAccountDialog() {
  fillAccountFormFromSaved();
  tokenOpen.value = true;
}

async function saveToken() {
  if (tokenProvider.value === "gitee" && !tokenUsername.value.trim()) {
    void fouAlert("Gitee 请填写登录用户名，再填私人令牌。二者合起来就是托管账户凭证。", "提示");
    return;
  }
  if (tokenProvider.value === "custom") {
    if (!tokenBaseUrl.value.trim()) {
      void fouAlert("自建 Git 请填写服务器地址（例如 https://git.example.com）。", "提示");
      return;
    }
    if (!tokenUsername.value.trim()) {
      void fouAlert("自建 Git 请填写用户名。", "提示");
      return;
    }
  }
  if (!tokenSecret.value.trim() && !hasProviderToken.value) {
    void fouAlert("请填写私人令牌（在网站生成的 PAT，不是登录密码）。", "提示");
    return;
  }
  try {
    await invoke("git_account_upsert", {
      xuUser: xuUser(),
      provider: tokenProvider.value,
      username: tokenUsername.value,
      token: tokenSecret.value,
      baseUrl: tokenProvider.value === "custom" ? tokenBaseUrl.value.trim() : "",
    });
    tokenSecret.value = "";
    tokenOpen.value = false;
    await loadAccounts();
    fouMsg.success("托管账户凭证已保存到本机");
    void refreshCloudRepos({ quiet: false });
  } catch (e) {
    void onApiCatch(e);
  }
}

async function refreshCloudRepos(opts?: { quiet?: boolean }) {
  const quiet = opts?.quiet !== false;
  cloudBusy.value = true;
  try {
    if (!hasProviderToken.value) {
      cloudRepos.value = [];
      syncSelectedCloudFromLocal();
      if (!quiet && !localCloudSeed.value.length) {
        void fouAlert("尚未保存该平台的令牌。可先点「令牌」保存，或使用本机已登记的远程。", "Git");
      }
      return;
    }
    cloudRepos.value = await invoke<GitCloudRepo[]>("git_cloud_repos", {
      xuUser: xuUser(),
      provider: tokenProvider.value,
    });
    syncSelectedCloudFromLocal();
    if (!quiet && !cloudSelectOptions.value.length) {
      void fouAlert("该账号下没有仓库", "提示");
    }
  } catch (e) {
    cloudRepos.value = [];
    syncSelectedCloudFromLocal();
    if (!quiet) void fouAlert(`${toUserError(e)}`, "Git");
  } finally {
    cloudBusy.value = false;
  }
}

function syncSelectedCloudFromLocal() {
  const options = cloudSelectOptions.value;
  if (!options.length) {
    selectedCloudUrl.value = "";
    return;
  }
  if (selectedCloudUrl.value && options.some((o) => o.value === selectedCloudUrl.value)) return;
  const remotes = currentRegistered.value?.remotes?.length
    ? currentRegistered.value.remotes
    : currentRepo.value?.remotes ?? [];
  const match = remotes.find((r) => options.some((o) => o.value === r.url));
  selectedCloudUrl.value = match?.url || options[0]?.value || "";
}

async function maybePromptImport() {
  try {
    const done = await invoke<boolean>("git_import_prompt_done", { xuUser: xuUser() });
    importPromptDone.value = done;
    if (done) return;
    if (!gitRepos.value.length) return;
    importCandidates.value = [...gitRepos.value];
    importOpen.value = true;
  } catch {
    /* ignore prompt errors */
  }
}

async function rescanLocalRepos() {
  try {
    await invoke("git_import_prompt_clear", { xuUser: xuUser() });
    importPromptDone.value = false;
    await discoverRepos();
    fouMsg.success("已重新扫描本机仓库");
  } catch (e) {
    void fouAlert(`${toUserError(e)}`, "Git");
  }
}

async function selectRegisteredRepo(path: string) {
  applyingRepo.value = true;
  selectedRepoPath.value = path;
  selectedRepoId.value =
    registeredRepos.value.find((r) => samePath(r.localPath, path))?.id ?? "";
  pickDefaultRemote();
  await enterDir(path);
}

async function confirmImportRepos() {
  importBusy.value = true;
  try {
    for (const repo of importCandidates.value) {
      await invoke("git_registry_upsert", {
        xuUser: xuUser(),
        localPath: repo.path,
        displayName: repo.name,
        defaultBranch: repo.branch || null,
        remotes: repo.remotes.map((r) => ({
          name: r.name,
          url: r.url,
          provider: providerFromUrl(r.url) || null,
        })),
      });
    }
    await invoke("git_import_prompt_mark", { xuUser: xuUser() });
    importOpen.value = false;
    await loadRegistry();
    await discoverRepos();
    fouMsg.success(`已登记 ${importCandidates.value.length} 个仓库`);
  } catch (e) {
    void fouAlert(`${toUserError(e)}`, "Git");
  } finally {
    importBusy.value = false;
  }
}

async function skipImportRepos() {
  try {
    await invoke("git_import_prompt_mark", { xuUser: xuUser() });
  } catch {
    /* ignore */
  }
  importOpen.value = false;
}

async function bindCloudUrl(urlRaw: string, cloudFullName?: string | null) {
  const url = urlRaw.trim();
  const repoId = currentRegistered.value?.id || selectedRepoId.value;
  if (!url || !repoId) {
    void fouAlert("请先登记本地仓库，再选择或粘贴远程地址绑定", "提示");
    return;
  }
  const fromUrl = providerFromUrl(url);
  if (fromUrl && fromUrl !== tokenProvider.value) {
    void fouAlert(
      `当前选择的是 ${tokenProvider.value === "github" ? "GitHub" : "Gitee"}，但地址属于 ${fromUrl === "github" ? "GitHub" : "Gitee"}。请切换平台后再绑定。`,
      "提示",
    );
    return;
  }
  if (!fromUrl) {
    void fouAlert("请填写有效的 Git 远程地址（HTTPS 或 SSH）", "提示");
    return;
  }
  bindBusy.value = true;
  try {
    const row = await invoke<GitRepoRow>("git_registry_bind_cloud", {
      xuUser: xuUser(),
      repoId,
      remoteName: "origin",
      url,
      provider: tokenProvider.value,
      cloudFullName: cloudFullName ?? cloudLabelFromUrl(url) ?? null,
    });
    pasteRemoteUrl.value = "";
    await loadRegistry();
    await discoverRepos();
    selectedRemoteName.value = "origin";
    fouMsg.success(`已绑定 ${row.cloudFullName || "远程"}（已同步本机 Git）`);
  } catch (e) {
    void fouAlert(`${toUserError(e)}`, "Git");
  } finally {
    bindBusy.value = false;
  }
}

async function bindSelectedCloud() {
  const url = selectedCloudUrl.value.trim() || pasteRemoteUrl.value.trim();
  const cloud = cloudRepos.value.find((c) => c.cloneUrl === url);
  await bindCloudUrl(url, cloud?.fullName ?? null);
}

async function bindPastedRemote() {
  await bindCloudUrl(pasteRemoteUrl.value.trim(), null);
}

async function discoverRepos() {
  const root = props.workingDir?.trim();
  discovering.value = true;
  try {
    await loadRegistry().catch(() => {
      registeredRepos.value = [];
    });
    await loadAccounts().catch(() => {
      accounts.value = [];
    });
    if (!root) {
      gitRepos.value = [];
      if (!registeredRepos.value.length) {
        selectedRepoPath.value = "";
        selectedRemoteName.value = "";
      }
      return;
    }
    const list = await invoke<GitRepoInfo[]>("git_discover_repos", { root }).catch(() => [] as GitRepoInfo[]);
    gitRepos.value = list;
    for (const r of registeredRepos.value) {
      if (!gitRepos.value.some((g) => samePath(g.path, r.localPath))) {
        gitRepos.value.push({
          path: r.localPath,
          name: r.displayName,
          branch: r.lastBranch,
          remotes: r.remotes.map((x) => ({ name: x.name, url: x.url })),
        });
      }
    }
    const prev = selectedRepoPath.value;
    const keepReg = registeredRepos.value.find((r) => samePath(r.localPath, prev));
    const keepGit = gitRepos.value.find((r) => samePath(r.path, prev));
    const prefer = gitRepos.value.find((r) => samePath(r.path, root));
    if (!keepReg && !keepGit) {
      selectedRepoPath.value =
        registeredRepos.value[0]?.localPath || prefer?.path || gitRepos.value[0]?.path || "";
    }
    selectedRepoId.value =
      registeredRepos.value.find((r) => samePath(r.localPath, selectedRepoPath.value))?.id ?? "";
    pickDefaultRemote();
    void refreshCloudRepos({ quiet: true });
    void maybePromptImport();
  } catch (e) {
    gitRepos.value = [];
    void fouAlert(`${toUserError(e)}。可在内嵌终端配置 Git 后重试。`, "Git");
  } finally {
    discovering.value = false;
  }
}

async function refresh() {
  const ws = repoWorkspace();
  if (!ws) {
    statusLines.value = [];
    branchLine.value = "";
    branchOptions.value = [];
    return;
  }
  loading.value = true;
  try {
    const [statusRaw, branchesRaw] = await Promise.all([
      invoke<string>("git_workspace", { workspace: ws, action: "status" }),
      invoke<string>("git_workspace", { workspace: ws, action: "branches" }).catch(() => ""),
    ]);
    parseStatus(statusRaw);
    branchOptions.value = parseBranches(branchesRaw);
    const cur = currentBranchName();
    selectedBranch.value = cur || defaultBranch.value || branchOptions.value[0] || "";
  } catch (e) {
    statusLines.value = [];
    branchLine.value = toUserError(e);
  } finally {
    loading.value = false;
  }
}

function statusLabel(line: string): string {
  const code = line.slice(0, 2);
  const rel = relPathFromStatus(line);
  if (code === "??") return `未跟踪 · ${rel}`;
  if (code.includes("M")) return `已修改 · ${rel}`;
  if (code.includes("A")) return `已暂存 · ${rel}`;
  if (code.includes("D")) return `已删除 · ${rel}`;
  return `${code} · ${rel}`;
}

async function gitAction(action: "fetch" | "pull" | "sync" | "push" | "merge") {
  const busy =
    action === "fetch"
      ? fetching
      : action === "pull"
        ? pulling
        : action === "sync"
          ? syncing
          : action === "merge"
            ? merging
            : pushing;
  const ws = repoWorkspace();
  if (!ws) return;
  if (action === "push") {
    const repoId = currentRegistered.value?.id || selectedRepoId.value;
    if (!repoId) {
      void fouAlert("请先点「添加」把本地仓登记到本机，再绑定远程后上传。", "提示");
      return;
    }
    if (!selectedRemoteName.value.trim()) {
      void fouAlert("请先绑定远程（刷新云端仓并点绑定）。", "提示");
      return;
    }
    if (mainBlocked.value) {
      void fouAlert(mainBlocked.value, "提示");
      return;
    }
    const branch = currentBranchName() || selectedBranch.value || defaultBranch.value;
    if (!branch) {
      void fouAlert("请选择要上传的分支", "提示");
      return;
    }
    busy.value = true;
    try {
      const out = await invoke<string>("git_registry_push", {
        xuUser: xuUser(),
        repoId,
        remoteName: selectedRemoteName.value.trim(),
        branch,
      });
      fouMsg.success(out.trim() ? out.trim().slice(0, 120) : "已上传到所选仓库");
      await loadRegistry();
      await refresh();
    } catch (e) {
      void fouAlert(`${toUserError(e)}。请检查令牌权限后重试。`, "Git");
    } finally {
      busy.value = false;
    }
    return;
  }
  if (action === "pull" || action === "sync" || action === "merge") {
    await refreshReviewGate();
    const reason = mergeBlockReason(reviewGate.value, lintErrorCount.value);
    if (reason) {
      void fouAlert(reason, "提示");
      return;
    }
  }
  const remote = selectedRemoteName.value.trim() || null;
  const branch =
    action === "merge"
      ? selectedBranch.value || defaultBranch.value || null
      : currentBranchName() || selectedBranch.value || defaultBranch.value || null;
  if (action === "merge") {
    const cur = currentBranchName();
    if (!branch) {
      void fouAlert("请选择要合并的分支", "提示");
      return;
    }
    if (cur && branch === cur) {
      void fouAlert("请选择其他分支再合并到当前分支", "提示");
      return;
    }
  }
  busy.value = true;
  try {
    const out = await invoke<string>("git_workspace", {
      workspace: ws,
      action,
      remote,
      branch,
    });
    const labels: Record<string, string> = {
      fetch: "已获取远程更新",
      pull: "已拉取并合并",
      sync: "已同步（获取→拉取→推送）",
      merge: "已合并",
      push: "已上传到所选仓库的远程",
    };
    fouMsg.success(out.trim() ? `${labels[action]}：${out.trim().slice(0, 120)}` : labels[action]);
    await refresh();
  } catch (e) {
    void fouAlert(`${toUserError(e)}。可在内嵌终端配置 Git 凭据后重试。`, "Git");
  } finally {
    busy.value = false;
  }
}

async function stageAll() {
  const ws = repoWorkspace();
  if (!ws) return;
  try {
    if (uploadScopeRel.value) {
      await invoke("git_workspace", {
        workspace: ws,
        action: "add",
        path: joinRepoPath(uploadScopeRel.value),
      });
      fouMsg.success("已暂存所选范围");
    } else {
      await invoke("git_workspace", { workspace: ws, action: "add_all" });
      fouMsg.success("已暂存全部变更");
    }
    await refresh();
  } catch (e) {
    void onApiCatch(e);
  }
}

async function stageFile(line: string) {
  const ws = repoWorkspace();
  if (!ws) return;
  const path = absPathFromStatus(line);
  try {
    await invoke("git_workspace", { workspace: ws, action: "add", path });
    fouMsg.success(`已暂存 ${relPathFromStatus(line)}`);
    await refresh();
  } catch (e) {
    void onApiCatch(e);
  }
}

async function showDiff(line: string) {
  const ws = repoWorkspace();
  if (!ws) return;
  const path = absPathFromStatus(line);
  const rel = relPathFromStatus(line);
  diffTitle.value = rel;
  diffOpen.value = true;
  diffLoading.value = true;
  diffText.value = "";
  try {
    diffText.value = await invoke<string>("git_workspace", {
      workspace: ws,
      action: "diff",
      path,
    });
  } catch (e) {
    diffText.value = toUserError(e);
  } finally {
    diffLoading.value = false;
  }
}

async function commit() {
  const ws = repoWorkspace();
  const msg = commitMsg.value.trim();
  if (!ws || !msg) {
    void fouAlert("请填写提交说明", "提示");
    return;
  }
  if (mainBlocked.value) {
    void fouAlert(mainBlocked.value, "提示");
    return;
  }
  try {
    await invoke("git_workspace", { workspace: ws, action: "commit", message: msg });
    fouMsg.success("已提交");
    commitMsg.value = "";
    await refresh();
  } catch (e) {
    void onApiCatch(e);
  }
}

async function checkoutBranch() {
  const ws = repoWorkspace();
  const branch = selectedBranch.value.trim();
  if (!ws || !branch) return;
  try {
    await invoke("git_workspace", { workspace: ws, action: "checkout", branch });
    fouMsg.success(`已切换到分支 ${branch}`);
    await refresh();
  } catch (e) {
    void onApiCatch(e);
  }
}

async function onRefreshAll() {
  await discoverRepos();
  await loadBrowseEntries();
  await refresh();
}

onMounted(async () => {
  await discoverRepos();
  const start = props.workingDir?.trim() || selectedRepoPath.value;
  if (start) await enterDir(start);
  else await refresh();
  void refreshReviewGate();
});
watch(
  () => props.workingDir,
  async () => {
    await discoverRepos();
    const start = props.workingDir?.trim() || selectedRepoPath.value;
    if (start) await enterDir(start);
    void refreshReviewGate();
  },
);
watch(selectedRepoPath, async (next, prev) => {
  if (applyingRepo.value) return;
  if (!next || (prev && samePath(next, prev))) return;
  pickDefaultRemote();
  selectedRepoId.value =
    registeredRepos.value.find((r) => samePath(r.localPath, next))?.id ?? "";
  void refreshCloudRepos({ quiet: true });
  await enterDir(next);
});
watch(tokenProvider, () => {
  if (tokenOpen.value) fillAccountFormFromSaved();
  alignUploadRemoteToProvider({ notify: true });
  void refreshCloudRepos({ quiet: true });
});
</script>

<template>
  <div class="ide-git-panel ui-font">
    <header class="panel-head">
      <span class="panel-title">源代码管理</span>
      <div class="head-actions">
        <FouButton
          icon="download-cloud-line"
          size="small"
          text
          native-type="button"
          :loading="fetching"
          aria-label="获取"
          title="获取远程"
          @click="gitAction('fetch')"
        />
        <FouButton
          icon="download-line"
          size="small"
          text
          native-type="button"
          :loading="pulling"
          :disabled="!!mergeBlocked"
          aria-label="拉取"
          title="拉取并合并"
          @click="gitAction('pull')"
        />
        <FouButton
          icon="git-merge-line"
          size="small"
          text
          native-type="button"
          :loading="merging"
          :disabled="!!mergeBlocked"
          aria-label="合并"
          title="合并所选分支（评审未通过则禁止）"
          @click="gitAction('merge')"
        />
        <FouButton
          icon="refresh-line"
          size="small"
          text
          native-type="button"
          :loading="syncing"
          :disabled="!!mergeBlocked"
          aria-label="同步"
          title="获取→拉取→推送"
          @click="gitAction('sync')"
        />
        <FouButton
          icon="upload-cloud-line"
          size="small"
          text
          native-type="button"
          :loading="pushing"
          :disabled="!!mainBlocked || !selectedRemoteName"
          aria-label="推送"
          title="上传到登记远程"
          @click="gitAction('push')"
        />
        <FouButton
          icon="refresh-line"
          size="small"
          text
          native-type="button"
          :loading="loading || discovering"
          aria-label="刷新"
          @click="onRefreshAll"
        />
      </div>
    </header>
    <div class="repo-picker">
      <label class="picker-label">当前仓库</label>
      <FouSelect
        v-model="selectedRepoPath"
        class="branch-select"
        placeholder="选择仓库"
        :options="repoSelectOptions"
        :disabled="!repoSelectOptions.length"
      />
      <FouButton
        icon="git-repository-line"
        size="small"
        native-type="button"
        aria-label="添加仓库"
        @click="addRepo"
      >
        添加
      </FouButton>
      <FouButton
        icon="key-2-line"
        size="small"
        native-type="button"
        aria-label="托管账户凭证"
        title="保存托管账户凭证"
        @click="openAccountDialog"
      >
        账户
      </FouButton>
      <FouButton
        icon="search-eye-line"
        size="small"
        native-type="button"
        aria-label="重新扫描本机仓库"
        title="重新扫描并询问是否登记到本机"
        @click="rescanLocalRepos"
      >
        扫描
      </FouButton>
      <FouButton
        v-if="isSelectedRegistered"
        icon="delete-bin-line"
        size="small"
        native-type="button"
        aria-label="移出仓库"
        @click="removeRegisteredRepo"
      >
        移出
      </FouButton>
    </div>
    <ul v-if="registeredListRows.length" class="registered-list">
      <li v-for="row in registeredListRows" :key="row.id">
        <FouButton
          icon="git-repository-line"
          size="small"
          text
          native-type="button"
          class="registered-item"
          :class="{ active: row.active }"
          @click="selectRegisteredRepo(row.path)"
        >
          <span class="registered-name">{{ row.name }}</span>
          <span class="muted registered-remote">{{ row.remoteShort }}</span>
        </FouButton>
      </li>
    </ul>
    <div class="browse-bar">
      <FouButton
        icon="arrow-up-line"
        size="small"
        native-type="button"
        :disabled="!canGoUp"
        aria-label="上一级"
        @click="goUp"
      >
        上一级
      </FouButton>
      <FouButton
        icon="folder-line"
        size="small"
        native-type="button"
        aria-label="跳转文件夹"
        @click="pickFolderJump"
      >
        文件夹
      </FouButton>
      <FouButton
        icon="file-line"
        size="small"
        native-type="button"
        aria-label="跳转文件"
        @click="pickFileJump"
      >
        文件
      </FouButton>
    </div>
    <div class="crumbs">
      <FouButton
        v-for="c in breadcrumbs"
        :key="c.path"
        icon="folder-line"
        size="small"
        text
        native-type="button"
        class="crumb-btn"
        @click="goBreadcrumb(c.path)"
      >
        {{ c.label }}
      </FouButton>
    </div>
    <p class="git-config muted">范围：{{ scopeHint }}</p>
    <ul v-if="browseFolders.length || browseFiles.length" class="browse-list">
      <li v-for="d in browseFolders" :key="d.path">
        <FouButton
          icon="folder-line"
          size="small"
          text
          native-type="button"
          class="browse-item"
          @click="enterDir(d.path)"
        >
          {{ d.name }}
        </FouButton>
      </li>
      <li v-for="f in browseFiles" :key="f.path">
        <FouButton
          icon="file-line"
          size="small"
          text
          native-type="button"
          class="browse-item"
          @click="selectFile(f.path)"
        >
          {{ f.name }}
        </FouButton>
      </li>
    </ul>
    <p v-else-if="!browseLoading" class="panel-empty muted">此层没有可显示的文件夹或文件</p>
    <div class="repo-picker">
      <label class="picker-label">云端仓</label>
      <FouSelect
        v-model="tokenProvider"
        class="provider-select"
        :options="[
          { value: 'gitee', label: 'Gitee' },
          { value: 'github', label: 'GitHub' },
          { value: 'custom', label: '自建 Git' },
        ]"
      />
      <FouSelect
        v-model="selectedCloudUrl"
        class="branch-select"
        placeholder="名下仓库"
        :options="cloudSelectOptions"
        :disabled="!cloudSelectOptions.length || tokenProvider === 'custom'"
      />
      <FouButton
        icon="refresh-line"
        size="small"
        native-type="button"
        :loading="cloudBusy"
        aria-label="刷新云端仓"
        @click="refreshCloudRepos({ quiet: false })"
      >
        刷新
      </FouButton>
      <FouButton
        icon="links-line"
        size="small"
        native-type="button"
        :loading="bindBusy"
        aria-label="绑定远程"
        @click="bindSelectedCloud"
      >
        绑定
      </FouButton>
    </div>
    <p v-if="cloudEmptyHint" class="panel-empty muted cloud-empty-hint">{{ cloudEmptyHint }}</p>
    <div class="repo-picker paste-remote-row">
      <label class="picker-label">粘贴地址</label>
      <FouInput
        v-model="pasteRemoteUrl"
        class="branch-select"
        placeholder="https://gitee.com/… 或 https://github.com/…"
      />
      <FouButton
        icon="links-line"
        size="small"
        native-type="button"
        :loading="bindBusy"
        aria-label="用粘贴地址绑定"
        @click="bindPastedRemote"
      >
        绑定地址
      </FouButton>
    </div>
    <div class="repo-picker">
      <label class="picker-label">上传到</label>
      <FouSelect
        v-model="selectedRemoteName"
        class="branch-select"
        placeholder="选择远程"
        :options="remoteSelectOptions"
        :disabled="!remoteSelectOptions.length"
      />
      <FouButton
        icon="upload-cloud-line"
        size="small"
        native-type="button"
        :loading="pushing"
        :disabled="!!mainBlocked || !selectedRepoPath || !selectedRemoteName"
        @click="gitAction('push')"
      >
        上传
      </FouButton>
    </div>
    <p v-if="!discovering && !gitRepos.length" class="panel-empty muted">此文件夹下没有 Git 仓库，可点「添加」选择含 Git 的目录</p>
    <p v-if="mergeBlocked" class="merge-block">{{ mergeBlocked }}</p>
    <p v-else-if="mainBlocked" class="merge-block">{{ mainBlocked }}</p>
    <p v-if="branchLine" class="branch-line">{{ branchLine.replace(/^##\s*/, "") }}</p>
    <div v-if="branchOptions.length" class="branch-picker">
      <FouSelect
        v-model="selectedBranch"
        class="branch-select"
        placeholder="选择分支"
        :options="branchSelectOptions"
      />
      <FouButton
        icon="git-branch-line"
        size="small"
        native-type="button"
        @click="checkoutBranch"
      >
        切换
      </FouButton>
    </div>
    <ul v-if="visibleStatusLines.length" class="change-list">
      <li v-for="(line, i) in visibleStatusLines" :key="i" class="change-row">
        <span class="change-label">{{ statusLabel(line) }}</span>
        <span class="change-actions">
          <FouButton
            icon="add-line"
            size="small"
            text
            native-type="button"
            aria-label="暂存"
            @click="stageFile(line)"
          />
          <FouButton
            icon="file-diff-line"
            size="small"
            text
            native-type="button"
            aria-label="查看差异"
            @click="showDiff(line)"
          />
        </span>
      </li>
    </ul>
    <p v-else-if="!loading && !discovering && gitRepos.length" class="panel-empty muted">
      {{ uploadScopeRel && statusLines.length ? "所选范围内没有未提交的变更" : "所选仓库没有未提交的变更" }}
    </p>
    <div class="commit-box">
      <FouInput v-model="commitMsg" placeholder="提交说明" />
      <div class="commit-actions">
        <FouButton icon="git-commit-line" size="small" native-type="button" :disabled="!!mainBlocked" @click="commit">
          提交
        </FouButton>
        <FouButton icon="add-line" size="small" native-type="button" @click="stageAll">
          {{ uploadScopeRel ? "暂存范围" : "全部暂存" }}
        </FouButton>
      </div>
    </div>

    <FouDialog v-model="tokenOpen" title="托管账户凭证" width="480px" append-to-body>
      <p class="token-dialog-hint muted">
        {{ accountHint }}。这里保存的是平台<strong>账户</strong>（不是仓库地址）；仓库请在面板里用「名下仓库」或「粘贴地址」绑定。凭证加密存本机。
      </p>
      <div class="token-dialog-form">
        <div class="token-field">
          <span class="token-field-label">平台</span>
          <FouSelect
            v-model="tokenProvider"
            class="token-field-control"
            :options="[
              { value: 'gitee', label: 'Gitee' },
              { value: 'github', label: 'GitHub' },
              { value: 'custom', label: '自建 Git' },
            ]"
          />
        </div>
        <div v-if="tokenProvider === 'custom'" class="token-field">
          <span class="token-field-label">服务器</span>
          <FouInput
            v-model="tokenBaseUrl"
            class="token-field-control"
            placeholder="https://git.example.com"
          />
        </div>
        <div class="token-field">
          <span class="token-field-label">用户名</span>
          <FouInput
            v-model="tokenUsername"
            class="token-field-control"
            :placeholder="tokenUsernamePlaceholder"
          />
        </div>
        <div class="token-field">
          <span class="token-field-label">私人令牌</span>
          <FouInput
            v-model="tokenSecret"
            class="token-field-control"
            type="password"
            :placeholder="
              hasProviderToken
                ? '留空表示不改动已保存令牌'
                : '在网站生成的 PAT，不是登录密码'
            "
          />
        </div>
      </div>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="tokenOpen = false">取消</FouButton>
        <FouButton icon="save-line" native-type="button" @click="saveToken">保存</FouButton>
      </template>
    </FouDialog>
    <FouDialog
      v-model="importOpen"
      title="发现本机 Git 仓库"
      width="520px"
      append-to-body
      :close-on-click-modal="false"
    >
      <p class="muted">
        工作区下发现 {{ importCandidates.length }} 个已配置的 Git 仓库。是否写入本机数据库，方便以后管理远程与上传？令牌将加密存储。
      </p>
      <ul class="import-list">
        <li v-for="r in importCandidates" :key="r.path">
          <strong>{{ r.name }}</strong>
          <span class="muted">{{ r.path }}</span>
          <span v-if="r.remotes.length" class="muted">
            · {{ r.remotes.map((x) => shortRemoteUrl(x.url)).join("、") }}
          </span>
        </li>
      </ul>
      <template #footer>
        <FouButton icon="close-line" native-type="button" :disabled="importBusy" @click="skipImportRepos">
          暂不
        </FouButton>
        <FouButton
          icon="save-line"
          type="primary"
          native-type="button"
          :loading="importBusy"
          @click="confirmImportRepos"
        >
          保存到数据库
        </FouButton>
      </template>
    </FouDialog>
    <FouDialog v-model="diffOpen" :title="`差异 · ${diffTitle}`" width="720px" append-to-body>
      <pre class="diff-pre">{{ diffLoading ? "加载中…" : diffText || "（无差异）" }}</pre>
      <template #footer>
        <FouButton icon="close-line" native-type="button" @click="diffOpen = false">关闭</FouButton>
      </template>
    </FouDialog>
  </div>
</template>

<style scoped>
.ide-git-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
  border-bottom: 1px solid var(--hairline);
  gap: 8px;
}
.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  justify-content: flex-end;
}
.panel-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  flex-shrink: 0;
}
.merge-block {
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--danger, #f87171);
  border-bottom: 1px solid var(--hairline);
}
.branch-line {
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  font-family: var(--font-mono);
  border-bottom: 1px solid var(--hairline);
}
.repo-picker,
.branch-picker,
.browse-bar {
  padding: 6px 12px;
  border-bottom: 1px solid var(--hairline);
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.cloud-empty-hint {
  padding: 4px 12px 8px;
  margin: 0;
  border-bottom: 1px solid var(--hairline);
}
.paste-remote-row .branch-select {
  flex: 1;
  min-width: 140px;
}
.picker-label {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted);
}
.provider-select {
  width: 110px;
  flex-shrink: 0;
}
.crumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--hairline);
  font-size: 11px;
}
.crumb-btn {
  flex-shrink: 0;
}
.browse-list {
  list-style: none;
  margin: 0;
  padding: 4px 8px;
  max-height: 160px;
  overflow: auto;
  border-bottom: 1px solid var(--hairline);
}
.browse-item {
  width: 100%;
  justify-content: flex-start;
}
.registered-list {
  list-style: none;
  margin: 0;
  padding: 4px 8px;
  max-height: 120px;
  overflow: auto;
  border-bottom: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.registered-item {
  width: 100%;
  justify-content: flex-start;
  gap: 8px;
}
.registered-item.active {
  font-weight: 600;
}
.registered-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.registered-remote {
  font-size: 11px;
  margin-left: auto;
  flex-shrink: 0;
}
.git-config {
  margin: 0;
  padding: 4px 12px;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.change-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
}
.change-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--hairline);
}
.change-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.change-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.commit-box {
  padding: 10px 12px;
  border-top: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.commit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.panel-empty {
  padding: 16px 12px;
  font-size: 12px;
}
.import-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  max-height: 240px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.token-dialog-hint {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.5;
}
.token-dialog-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.token-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin: 0;
}
.token-field-control {
  flex: 1;
  min-width: 0;
}
.token-field-label {
  flex-shrink: 0;
  width: 7.5em;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, inherit);
  text-align: right;
}
.import-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: 6px;
  font-size: 12px;
}
.import-list strong {
  color: var(--ink);
}
.muted {
  color: var(--muted);
}
.diff-pre {
  margin: 0;
  max-height: 420px;
  overflow: auto;
  font-size: 11px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
