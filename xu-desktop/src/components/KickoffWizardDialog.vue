<script setup lang="ts">
import { computed } from "vue";
import { FouButton } from "foucui";
import type { KickoffPreview } from "../composables/office/useOfficeKickoffPreview";

const props = defineProps<{
  visible: boolean;
  loading?: boolean;
  preview: KickoffPreview | null;
  error?: string;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  confirm: [];
  cancel: [];
}>();

const open = computed({
  get: () => props.visible,
  set: (v: boolean) => emit("update:visible", v),
});

const overKickoffMax = computed(() => {
  const p = props.preview;
  if (!p || p.kickoffMax <= 0) return false;
  return p.total > p.kickoffMax;
});
</script>

<template>
  <FouDialog
    v-model="open"
    title="全体开工预览"
    width="520px"
    append-to-body
    destroy-on-close
  >
    <p v-if="loading" class="kw-hint ui-font">正在统计波次与人数…</p>
    <p v-else-if="error" class="kw-err ui-font">{{ error }}</p>
    <template v-else-if="preview">
      <p class="kw-summary ui-font">
        共 <strong>{{ preview.total }}</strong> 人 · 波内并行
        <strong>{{ preview.parallel }}</strong>
        <span v-if="preview.matchedOnly"> · 按 Brief 匹配岗位</span>
      </p>
      <p v-if="overKickoffMax" class="kw-warn ui-font">
        超过单次开工上限 {{ preview.kickoffMax }} 人，请分批或到「设置 → 并发」调高。
      </p>
      <table class="kw-table ui-font">
        <thead>
          <tr>
            <th>波次</th>
            <th>人数</th>
            <th>员工</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in preview.waves" :key="row.wave">
            <td>{{ row.label }}</td>
            <td>{{ row.count }}</td>
            <td class="kw-names">{{ row.names }}</td>
          </tr>
        </tbody>
      </table>
      <p class="kw-hint ui-font muted">
        确认后将按行业标准顺序分波派活；上一波关键岗位完成后进入下一波。
      </p>
    </template>

    <template #footer>
      <FouButton icon="close-line" native-type="button" @click="emit('cancel')">取消</FouButton>
      <FouButton
        icon="send-plane-line"
        type="primary"
        native-type="button"
        :disabled="loading || !preview || overKickoffMax"
        @click="emit('confirm')"
      >
        确认开工
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.kw-summary {
  margin: 0 0 10px;
}
.kw-hint {
  margin: 8px 0 0;
  font-size: 13px;
}
.kw-warn {
  margin: 0 0 10px;
  color: var(--fou-color-warning, #b45309);
  font-size: 13px;
}
.kw-err {
  color: var(--fou-color-danger, #dc2626);
}
.kw-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.kw-table th,
.kw-table td {
  border: 1px solid var(--fou-border-color, #e2e8f0);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
.kw-table th {
  background: var(--fou-fill-color-light, #f8fafc);
  font-weight: 600;
}
.kw-names {
  word-break: break-all;
}
.muted {
  opacity: 0.75;
}
</style>
