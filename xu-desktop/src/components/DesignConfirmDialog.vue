<script setup lang="ts">
import { onApiCatch, toUserError } from "../utils/userFacingError";
/**
 * Confirm per-page designs before software code wave.
 * Paths: upload | html preview | canvas (entitlement-gated).
 */
import { computed, ref, watch } from "vue";
import { FouButton, fouMsg, fouAlert} from "foucui";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { BriefPage, DesignMode } from "../intent/briefTypes";
import {
  approveDesignPicks,
  designAbs,
  ensureDesignScaffold,
  XU_DESIGN_CONFIRMED,
  importDesignFolder,
  importDesignUploads,
  listWireframeCandidates,
  openDesignGallery,
  readDesignMode,
  readDesignPreview,
  writeDesignMode,
  writeGalleryIndex,
  type DesignApprovalPick,
} from "../intent/designArtifacts";
import { loadBrief } from "../intent/briefStore";
import { loadProjects, type XuProject } from "../utils/projects";
import { bootstrapProjectGitAfterDesign } from "../utils/projectGitBootstrap";
import { hasEntitlement } from "../commerce/entitlements";

const props = defineProps<{
  visible: boolean;
  projectId: string | null;
}>();

const emit = defineEmits<{
  "update:visible": [boolean];
  confirmed: [{ projectId: string; dispatched?: number }];
}>();

const dialogOpen = computed({
  get: () => props.visible,
  set: (v: boolean) => emit("update:visible", v),
});

const busy = ref(false);
const project = ref<XuProject | null>(null);
const pages = ref<BriefPage[]>([]);
const activePageId = ref("");
const candidates = ref<string[]>([]);
const picks = ref<Record<string, string>>({});
const previewHtml = ref("");
const previewIsSvg = ref(true);
const designMode = ref<DesignMode>("html");
const folderPath = ref("");
const canvasOk = ref(false);

const activePage = computed(() => pages.value.find((p) => p.id === activePageId.value) || null);

async function refresh() {
  const id = props.projectId;
  if (!id) return;
  const list = await loadProjects();
  const p = list.find((x) => x.id === id) || null;
  project.value = p;
  if (!p?.generatePath) {
    pages.value = [];
    return;
  }
  try {
    canvasOk.value = await hasEntitlement("canvas.studio");
  } catch {
    canvasOk.value = false;
  }
  let brief = await loadBrief(id);
  const mode = brief.designMode || (await readDesignMode(p)) || "html";
  designMode.value = mode;
  brief = await ensureDesignScaffold(p, { ...brief, designMode: mode });
  pages.value = brief.pages?.length ? [...brief.pages] : [];
  if (!activePageId.value && pages.value[0]) activePageId.value = pages.value[0].id;
  await loadCandidatesForActive();
}

async function setMode(mode: DesignMode) {
  const p = project.value;
  if (!p) return;
  if (mode === "canvas" && !canvasOk.value) {
    void fouAlert("未授权 Canvas，请改用网页版预览", "提示");
    designMode.value = "html";
    mode = "html";
  }
  busy.value = true;
  try {
    designMode.value = mode;
    await writeDesignMode(p, mode);
    const brief = await loadBrief(p.id);
    await ensureDesignScaffold(p, { ...brief, designMode: mode });
    await writeGalleryIndex(p);
    fouMsg.success(
      mode === "upload"
        ? "已选：上传设计图"
        : mode === "canvas"
          ? "已选：Canvas 简图"
          : "已选：网页版 HTML 预览",
    );
    await refresh();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function onImportImages() {
  const p = project.value;
  if (!p) return;
  const selected = await openFileDialog({
    multiple: true,
    filters: [{ name: "设计图", extensions: ["png", "jpg", "jpeg", "webp", "svg", "html"] }],
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  busy.value = true;
  try {
    await writeDesignMode(p, "upload");
    designMode.value = "upload";
    const n = await importDesignUploads(p, paths, activePageId.value || undefined);
    fouMsg.success(`已导入 ${n.length} 个文件到设计附件目录`);
    await loadCandidatesForActive();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function onImportFolder() {
  const p = project.value;
  if (!p) return;
  let path = folderPath.value.trim();
  if (!path) {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    path = selected;
    folderPath.value = path;
  }
  busy.value = true;
  try {
    const r = await importDesignFolder(p, path);
    designMode.value = "upload";
    fouMsg.success(`已从文件夹导入 ${r.count} 张图`);
    await refresh();
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

async function onOpenGallery() {
  const p = project.value;
  if (!p) return;
  try {
    await openDesignGallery(p);
  } catch (e) {
    void onApiCatch(e);
  }
}

async function loadCandidatesForActive() {
  const p = project.value;
  const pageId = activePageId.value;
  if (!p || !pageId) {
    candidates.value = [];
    previewHtml.value = "";
    return;
  }
  candidates.value = await listWireframeCandidates(p, pageId);
  const page = pages.value.find((x) => x.id === pageId);
  if (!picks.value[pageId]) {
    const prefer =
      page?.previewPath ||
      candidates.value.find((c) => c.includes(`/preview/${pageId}.html`)) ||
      candidates.value[0];
    if (prefer) picks.value = { ...picks.value, [pageId]: prefer };
  }
  await loadPreview();
}

async function loadPreview() {
  const p = project.value;
  const pageId = activePageId.value;
  const rel = pageId ? picks.value[pageId] : "";
  if (!p || !rel) {
    previewHtml.value = "";
    return;
  }
  previewIsSvg.value = /\.svg$/i.test(rel) || /\.html?$/i.test(rel);
  if (/\.(png|jpe?g|webp|gif)$/i.test(rel)) {
    previewHtml.value = "";
    previewIsSvg.value = false;
    return;
  }
  try {
    previewHtml.value = await readDesignPreview(p, rel);
  } catch {
    previewHtml.value = "";
  }
}

watch(
  () => [props.visible, props.projectId] as const,
  ([vis]) => {
    if (vis) void refresh();
  },
  { immediate: true },
);

watch(activePageId, () => {
  void loadCandidatesForActive();
});

watch(
  () => picks.value[activePageId.value],
  () => {
    void loadPreview();
  },
);

const allPicked = computed(() => {
  if (!pages.value.length) return false;
  return pages.value.every((p) => Boolean(picks.value[p.id]));
});

function selectCandidate(rel: string) {
  if (!activePageId.value) return;
  picks.value = { ...picks.value, [activePageId.value]: rel };
}

async function onConfirm() {
  const p = project.value;
  if (!p) return;
  if (!allPicked.value) {
    void fouAlert("请为每个页面选择一份设计稿", "提示");
    return;
  }
  busy.value = true;
  try {
    await writeDesignMode(p, designMode.value);
    const pickList: DesignApprovalPick[] = pages.value.map((page) => ({
      pageId: page.id,
      wireframeRel: picks.value[page.id]!,
    }));
    await approveDesignPicks(p, pickList);
    const gitMsg = await bootstrapProjectGitAfterDesign(p).catch((e) => toUserError(e));
    const { beginTechReviewAfterDesign } = await import("../utils/workflowOrchestrator");
    await beginTechReviewAfterDesign(p.id);
    window.dispatchEvent(
      new CustomEvent(XU_DESIGN_CONFIRMED, { detail: { projectId: p.id } }),
    );
    fouMsg.success(
      `设计已确认并冻结。请确认技术方案后再写码${gitMsg ? `；Git：${gitMsg}` : ""}`,
    );
    emit("confirmed", { projectId: p.id, dispatched: 0 });
    emit("update:visible", false);
  } catch (e) {
    void onApiCatch(e);
  } finally {
    busy.value = false;
  }
}

function onLater() {
  emit("update:visible", false);
}

const previewSrc = computed(() => {
  const p = project.value;
  const rel = activePageId.value ? picks.value[activePageId.value] : "";
  if (!p || !rel || previewIsSvg.value) return "";
  try {
    return convertFileSrc(designAbs(p, rel));
  } catch {
    return `file:///${designAbs(p, rel).replace(/\\/g, "/")}`;
  }
});

async function openPreviewInOs() {
  const p = project.value;
  const rel = activePageId.value ? picks.value[activePageId.value] : "";
  if (!p || !rel) return;
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    const abs = designAbs(p, rel);
    await open(`file:///${abs.replace(/\\/g, "/")}`);
  } catch {
    try {
      await invoke("open_path", { path: designAbs(p, rel) });
    } catch (e) {
      void onApiCatch(e);
    }
  }
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    title="确认设计"
    width="900px"
    append-to-body
    :close-on-click-modal="false"
    :show-fullscreen="false"
    :show-minimize="false"
    :z-index="21200"
  >
    <p class="dcd-hint ui-font">
      先选设计路径，再为每页选定采用稿。全部确认后设计冻结并派开发写码（变更须「解冻设计」后重确认）。
    </p>

    <div class="dcd-modes">
      <FouButton
        icon="image-add-line"
        size="small"
        native-type="button"
        :type="designMode === 'upload' ? 'primary' : 'default'"
        :disabled="busy"
        @click="setMode('upload')"
      >
        上传设计图
      </FouButton>
      <FouButton
        icon="code-s-slash-line"
        size="small"
        native-type="button"
        :type="designMode === 'html' ? 'primary' : 'default'"
        :disabled="busy"
        @click="setMode('html')"
      >
        网页版生图
      </FouButton>
      <FouButton
        icon="pencil-ruler-2-line"
        size="small"
        native-type="button"
        :type="designMode === 'canvas' ? 'primary' : 'default'"
        :disabled="busy || !canvasOk"
        :title="canvasOk ? 'Canvas 简图' : '无 canvas.studio 授权，请改用网页版'"
        @click="setMode('canvas')"
      >
        Canvas 简图
      </FouButton>
      <FouButton
        v-if="!canvasOk"
        icon="arrow-right-line"
        size="small"
        native-type="button"
        :disabled="busy"
        @click="setMode('html')"
      >
        改用网页版预览
      </FouButton>
      <FouButton
        icon="layout-grid-line"
        size="small"
        native-type="button"
        :disabled="busy || !project"
        @click="onOpenGallery"
      >
        打开界面画廊
      </FouButton>
    </div>

    <div v-if="designMode === 'upload'" class="dcd-upload ui-font">
      <FouButton
        icon="upload-2-line"
        size="small"
        native-type="button"
        :disabled="busy"
        @click="onImportImages"
      >
        导入设计图
      </FouButton>
      <FouInput v-model="folderPath" placeholder="或填写已有图片文件夹路径" clearable />
      <FouButton
        icon="folder-open-line"
        size="small"
        native-type="button"
        :disabled="busy"
        @click="onImportFolder"
      >
        扫描文件夹
      </FouButton>
    </div>

    <div class="dcd-layout">
      <aside class="dcd-pages">
        <button
          v-for="page in pages"
          :key="page.id"
          type="button"
          class="dcd-page-btn ui-font"
          :class="{ active: page.id === activePageId, done: Boolean(picks[page.id]) }"
          @click="activePageId = page.id"
        >
          <span class="dcd-page-name">{{ page.name }}</span>
          <span class="dcd-page-meta">{{ page.route || page.id }}</span>
        </button>
        <p v-if="!pages.length" class="dcd-empty ui-font">暂无页面清单</p>
      </aside>
      <section class="dcd-main">
        <div v-if="activePage" class="dcd-cands">
          <FouButton
            v-for="c in candidates"
            :key="c"
            :icon="picks[activePage.id] === c ? 'checkbox-circle-line' : 'checkbox-blank-circle-line'"
            size="small"
            :type="picks[activePage.id] === c ? 'primary' : 'default'"
            native-type="button"
            :disabled="busy"
            @click="selectCandidate(c)"
          >
            {{ c.split("/").pop() }}
          </FouButton>
          <FouButton
            v-if="picks[activePage?.id || '']"
            icon="external-link-line"
            size="small"
            native-type="button"
            :disabled="busy"
            @click="openPreviewInOs"
          >
            外部打开
          </FouButton>
          <span v-if="!candidates.length" class="dcd-empty ui-font">该页尚无候选稿</span>
        </div>
        <div class="dcd-preview ui-font">
          <div v-if="previewIsSvg && previewHtml" class="dcd-svg" v-html="previewHtml" />
          <img v-else-if="previewSrc" :src="previewSrc" alt="设计预览" class="dcd-img" />
          <p v-else class="dcd-empty">选择左侧页面与候选稿以预览</p>
        </div>
      </section>
    </div>
    <template #footer>
      <FouButton icon="time-line" native-type="button" :disabled="busy" @click="onLater">
        稍后
      </FouButton>
      <FouButton
        type="primary"
        icon="checkbox-circle-line"
        native-type="button"
        :disabled="busy || !allPicked"
        :loading="busy"
        @click="onConfirm"
      >
        全部确认并开始写码
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.dcd-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted, #64748b);
  line-height: 1.45;
}
.dcd-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.dcd-upload {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.dcd-upload :deep(.fou-input) {
  flex: 1;
  min-width: 180px;
}
.dcd-layout {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 12px;
  min-height: 360px;
}
.dcd-pages {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-right: 1px solid var(--hairline, #e2e8f0);
  padding-right: 8px;
  max-height: 420px;
  overflow: auto;
}
.dcd-page-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.dcd-page-btn:hover {
  background: var(--surface-soft, #f1f5f9);
}
.dcd-page-btn.active {
  border-color: var(--primary, #0d9488);
  background: var(--primary-glow, rgba(13, 148, 136, 0.08));
}
.dcd-page-btn.done .dcd-page-name::after {
  content: " ✓";
  color: var(--primary, #0d9488);
}
.dcd-page-name {
  font-weight: 600;
  font-size: 13px;
}
.dcd-page-meta {
  font-size: 11px;
  color: var(--muted, #94a3b8);
}
.dcd-main {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.dcd-cands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dcd-preview {
  flex: 1;
  min-height: 280px;
  border: 1px solid var(--hairline, #e2e8f0);
  border-radius: 8px;
  background: #f8fafc;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.dcd-svg {
  width: 100%;
  max-width: 100%;
}
.dcd-svg :deep(svg) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}
.dcd-img {
  max-width: 100%;
  max-height: 360px;
  object-fit: contain;
}
.dcd-empty {
  margin: 0;
  font-size: 12px;
  color: var(--muted, #94a3b8);
}
</style>
