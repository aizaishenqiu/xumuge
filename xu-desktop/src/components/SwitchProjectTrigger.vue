<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { fouMsg, FouButton, fouAlert } from "foucui";
import { onApiCatch } from "../utils/userFacingError";
import {
  isProjectIncomplete,
  loadProjectCategories,
  loadProjects,
  PROJECT_TYPE_LABEL,
  type XuProject,
  type ProjectCategory,
} from "../utils/projects";
import { loadEmployees, readEmployees, type Employee } from "../utils/employees";
import { switchOfficeProject } from "../utils/switchOfficeProject";
import { loadOfficeLayout } from "../utils/officeLayout";
import { formatQueueBadge } from "../utils/projectQueueRunner";
import { loadProjectQueue } from "../utils/projectQueue";

const props = defineProps<{
  employees: Employee[];
}>();

const emit = defineEmits<{
  switched: [project: XuProject];
}>();

const menuOpen = ref(false);
const loading = ref(false);
const switchingId = ref("");
const projects = ref<XuProject[]>([]);
const categories = ref<ProjectCategory[]>([]);
const activeId = ref<string | null>(null);
const selectedCatId = ref("");
const queueBadge = ref<string | null>(null);
const anchorRef = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({ top: "0px", left: "0px" });

const incomplete = computed(() =>
  projects.value.filter(isProjectIncomplete).sort((a, b) => b.updatedAt - a.updatedAt),
);

const catsWithProjects = computed(() => {
  const ids = new Set(incomplete.value.map((p) => p.categoryId));
  return categories.value.filter((c) => ids.has(c.id));
});

const projectsInCat = computed(() =>
  incomplete.value.filter((p) => p.categoryId === selectedCatId.value),
);

async function prepare() {
  const [projs, cats, layout, q] = await Promise.all([
    loadProjects(),
    loadProjectCategories(),
    loadOfficeLayout(),
    loadProjectQueue(),
  ]);
  projects.value = projs;
  categories.value = cats;
  activeId.value = layout.meta?.projectId || null;
  const cur = q.currentProjectId ? projs.find((p) => p.id === q.currentProjectId) : null;
  queueBadge.value = formatQueueBadge(q, cur?.name);
}

async function openMenu() {
  if (loading.value || switchingId.value) return;
  loading.value = true;
  try {
    await prepare();
  } catch (e) {
    void onApiCatch(e, undefined, { fallback: "加载项目失败" });
    return;
  } finally {
    loading.value = false;
  }

  const list = incomplete.value;
  if (list.length === 0) {
    void fouAlert("暂无未完成项目，无法切换", "提示");
    return;
  }
  if (list.length === 1) {
    const only = list[0]!;
    fouMsg.info(`当前只有一个未完成项目「${only.name}」，无法切换`);
    return;
  }

  const cats = catsWithProjects.value;
  const prefer =
    cats.find((c) => incomplete.value.some((p) => p.categoryId === c.id && p.id !== activeId.value))
      ?.id || cats[0]?.id;
  selectedCatId.value =
    prefer && cats.some((c) => c.id === prefer) ? prefer : list[0]!.categoryId;

  menuOpen.value = true;
  await nextTick();
  positionMenu();
}

function positionMenu() {
  const el = anchorRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const menuW = 380;
  let left = Math.min(r.right - menuW, window.innerWidth - menuW - 8);
  left = Math.max(8, left);
  let top = r.bottom + 6;
  const maxH = 320;
  if (top + maxH > window.innerHeight - 8) {
    top = Math.max(8, r.top - maxH - 6);
  }
  menuStyle.value = { top: `${top}px`, left: `${left}px` };
}

async function pick(project: XuProject) {
  if (switchingId.value) return;
  if (project.id === activeId.value) {
    fouMsg.info(`「${project.name}」已是当前绑定项目`);
    menuOpen.value = false;
    return;
  }
  switchingId.value = project.id;
  try {
    let emps = props.employees;
    if (!emps.length) {
      try {
        emps = await loadEmployees();
      } catch {
        emps = readEmployees();
      }
    }
    await switchOfficeProject(project, emps);
    activeId.value = project.id;
    menuOpen.value = false;
    fouMsg.success(`已切换到「${project.name}」`);
    emit("switched", project);
  } catch (e) {
    void onApiCatch(e, undefined, { fallback: "切换失败" });
  } finally {
    switchingId.value = "";
  }
}

function onDocPointer(e: PointerEvent) {
  if (!menuOpen.value) return;
  const t = e.target as Node;
  if (anchorRef.value?.contains(t)) return;
  const panel = document.querySelector(".switch-proj-cascade");
  if (panel?.contains(t)) return;
  menuOpen.value = false;
}

function onViewportChange() {
  if (menuOpen.value) positionMenu();
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
  void loadProjectQueue().then((q) => {
    const cur = q.currentProjectId
      ? projects.value.find((p) => p.id === q.currentProjectId)
      : null;
    queueBadge.value = formatQueueBadge(q, cur?.name);
  });
  window.addEventListener("xu-project-queue-changed", () => {
    void loadProjectQueue().then((q) => {
      const cur = q.currentProjectId
        ? projects.value.find((p) => p.id === q.currentProjectId)
        : null;
      queueBadge.value = formatQueueBadge(q, cur?.name);
    });
  });
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
});

defineExpose({ openMenu });
</script>

<template>
  <div ref="anchorRef" class="switch-proj-anchor">
    <slot :open="openMenu" :loading="loading" />
    <span v-if="queueBadge" class="switch-queue-badge ui-font">{{ queueBadge }}</span>
  </div>
  <Teleport to="body">
    <div
      v-if="menuOpen"
      class="switch-proj-cascade ui-font"
      :style="menuStyle"
      role="menu"
      aria-label="切换项目"
    >
      <div class="cascade-col cascade-cats">
        <div class="col-head">分类</div>
        <FouButton
          v-for="c in catsWithProjects"
          :key="c.id"
          icon="folder-open-line"
          size="small"
          native-type="button"
          class="cascade-cat-btn"
          :type="selectedCatId === c.id ? 'primary' : 'default'"
          @click="selectedCatId = c.id"
        >
          {{ c.name }}
        </FouButton>
      </div>
      <div class="cascade-col cascade-projs">
        <div class="col-head">未完成项目</div>
        <FouButton
          v-for="p in projectsInCat"
          :key="p.id"
          icon="arrow-left-right-line"
          size="small"
          native-type="button"
          class="cascade-proj-btn"
          :type="p.id === activeId ? 'default' : 'primary'"
          :loading="switchingId === p.id"
          :disabled="Boolean(switchingId && switchingId !== p.id)"
          @click="pick(p)"
        >
          {{ p.name }}
          <small v-if="p.id === activeId">（当前）</small>
          <small v-else class="muted"> · {{ PROJECT_TYPE_LABEL[p.type] }}</small>
        </FouButton>
        <p v-if="!projectsInCat.length" class="cascade-empty">该分类下无未完成项目</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.switch-proj-anchor {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex-shrink: 0;
}
.switch-queue-badge {
  font-size: 11px;
  color: var(--primary, #2563eb);
  white-space: nowrap;
}
.switch-proj-cascade {
  position: fixed;
  z-index: 25000;
  display: flex;
  width: 380px;
  max-height: 320px;
  border-radius: 12px;
  border: 1px solid var(--hairline, rgba(15, 23, 42, 0.12));
  background: var(--surface-card, #fff);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.cascade-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  overflow-y: auto;
  min-height: 0;
}
.cascade-cats {
  flex: 0 0 38%;
  border-right: 1px solid var(--hairline, rgba(15, 23, 42, 0.08));
  background: var(--surface-soft, #f8fafc);
}
.cascade-projs {
  flex: 1;
  min-width: 0;
}
.col-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  padding: 2px 4px 6px;
}
.cascade-cat-btn,
.cascade-proj-btn {
  width: 100%;
  justify-content: flex-start !important;
}
.cascade-proj-btn small {
  font-weight: 400;
  opacity: 0.75;
}
.cascade-proj-btn small.muted {
  font-size: 10px;
}
.cascade-empty {
  margin: 8px 4px;
  font-size: 12px;
  color: var(--muted);
}
</style>
