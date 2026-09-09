<script setup lang="ts">
import { FouButton } from "foucui";
import { startRegionScreenshot } from "../utils/screenshot";

defineProps<{
  sessionTitle?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <aside class="side-panel ui-font">
    <header>
      <strong>快照</strong>
      <FouButton icon="close-line" text native-type="button" aria-label="关闭" @click="emit('close')" />
    </header>

    <div class="body">
      <section class="block">
        <h3>区域截图</h3>
        <p class="hint">
          使用 <kbd>Alt</kbd>+<kbd>A</kbd> 或下方按钮，拖拽选择屏幕区域；可标注、复制到剪贴板，或完成加入输入框。
        </p>
        <FouButton icon="camera-line" native-type="button" @click="startRegionScreenshot()">
          开始截图
        </FouButton>
      </section>

      <p class="footnote">
        写盘快照与撤销请在办公室查看「.xu/snapshots」；此处为截屏加入对话。
      </p>
    </div>
  </aside>
</template>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-card, #fff);
  border-left: 1px solid var(--hairline, #e2e8f0);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline, #e2e8f0);
}
.body {
  flex: 1;
  overflow: auto;
  padding: 12px;
}
.block h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  line-height: 1.5;
}
.hint kbd {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--hairline, #e2e8f0);
  font-size: 12px;
}
.footnote {
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-tertiary, #94a3b8);
}
</style>
