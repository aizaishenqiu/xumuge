<script setup lang="ts">
/**
 * @file CanvasUiPad.vue 图册（本地素材，可插入草图）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @updated 2026-09-07
 * @version 1.3.1
 * @category Layout
 * @algo canvas-album-insert
 */
import { onMounted, ref } from "vue";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton, FouDialog, fouAlert } from "foucui";
import {
  canvasImageDataUrl,
  deleteCanvasRel,
  ensureCanvasDirs,
  importCanvasImage,
  listAlbumEntries,
  type AlbumEntry,
} from "../../canvas/canvasIo";
import { emitCanvasAlbumInsert } from "../../utils/crossWindowBus";
import { toUserError } from "../../utils/userFacingError";

const props = defineProps<{ workspace: string }>();
const emit = defineEmits<{ inserted: [] }>();

type AlbumFile = AlbumEntry & { src: string };

const files = ref<AlbumFile[]>([]);
const status = ref("");
const previewOpen = ref(false);
const previewName = ref("");
const previewSrc = ref("");
const deleteOpen = ref(false);
const deleteTarget = ref<AlbumFile | null>(null);
const deleting = ref(false);

async function refresh() {
  if (!props.workspace) {
    files.value = [];
    return;
  }
  try {
    await ensureCanvasDirs(props.workspace);
    const list = await listAlbumEntries(props.workspace);
    const next: AlbumFile[] = [];
    for (const e of list) {
      try {
        next.push({ ...e, src: await canvasImageDataUrl(props.workspace, e.rel) });
      } catch {
        next.push({ ...e, src: "" });
      }
    }
    files.value = next;
  } catch (e) {
    void fouAlert(toUserError(e), "图册");
  }
}

async function importImages() {
  if (!props.workspace) {
    status.value = "请先选择工作区";
    void fouAlert("请先选择工作区。", "图册");
    return;
  }
  try {
    const picked = await openFileDialog({
      multiple: true,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    for (const src of list) {
      const name = String(src).split(/[/\\]/).pop() || "image.png";
      await importCanvasImage(props.workspace, String(src), name);
    }
    status.value = list.length ? `已导入 ${list.length} 张` : "";
    await refresh();
  } catch (e) {
    void fouAlert(toUserError(e), "导入图片失败");
  }
}

function insertToSketch(rel: string) {
  if (!props.workspace) return;
  emitCanvasAlbumInsert({ workspace: props.workspace, rel });
  emit("inserted");
  status.value = "已插入草图";
}

function viewImage(f: AlbumFile) {
  if (!f.src) {
    void fouAlert("无法预览该图片。", "查看");
    return;
  }
  previewName.value = f.name;
  previewSrc.value = f.src;
  previewOpen.value = true;
}

function askDelete(f: AlbumFile) {
  deleteTarget.value = f;
  deleteOpen.value = true;
}

async function confirmDelete() {
  const t = deleteTarget.value;
  if (!t || !props.workspace) {
    deleteOpen.value = false;
    return;
  }
  deleting.value = true;
  try {
    await deleteCanvasRel(props.workspace, t.rel);
    status.value = "已删除";
    deleteOpen.value = false;
    deleteTarget.value = null;
    if (previewOpen.value && previewName.value === t.name) previewOpen.value = false;
    await refresh();
  } catch (e) {
    void fouAlert(toUserError(e), "删除失败");
  } finally {
    deleting.value = false;
  }
}

onMounted(() => {
  void refresh();
});

defineExpose({ refresh });
</script>

<template>
  <div class="cui">
    <div class="cui-bar">
      <FouButton icon="image-add-line" type="primary" size="small" native-type="button" @click="importImages">
        导入图片
      </FouButton>
      <FouButton icon="refresh-line" size="small" native-type="button" @click="refresh">刷新</FouButton>
      <span class="cui-status ui-font">{{ status || "本地图册" }}</span>
    </div>
    <div v-if="!files.length" class="cui-empty ui-font">
      本地图册，不接云端生图。点「导入图片」添加素材；鼠标移到图上可查看或删除，或点「插入草图」。
    </div>
    <div v-else class="cui-grid">
      <figure v-for="f in files" :key="f.rel" class="cui-card">
        <div class="cui-thumb">
          <img v-if="f.src" :src="f.src" :alt="f.name" />
          <div v-else class="cui-miss ui-font">无法预览</div>
          <div class="cui-hover" aria-hidden="false">
            <FouButton
              icon="eye-line"
              type="primary"
              size="small"
              native-type="button"
              title="查看"
              aria-label="查看"
              @click.stop="viewImage(f)"
            >
              查看
            </FouButton>
            <FouButton
              icon="delete-bin-6-line"
              size="small"
              native-type="button"
              title="删除"
              aria-label="删除"
              @click.stop="askDelete(f)"
            >
              删除
            </FouButton>
          </div>
        </div>
        <figcaption class="ui-font" :title="f.name">{{ f.name }}</figcaption>
        <FouButton
          icon="pencil-ruler-2-line"
          type="primary"
          size="small"
          native-type="button"
          class="cui-insert"
          title="插入草图"
          aria-label="插入草图"
          @click="insertToSketch(f.rel)"
        >
          插入草图
        </FouButton>
      </figure>
    </div>

    <FouDialog v-model="previewOpen" :title="previewName || '查看'" width="720px" append-to-body>
      <div class="cui-preview">
        <img v-if="previewSrc" :src="previewSrc" :alt="previewName" />
        <p v-else class="ui-font">无法显示</p>
      </div>
    </FouDialog>

    <FouDialog v-model="deleteOpen" title="删除图片" width="400px" append-to-body>
      <p class="cui-del-msg ui-font">
        确定删除「{{ deleteTarget?.name || "该图片" }}」？删除后无法从本图册恢复。
      </p>
      <template #footer>
        <FouButton icon="close-line" size="small" native-type="button" @click="deleteOpen = false">取消</FouButton>
        <FouButton
          icon="delete-bin-6-line"
          type="primary"
          size="small"
          native-type="button"
          :loading="deleting"
          @click="confirmDelete"
        >
          删除
        </FouButton>
      </template>
    </FouDialog>
  </div>
</template>

<style scoped>
.cui {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.cui-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--hairline);
}
.cui-status {
  font-size: 12px;
  color: var(--muted, #888);
}
.cui-empty {
  padding: 16px;
  font-size: 13px;
  color: var(--muted, #888);
}
.cui-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  padding: 10px;
}
.cui-card {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cui-thumb {
  position: relative;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--hairline, #e2e8f0);
}
.cui-thumb img {
  width: 100%;
  height: 110px;
  object-fit: cover;
  display: block;
}
.cui-miss {
  width: 100%;
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--muted, #888);
  background: var(--surface-soft, #f8fafc);
}
.cui-hover {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(15, 23, 42, 0.55);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}
.cui-thumb:hover .cui-hover,
.cui-thumb:focus-within .cui-hover {
  opacity: 1;
  pointer-events: auto;
}
.cui-card figcaption {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cui-insert {
  align-self: stretch;
}
.cui-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  max-height: 70vh;
  overflow: auto;
}
.cui-preview img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
}
.cui-del-msg {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink, #1e293b);
}
</style>
