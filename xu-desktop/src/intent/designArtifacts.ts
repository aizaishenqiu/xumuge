/**
 * Software design-before-code artifacts under {generatePath}/.xu/design/
 */
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import type {
  BriefPage,
  DesignMode,
  RequirementBrief,
} from "../intent/briefTypes";
import { loadBrief, saveBrief } from "../intent/briefStore";
import type { XuProject } from "../utils/projects";
import {
  copyUnderWorkspace,
  importFileIntoWorkspace,
  listDir,
  mkdirRecursive,
  writeTextUnderWorkspace,
} from "../utils/fsBridge";
import { buildAgentCapabilityHints } from "../capabilities/hints";
import { toUserError } from "../utils/userFacingError";

export const DESIGN_DIR = ".xu/design";
export const DESIGN_PAGES_JSON = `${DESIGN_DIR}/pages.json`;
export const DESIGN_MODE_JSON = `${DESIGN_DIR}/mode.json`;
export const DESIGN_APPROVED_MD = `${DESIGN_DIR}/APPROVED.md`;
export const DESIGN_REVISIONS_MD = `${DESIGN_DIR}/REVISIONS.md`;
export const DESIGN_FREEZE_JSON = `${DESIGN_DIR}/FREEZE.json`;
export const DESIGN_WIREFRAMES = `${DESIGN_DIR}/wireframes`;
export const DESIGN_APPROVED = `${DESIGN_DIR}/approved`;
export const DESIGN_UPLOADS = `${DESIGN_DIR}/uploads`;
export const DESIGN_PREVIEW = `${DESIGN_DIR}/preview`;
export const DESIGN_GALLERY_INDEX = `${DESIGN_PREVIEW}/index.html`;

export const XU_DESIGN_CONFIRM_NEEDED = "xu-design-confirm-needed";
export const XU_DESIGN_CONFIRMED = "xu-design-confirmed";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const TEXT_DESIGN_EXT = /\.(svg|html?)$/i;

function joinRoot(root: string, sub: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const s = sub.replace(/^[/\\]+/, "");
  return `${r}/${s}`.replace(/\\/g, "/");
}

export function designAbs(project: XuProject, rel: string): string {
  return joinRoot(project.generatePath || "", rel);
}

function slugPageId(name: string, idx: number): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return base || `page-${idx + 1}`;
}

/** Infer a starter page list from Brief when pages[] is empty. */
export function inferPagesFromBrief(brief: RequirementBrief): BriefPage[] {
  if (brief.pages?.length) return brief.pages;
  const names: string[] = [];
  for (const s of brief.scopeIn || []) {
    const m = s.match(/(?:页面|页|界面|屏)[：:]\s*(.+)/) || s.match(/^(.+?)(?:页|页面)$/);
    if (m?.[1]) names.push(m[1].trim());
    else if (/页|登录|首页|设置|详情|列表|仪表|看板/.test(s) && s.length < 40) {
      names.push(s.replace(/[：:].*$/, "").trim());
    }
  }
  if (!names.length) {
    names.push("首页", "登录页", "主功能页", "设置页");
  }
  const uniq = [...new Set(names)].slice(0, 12);
  return uniq.map((name, i) => ({
    id: slugPageId(name, i),
    name,
    route: `/${slugPageId(name, i)}`,
    purpose: `与「${brief.goal || "本产品"}」相关的 ${name}`,
    status: "draft" as const,
  }));
}

export async function syncPagesJson(project: XuProject, pages: BriefPage[]): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return;
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_DIR));
  await writeTextUnderWorkspace(
    gen,
    joinRoot(gen, DESIGN_PAGES_JSON),
    JSON.stringify({ pages }, null, 2),
  );
}

export async function readDesignMode(project: XuProject): Promise<DesignMode | null> {
  const abs = designAbs(project, DESIGN_MODE_JSON);
  try {
    if (!(await exists(abs))) return null;
    const raw = JSON.parse(await readTextFile(abs)) as { mode?: string; sourceDir?: string };
    if (raw.mode === "upload" || raw.mode === "html" || raw.mode === "canvas") return raw.mode;
  } catch {
    /* ignore */
  }
  return null;
}

export async function writeDesignMode(
  project: XuProject,
  mode: DesignMode,
  sourceDir?: string,
): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) throw new Error("项目未设置生成路径");
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_DIR));
  const payload: { mode: DesignMode; sourceDir?: string; updatedAt: string } = {
    mode,
    updatedAt: new Date().toISOString(),
  };
  if (sourceDir?.trim()) payload.sourceDir = sourceDir.trim();
  await writeTextUnderWorkspace(
    gen,
    joinRoot(gen, DESIGN_MODE_JSON),
    JSON.stringify(payload, null, 2),
  );
  const brief = await loadBrief(project.id);
  await saveBrief({ ...brief, designMode: mode });
}

export async function isDesignFrozen(project: XuProject): Promise<boolean> {
  const brief = await loadBrief(project.id);
  if (brief.designFrozen) return true;
  const abs = designAbs(project, DESIGN_FREEZE_JSON);
  try {
    if (!(await exists(abs))) return false;
    const raw = JSON.parse(await readTextFile(abs)) as { frozen?: boolean };
    return Boolean(raw.frozen);
  } catch {
    return false;
  }
}

export async function freezeDesign(project: XuProject): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return;
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_DIR));
  await writeTextUnderWorkspace(
    gen,
    joinRoot(gen, DESIGN_FREEZE_JSON),
    JSON.stringify(
      { frozen: true, frozenAt: new Date().toISOString(), briefVersion: (await loadBrief(project.id)).version },
      null,
      2,
    ),
  );
  const brief = await loadBrief(project.id);
  await saveBrief({ ...brief, designFrozen: true });
}

/** Clear freeze, bump Brief, reset page confirm status — require re-confirm before code. */
export async function unfreezeDesignForChange(
  project: XuProject,
  reason = "需求/设计变更",
): Promise<RequirementBrief> {
  const gen = (project.generatePath || "").trim();
  if (!gen) throw new Error("项目未设置生成路径");
  let brief = await loadBrief(project.id);
  const pages = (brief.pages || []).map((p) => ({
    ...p,
    status: (p.status === "confirmed" ? "designed" : p.status) as BriefPage["status"],
  }));
  await writeTextUnderWorkspace(
    gen,
    joinRoot(gen, DESIGN_FREEZE_JSON),
    JSON.stringify({ frozen: false, clearedAt: new Date().toISOString(), reason }, null, 2),
  );
  try {
    await invoke("remove_path", {
      workspace: gen,
      path: joinRoot(gen, DESIGN_APPROVED_MD),
    });
  } catch {
    /* optional */
  }
  brief = await saveBrief(
    {
      ...brief,
      pages,
      designFrozen: false,
      decisions: [
        ...(brief.decisions || []).filter((d) => !d.startsWith("设计定稿：") && !d.startsWith("设计冻结：")),
        `设计解冻：${reason}`,
      ],
    },
    { bumpVersion: true },
  );
  await syncPagesJson(project, pages);
  return brief;
}

/** Ensure Brief.pages + dirs + mode-aware placeholders. */
export async function ensureDesignScaffold(
  project: XuProject,
  brief: RequirementBrief,
): Promise<RequirementBrief> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return brief;
  let pages = brief.pages?.length ? brief.pages : inferPagesFromBrief(brief);
  let next = brief;
  if (!brief.pages?.length) {
    next = await saveBrief({ ...brief, pages });
  }
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_DIR));
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_WIREFRAMES));
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_APPROVED));
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_UPLOADS));
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_PREVIEW));
  await syncPagesJson(project, pages);

  const mode = brief.designMode || (await readDesignMode(project)) || "html";

  for (const p of pages) {
    const dir = `${DESIGN_WIREFRAMES}/${p.id}`;
    await mkdirRecursive(gen, joinRoot(gen, dir));
    if (mode === "html") {
      const previewRel = `${DESIGN_PREVIEW}/${p.id}.html`;
      const abs = designAbs(project, previewRel);
      try {
        if (!(await exists(abs))) {
          await writeTextUnderWorkspace(gen, joinRoot(gen, previewRel), placeholderPreviewHtml(p));
        }
      } catch {
        await writeTextUnderWorkspace(gen, joinRoot(gen, previewRel), placeholderPreviewHtml(p)).catch(
          () => null,
        );
      }
    } else if (mode !== "upload") {
      const v1Rel = `${dir}/v1.svg`;
      const abs = designAbs(project, v1Rel);
      try {
        if (!(await exists(abs))) {
          await writeTextUnderWorkspace(gen, joinRoot(gen, v1Rel), placeholderWireframeSvg(p));
        }
      } catch {
        await writeTextUnderWorkspace(gen, joinRoot(gen, v1Rel), placeholderWireframeSvg(p)).catch(
          () => null,
        );
      }
    }
  }

  await writeGalleryIndex(project, pages).catch(() => null);
  return next;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function placeholderWireframeSvg(page: BriefPage): string {
  const title = page.name.replace(/[<>&]/g, "");
  const route = (page.route || "").replace(/[<>&"]/g, "");
  const purpose = (page.purpose || "").replace(/[<>&"]/g, "").slice(0, 80);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
  <rect width="800" height="500" fill="#f8fafc" stroke="#cbd5e1"/>
  <rect x="24" y="24" width="752" height="48" rx="6" fill="#e2e8f0"/>
  <text x="40" y="54" font-family="sans-serif" font-size="18" fill="#0f172a">${title}</text>
  <text x="40" y="100" font-family="sans-serif" font-size="13" fill="#64748b">${route}</text>
  <rect x="24" y="120" width="240" height="340" rx="6" fill="#fff" stroke="#e2e8f0"/>
  <rect x="280" y="120" width="496" height="200" rx="6" fill="#fff" stroke="#e2e8f0"/>
  <rect x="280" y="340" width="496" height="120" rx="6" fill="#fff" stroke="#e2e8f0"/>
  <text x="40" y="160" font-family="sans-serif" font-size="12" fill="#94a3b8">侧栏 / 导航</text>
  <text x="300" y="160" font-family="sans-serif" font-size="12" fill="#94a3b8">主内容区 · ${purpose}</text>
</svg>
`;
}

function placeholderPreviewHtml(page: BriefPage): string {
  const title = escapeHtml(page.name);
  const route = escapeHtml(page.route || "");
  const purpose = escapeHtml((page.purpose || "").slice(0, 120));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", "PingFang SC", sans-serif; }
    body { margin: 0; background: #f1f5f9; color: #0f172a; }
    header { background: #0f172a; color: #fff; padding: 14px 20px; display: flex; gap: 16px; align-items: center; }
    header .brand { font-weight: 700; }
    nav a { color: #94a3b8; text-decoration: none; margin-right: 12px; font-size: 14px; }
    main { max-width: 960px; margin: 24px auto; padding: 0 16px; display: grid; gap: 16px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    .muted { color: #64748b; font-size: 14px; }
    .actions { display: flex; gap: 10px; margin-top: 16px; }
    button { border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
    .primary { background: #0d9488; color: #fff; }
    .ghost { background: #e2e8f0; color: #0f172a; }
  </style>
</head>
<body>
  <header>
    <div class="brand">${title}</div>
    <nav>
      <a href="index.html">界面画廊</a>
      <a href="#">${route || "#"}</a>
    </nav>
  </header>
  <main>
    <section class="card">
      <h1>${title}</h1>
      <p class="muted">${purpose || "可点击 HTML 预览线框（非扩散模型生图）"}</p>
      <div class="actions">
        <button type="button" class="primary">主操作</button>
        <button type="button" class="ghost">次要操作</button>
      </div>
    </section>
    <section class="card">
      <h2 style="margin:0 0 8px;font-size:16px">内容区</h2>
      <p class="muted">请设计岗按页面清单完善本页区块、表单与导航。</p>
    </section>
  </main>
</body>
</html>
`;
}

export async function writeGalleryIndex(
  project: XuProject,
  pages?: BriefPage[],
): Promise<string> {
  const gen = (project.generatePath || "").trim();
  if (!gen) throw new Error("项目未设置生成路径");
  const brief = await loadBrief(project.id);
  const list = pages?.length ? pages : brief.pages?.length ? brief.pages : inferPagesFromBrief(brief);
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_PREVIEW));

  const cards: string[] = [];
  for (const p of list) {
    const previewRel = p.previewPath || `${DESIGN_PREVIEW}/${p.id}.html`;
    const uploadCand = await listWireframeCandidates(project, p.id);
    const img = uploadCand.find((c) => IMAGE_EXT.test(c) && !/\.svg$/i.test(c));
    const href = img
      ? `../${img.replace(/\\/g, "/").replace(/^\.xu\/design\//, "")}`
      : `${p.id}.html`;
    const thumb = img
      ? `<img src="${escapeHtml(href)}" alt="${escapeHtml(p.name)}" />`
      : `<iframe src="${escapeHtml(p.id)}.html" title="${escapeHtml(p.name)}" loading="lazy"></iframe>`;
    cards.push(`
    <a class="card" href="${escapeHtml(img ? href : `${p.id}.html`)}" target="_blank" rel="noopener">
      <div class="thumb">${thumb}</div>
      <div class="meta">
        <strong>${escapeHtml(p.name)}</strong>
        <span>${escapeHtml(p.route || p.id)} · ${escapeHtml(p.status)}</span>
      </div>
    </a>`);
    void previewRel;
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>界面画廊 · ${escapeHtml(project.name)}</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "PingFang SC", sans-serif; background: #0f172a; color: #e2e8f0; }
    header { padding: 28px 24px 8px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .sub { color: #94a3b8; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; padding: 20px 24px 40px; }
    .card { display: flex; flex-direction: column; background: #1e293b; border: 1px solid #334155; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; }
    .card:hover { border-color: #14b8a6; }
    .thumb { height: 150px; background: #0b1220; overflow: hidden; }
    .thumb img, .thumb iframe { width: 100%; height: 100%; border: 0; object-fit: cover; pointer-events: none; }
    .meta { padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
    .meta span { font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <header>
    <h1>界面画廊</h1>
    <p class="sub">${escapeHtml(project.name)} · 点击卡片打开对应预览</p>
  </header>
  <div class="grid">
    ${cards.join("\n") || "<p class=\"sub\">暂无页面</p>"}
  </div>
</body>
</html>
`;
  const absRel = joinRoot(gen, DESIGN_GALLERY_INDEX);
  await writeTextUnderWorkspace(gen, absRel, html);
  return absRel;
}

export async function openDesignGallery(project: XuProject): Promise<void> {
  await writeGalleryIndex(project);
  const abs = designAbs(project, DESIGN_GALLERY_INDEX);
  const { open } = await import("@tauri-apps/plugin-shell");
  const url = abs.startsWith("file:") ? abs : `file:///${abs.replace(/\\/g, "/")}`;
  await open(url);
}

export async function listWireframeCandidates(
  project: XuProject,
  pageId: string,
): Promise<string[]> {
  const out: string[] = [];
  const dirs = [
    `${DESIGN_WIREFRAMES}/${pageId}`,
    DESIGN_UPLOADS,
    DESIGN_PREVIEW,
  ];
  for (const relDir of dirs) {
    const dir = designAbs(project, relDir);
    try {
      if (!(await exists(dir))) continue;
      const entries = await readDir(dir);
      for (const e of entries) {
        if (!e.name || e.isDirectory) continue;
        if (!/\.(svg|png|jpe?g|webp|html?)$/i.test(e.name)) continue;
        if (relDir === DESIGN_PREVIEW) {
          if (e.name.toLowerCase() === "index.html") continue;
          if (e.name !== `${pageId}.html` && !e.name.startsWith(`${pageId}.`)) continue;
        }
        if (relDir === DESIGN_UPLOADS) {
          const stem = e.name.replace(/\.[^.]+$/, "");
          if (stem !== pageId && !e.name.startsWith(`${pageId}-`) && !e.name.startsWith(`${pageId}_`)) {
            // still list; user can pick any upload for a page
          }
        }
        out.push(`${relDir}/${e.name}`.replace(/\\/g, "/"));
      }
    } catch {
      /* ignore */
    }
  }
  return [...new Set(out)].sort();
}

export async function hasDesignArtifacts(project: XuProject): Promise<boolean> {
  const gen = (project.generatePath || "").trim();
  if (!gen) return false;
  try {
    const approvedMd = designAbs(project, DESIGN_APPROVED_MD);
    if (!(await exists(approvedMd))) return false;
    const brief = await loadBrief(project.id);
    const pages = brief.pages?.length ? brief.pages : [];
    if (!pages.length) return true;
    for (const p of pages) {
      const rel = p.chosenDesignPath || `${DESIGN_APPROVED}/${p.id}.svg`;
      if (!(await exists(designAbs(project, rel)))) return false;
      if (p.status !== "confirmed") return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** True when design is approved AND frozen — required before dispatching code. */
export async function canDispatchDevAfterDesign(project: XuProject): Promise<boolean> {
  return (await hasDesignArtifacts(project)) && (await isDesignFrozen(project));
}

export type DesignApprovalPick = { pageId: string; wireframeRel: string };

function isBinaryDesign(rel: string): boolean {
  return IMAGE_EXT.test(rel) && !TEXT_DESIGN_EXT.test(rel);
}

/** Copy chosen wireframes to approved/, update Brief, write APPROVED.md, freeze. */
export async function approveDesignPicks(
  project: XuProject,
  picks: DesignApprovalPick[],
): Promise<RequirementBrief> {
  const gen = (project.generatePath || "").trim();
  if (!gen) throw new Error("项目未设置生成路径");
  let brief = await loadBrief(project.id);
  const pages = brief.pages?.length ? [...brief.pages] : inferPagesFromBrief(brief);
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_APPROVED));

  const pickMap = new Map(picks.map((p) => [p.pageId, p.wireframeRel]));
  const nextPages: BriefPage[] = [];
  const lines = [`# 设计定稿 · ${project.name}`, "", `确认时间：${new Date().toISOString()}`, ""];

  for (const page of pages) {
    const srcRel = pickMap.get(page.id);
    if (!srcRel) {
      nextPages.push(page);
      continue;
    }
    const ext = srcRel.includes(".") ? srcRel.slice(srcRel.lastIndexOf(".")) : ".svg";
    const destRel = `${DESIGN_APPROVED}/${page.id}${ext}`;
    const srcAbs = designAbs(project, srcRel);
    const destAbs = designAbs(project, destRel);
    try {
      if (isBinaryDesign(srcRel)) {
        await copyUnderWorkspace(gen, srcAbs, destAbs);
      } else {
        const raw = await readTextFile(srcAbs);
        await writeTextUnderWorkspace(gen, destAbs, raw);
      }
    } catch (e) {
      // Fallback: try import-style copy (handles edge cases)
      try {
        await importFileIntoWorkspace(gen, srcAbs, destAbs);
      } catch {
        throw new Error(`复制设计稿失败（${page.name}）：${toUserError(e)}`);
      }
    }
    const sourceKind: BriefPage["sourceKind"] =
      /\.html?$/i.test(ext) ? "html" : isBinaryDesign(srcRel) ? "upload" : /\.svg$/i.test(ext) ? "svg" : "html";
    nextPages.push({
      ...page,
      status: "confirmed",
      chosenDesignPath: destRel,
      previewPath: srcRel.includes(`${DESIGN_PREVIEW}/`) ? srcRel : page.previewPath,
      sourceKind,
    });
    lines.push(`- [x] **${page.name}** → \`${destRel}\``);
  }

  await writeTextUnderWorkspace(gen, joinRoot(gen, DESIGN_APPROVED_MD), lines.join("\n") + "\n");
  brief = await saveBrief({
    ...brief,
    pages: nextPages,
    designFrozen: true,
    decisions: [
      ...(brief.decisions || []).filter((d) => !d.startsWith("设计定稿：") && !d.startsWith("设计冻结：")),
      `设计定稿：${nextPages.filter((p) => p.status === "confirmed").length}/${nextPages.length} 页`,
      "设计冻结：已确认，变更须解冻并重新确认后再派开发",
    ],
  });
  await syncPagesJson(project, nextPages);
  await freezeDesign(project);
  await writeGalleryIndex(project, nextPages).catch(() => null);
  return brief;
}

/** Import user-selected image files into uploads/ and attach as candidates. */
export async function importDesignUploads(
  project: XuProject,
  filePaths: string[],
  pageId?: string,
): Promise<string[]> {
  const gen = (project.generatePath || "").trim();
  if (!gen) throw new Error("项目未设置生成路径");
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_UPLOADS));
  const imported: string[] = [];
  let i = 0;
  for (const src of filePaths) {
    if (!IMAGE_EXT.test(src) && !/\.html?$/i.test(src)) continue;
    const base = src.replace(/\\/g, "/").split("/").pop() || `upload-${Date.now()}.png`;
    const safe = base.replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
    const prefix = pageId ? `${pageId}-` : "";
    const name = `${prefix}${Date.now()}-${i}-${safe}`;
    i += 1;
    const destRel = `${DESIGN_UPLOADS}/${name}`;
    const destAbs = designAbs(project, destRel);
    await importFileIntoWorkspace(gen, src, destAbs);
    imported.push(destRel);
  }
  if (pageId && imported[0]) {
    const brief = await loadBrief(project.id);
    const pages = (brief.pages || []).map((p) =>
      p.id === pageId
        ? { ...p, previewPath: imported[0], sourceKind: "upload" as const, status: "designed" as const }
        : p,
    );
    await saveBrief({ ...brief, pages, designMode: "upload" });
    await syncPagesJson(project, pages);
  }
  await writeGalleryIndex(project).catch(() => null);
  return imported;
}

/** Scan a folder for images; copy into uploads/ and map onto pages. */
export async function importDesignFolder(
  project: XuProject,
  folderPath: string,
): Promise<{ count: number; sourceDir: string }> {
  const gen = (project.generatePath || "").trim();
  if (!gen) throw new Error("项目未设置生成路径");
  const folder = folderPath.trim().replace(/\\/g, "/");
  if (!folder) throw new Error("文件夹路径为空");
  const entries = await listDir(folder, false);
  const images = entries.filter((e) => !e.is_dir && IMAGE_EXT.test(e.name));
  if (!images.length) throw new Error("文件夹内未找到 png/jpg/webp/svg 图片");

  await writeDesignMode(project, "upload", folder);
  await mkdirRecursive(gen, joinRoot(gen, DESIGN_UPLOADS));

  let brief = await loadBrief(project.id);
  let pages = brief.pages?.length ? [...brief.pages] : inferPagesFromBrief(brief);
  if (!brief.pages?.length) {
    brief = await saveBrief({ ...brief, pages });
  }

  let count = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const destRel = `${DESIGN_UPLOADS}/${slugPageId(img.name.replace(/\.[^.]+$/, ""), i)}-${img.name}`;
    await importFileIntoWorkspace(gen, img.path, designAbs(project, destRel));

    if (i < pages.length) {
      pages = pages.map((p, idx) =>
        idx === i
          ? {
              ...p,
              previewPath: destRel,
              sourceKind: "upload" as const,
              status: "designed" as const,
            }
          : p,
      );
    } else {
      const id = slugPageId(img.name.replace(/\.[^.]+$/, ""), i);
      pages.push({
        id,
        name: img.name.replace(/\.[^.]+$/, ""),
        status: "designed",
        previewPath: destRel,
        sourceKind: "upload",
      });
    }
    count += 1;
  }

  brief = await saveBrief({ ...brief, pages, designMode: "upload" });
  await syncPagesJson(project, pages);
  await writeGalleryIndex(project, pages).catch(() => null);
  return { count, sourceDir: folder };
}

export async function appendDesignRevision(
  project: XuProject,
  note: string,
): Promise<void> {
  const gen = (project.generatePath || "").trim();
  if (!gen || !note.trim()) return;
  const abs = designAbs(project, DESIGN_REVISIONS_MD);
  let prev = "";
  try {
    if (await exists(abs)) prev = await readTextFile(abs);
  } catch {
    prev = "";
  }
  const block = `\n## ${new Date().toISOString()}\n\n${note.trim()}\n`;
  await writeTextUnderWorkspace(
    gen,
    joinRoot(gen, DESIGN_REVISIONS_MD),
    (prev || `# 设计修订记录 · ${project.name}\n`) + block,
  );
}

/** Read SVG/HTML text for preview. */
export async function readDesignPreview(project: XuProject, rel: string): Promise<string> {
  const abs = designAbs(project, rel);
  return readTextFile(abs);
}

/** Extra instructions for design-wave agents based on mode + capability packs. */
export async function buildDesignWaveExtraInstructions(
  project: XuProject,
  mode?: DesignMode | null,
): Promise<string> {
  const m = mode || (await readDesignMode(project)) || "html";
  const caps = await buildAgentCapabilityHints();
  const uiSkillHint =
    caps && /interface|ui|视觉|设计/i.test(caps)
      ? "若已启用 UI/界面类能力包或 Skill，请按其风格生成预览。"
      : "按简洁中文业务 UI 生成可点击 HTML 预览（标题、区块、主按钮）。";

  if (m === "upload") {
    return [
      "【设计路径：上传设计图】",
      "用户将提供或已放入 .xu/design/uploads/ 的图片。请整理 pages.json，把图片挂到对应 pageId，更新界面画廊 preview/index.html。",
      "不要假装扩散模型生图；不要写业务 src/。",
    ].join("\n");
  }
  if (m === "canvas") {
    return [
      "【设计路径：Canvas 简图】",
      "仅做简单框线/流程图级示意（SVG），写入 wireframes/{pageId}/。",
      "非 Midjourney/SD 级出图。同步 preview/index.html 画廊。",
      "禁止写业务实现代码。",
    ].join("\n");
  }
  return [
    "【设计路径：网页版生图 = HTML 预览】",
    "按 pages[] 逐页生成可点击 HTML：.xu/design/preview/{pageId}.html（含标题、导航、主内容区、主按钮；中文 UI）。",
    "生成后更新 .xu/design/preview/index.html 界面画廊（卡片网格，链到各页）。",
    uiSkillHint,
    "可选同步简易 SVG 到 wireframes/；禁止写业务 src/。用户可在 REVISIONS.md 记录「第 N 页：改…」后只改对应页。",
    caps.trim() ? `【能力包提示】${caps.trim().slice(0, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
