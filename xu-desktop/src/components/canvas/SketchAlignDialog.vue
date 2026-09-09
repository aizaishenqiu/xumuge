<script setup lang="ts">
/**
 * @file SketchAlignDialog.vue CDR 式对齐与分布
 * @author qiuye yjk150@qq.com
 * @date 2026-09-06
 * @version 1.0.1
 * @category UI
 * @algo align-distribute-dialog
 */
import { ref, watch } from "vue";
import { FouButton, FouDialog } from "foucui";
import type { AlignDir, AlignRelative } from "../../canvas/sketchTypes";

const props = defineProps<{
  modelValue: boolean;
  canAlign: boolean;
  canDistribute: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [boolean];
  align: [dir: AlignDir, relative: AlignRelative];
  distribute: [axis: "h" | "v"];
}>();

const relative = ref<AlignRelative>("selection");

watch(
  () => props.modelValue,
  (open) => {
    if (open) relative.value = "selection";
  },
);

const cells: { dir: AlignDir | null; icon: string; label: string }[] = [
  { dir: "l", icon: "align-left", label: "左" },
  { dir: "cx", icon: "align-center", label: "水平中" },
  { dir: "r", icon: "align-right", label: "右" },
  { dir: "t", icon: "align-top", label: "顶" },
  { dir: "cy", icon: "align-vertically", label: "垂直中" },
  { dir: "b", icon: "align-bottom", label: "底" },
];

function doAlign(dir: AlignDir) {
  emit("align", dir, relative.value);
}

function close() {
  emit("update:modelValue", false);
}
</script>

<template>
  <FouDialog :model-value="modelValue" title="对齐与分布" width="360px" append-to-body @update:model-value="emit('update:modelValue', $event)">
    <div class="sad ui-font">
      <div class="sad-rel">
        <span>相对</span>
        <FouButton
          icon="stack-line"
          size="small"
          :type="relative === 'selection' ? 'primary' : 'default'"
          native-type="button"
          @click="relative = 'selection'"
        >
          选区
        </FouButton>
        <FouButton
          icon="file-paper-2-line"
          size="small"
          :type="relative === 'page' ? 'primary' : 'default'"
          native-type="button"
          @click="relative = 'page'"
        >
          页面
        </FouButton>
      </div>
      <div class="sad-grid">
        <FouButton
          v-for="c in cells"
          :key="c.label"
          :icon="c.icon"
          size="small"
          native-type="button"
          :aria-label="c.label"
          :title="c.label"
          :disabled="!canAlign || !c.dir"
          @click="c.dir && doAlign(c.dir)"
        />
      </div>
      <div class="sad-dist">
        <FouButton
          icon="split-cells-horizontal"
          size="small"
          native-type="button"
          :disabled="!canDistribute"
          @click="emit('distribute', 'h')"
        >
          水平分布
        </FouButton>
        <FouButton
          icon="split-cells-vertical"
          size="small"
          native-type="button"
          :disabled="!canDistribute"
          @click="emit('distribute', 'v')"
        >
          垂直分布
        </FouButton>
      </div>
      <p class="sad-hint">分布需至少选中 3 个图形（Shift 多选）。单选且相对选区时对齐无效。</p>
    </div>
    <template #footer>
      <FouButton icon="close-line" size="small" native-type="button" @click="close">关闭</FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.sad {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sad-rel {
  display: flex;
  gap: 8px;
  align-items: center;
}
.sad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  max-width: 200px;
}
.sad-dist {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.sad-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted, #888);
}
</style>
