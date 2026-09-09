<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  agencyOverrideVersion,
  ensureAgencyCatalog,
  listAgencyRoles,
} from "../office/agencyRoles";
import {
  TAXONOMY_INDUSTRIES,
  TAXONOMY_POSITION_CATEGORIES,
  industryLabel,
  positionCategoryLabel,
} from "../office/taxonomy";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    mode?: "industry" | "position";
    showAll?: boolean;
  }>(),
  {
    modelValue: "all",
    mode: "industry",
    showAll: true,
  },
);

const emit = defineEmits<{
  "update:modelValue": [id: string];
}>();

const treeRef = ref<{ setCurrentKey?: (key: string | number) => void } | null>(null);

const allCount = computed(() => {
  void agencyOverrideVersion.value;
  return listAgencyRoles().length;
});

const industryCounts = computed(() => {
  void agencyOverrideVersion.value;
  const m = new Map<string, number>();
  for (const r of listAgencyRoles()) {
    const id = r.industryId || "general";
    m.set(id, (m.get(id) || 0) + 1);
  }
  return m;
});

const positionCounts = computed(() => {
  void agencyOverrideVersion.value;
  const m = new Map<string, number>();
  for (const r of listAgencyRoles()) {
    const id = r.positionCategory || "engineering";
    m.set(id, (m.get(id) || 0) + 1);
  }
  return m;
});

const treeData = computed(() => {
  if (props.mode === "position") {
    const children = TAXONOMY_POSITION_CATEGORIES.filter(
      (c) => (positionCounts.value.get(c.id) || 0) > 0,
    ).map((c) => ({
      id: c.id,
      label: `${c.label}（${positionCounts.value.get(c.id) || 0}）`,
    }));
    const known = new Set(children.map((c) => c.id));
    for (const [id, count] of positionCounts.value.entries()) {
      if (known.has(id) || count <= 0) continue;
      children.push({
        id,
        label: `${positionCategoryLabel(id)}（${count}）`,
      });
    }
    children.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    if (!props.showAll) return children;
    return [{ id: "all", label: `全部岗位（${allCount.value}）`, children }];
  }

  const children = TAXONOMY_INDUSTRIES.filter(
    (i) => (industryCounts.value.get(i.id) || 0) > 0,
  ).map((i) => ({
    id: i.id,
    label: `${i.label}（${industryCounts.value.get(i.id) || 0}）`,
  }));
  // Packs may use industry ids beyond taxonomy-industries.json — still show Chinese labels
  const known = new Set(children.map((c) => c.id));
  for (const [id, count] of industryCounts.value.entries()) {
    if (known.has(id) || count <= 0) continue;
    children.push({
      id,
      label: `${industryLabel(id)}（${count}）`,
    });
  }
  children.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  if (!props.showAll) return children;
  return [{ id: "all", label: `全部行业（${allCount.value}）`, children }];
});

async function syncCurrent() {
  await nextTick();
  treeRef.value?.setCurrentKey?.(props.modelValue || "all");
}

void ensureAgencyCatalog().then(() => syncCurrent());

watch(
  () => [props.modelValue, props.mode] as const,
  () => {
    void syncCurrent();
  },
);

watch(agencyOverrideVersion, () => {
  void syncCurrent();
});

function onNodeClick(data: { id?: string | number }) {
  const id = String(data?.id ?? "all");
  emit("update:modelValue", id);
}
</script>

<template>
  <div class="agency-taxonomy-tree-wrap">
    <FouTree
      ref="treeRef"
      class="agency-taxonomy-tree ui-font"
      :data="treeData"
      node-key="id"
      :props="{ label: 'label', children: 'children' }"
      default-expand-all
      highlight-current
      :expand-on-click-node="false"
      @node-click="onNodeClick"
    />
  </div>
</template>

<style scoped>
.agency-taxonomy-tree-wrap {
  min-height: 0;
  overflow: auto;
}
.agency-taxonomy-tree :deep(.fou-tree) {
  background: transparent;
  font-size: 12.5px;
}
</style>
