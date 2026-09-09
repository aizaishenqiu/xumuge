<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { FouButton } from "foucui";
import { loadProjects, type XuProject } from "../utils/projects";
import { canvasPanelLabel } from "../utils/v1ProductSurface";
import {
  countRunningProjects,
  loadProjectTheme,
  reconcileProjectTheme,
  type ProjectTheme,
} from "../utils/projectTheme";

const emit = defineEmits<{
  newProject: [];
}>();

const router = useRouter();
const projects = ref<XuProject[]>([]);
const theme = ref<ProjectTheme | null>(null);

async function refresh() {
  try {
    projects.value = await loadProjects();
  } catch {
    projects.value = [];
  }
  try {
    const raw = await loadProjectTheme();
    theme.value = await reconcileProjectTheme(projects.value, raw);
  } catch {
    theme.value = null;
  }
}

onMounted(() => {
  void refresh();
  window.addEventListener("xu-project-changed", refresh);
  window.addEventListener("xu-projects-changed", refresh);
});
onUnmounted(() => {
  window.removeEventListener("xu-project-changed", refresh);
  window.removeEventListener("xu-projects-changed", refresh);
});

const totalCount = computed(() => projects.value.length);
const runningCount = computed(() => countRunningProjects(projects.value, theme.value));
const hasRunning = computed(() => runningCount.value > 0);

function goOffice() {
  void router.push("/office");
}

function goCanvas() {
  void router.push("/canvas");
}

function goProjects() {
  void router.push("/projects");
}

function onNewProject() {
  emit("newProject");
}
</script>

<template>
  <div class="chat-project-bar ui-font">
    <span class="cpb-stats">
      共 <strong>{{ totalCount }}</strong> 个项目 ·
      <strong class="cpb-run">{{ runningCount }}</strong> 运行中
    </span>
    <span class="cpb-spacer" />
    <FouButton
      icon="folder-add-line"
      size="small"
      text
      native-type="button"
      @click.stop="onNewProject"
    >
      新建项目
    </FouButton>
    <FouButton
      icon="artboard-2-line"
      size="small"
      text
      native-type="button"
      :title="canvasPanelLabel()"
      @click.stop="goCanvas"
    >
      Canvas
    </FouButton>
    <FouButton
      icon="folder-3-line"
      size="small"
      text
      native-type="button"
      @click.stop="goProjects"
    >
      项目页
    </FouButton>
    <FouButton
      v-if="hasRunning"
      icon="building-4-line"
      size="small"
      type="primary"
      native-type="button"
      @click="goOffice"
    >
      办公室
    </FouButton>
  </div>
</template>

<style scoped>
.chat-project-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  flex-shrink: 0;
  padding: 0 12px;
  background: var(--chrome-bar, var(--surface-soft));
  border-bottom: 1px solid var(--hairline);
  font-size: 13px;
  min-width: 0;
}
.cpb-stats {
  color: var(--muted);
  white-space: nowrap;
}
.cpb-stats strong {
  color: var(--ink);
  font-weight: 650;
}
.cpb-stats .cpb-run {
  color: var(--success);
}
.cpb-spacer {
  flex: 1;
}
</style>
