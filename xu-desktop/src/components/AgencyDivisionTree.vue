<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  AGENCY_DIVISIONS,
  agencyOverrideVersion,
  ensureAgencyCatalog,
  listAgencyRoles,
} from "../office/agencyRoles";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    /** Show “全部分类” root node */
    showAll?: boolean;
  }>(),
  {
    modelValue: "all",
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

const divisionCounts = computed(() => {
  void agencyOverrideVersion.value;
  const m = new Map<string, number>();
  for (const r of listAgencyRoles()) {
    m.set(r.division, (m.get(r.division) || 0) + 1);
  }
  return m;
});

const treeData = computed(() => {
  const children = AGENCY_DIVISIONS.map((d) => ({
    id: d.id,
    label: `${d.name}（${divisionCounts.value.get(d.id) || 0}）`,
  }));
  if (!props.showAll) {
    return children;
  }
  return [
    {
      id: "all",
      label: `全部分类（${allCount.value}）`,
      children,
    },
  ];
});

async function syncCurrent() {
  await nextTick();
  treeRef.value?.setCurrentKey?.(props.modelValue || "all");
}

void ensureAgencyCatalog().then(() => syncCurrent());

watch(
  () => props.modelValue,
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
  <div class="agency-div-tree">
    <FouTree
      ref="treeRef"
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
.agency-div-tree {
  min-height: 0;
  overflow: auto;
}
.agency-div-tree :deep(.fou-tree) {
  background: transparent;
  font-size: 12.5px;
}
</style>
