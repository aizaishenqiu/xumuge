<script setup lang="ts">
import { FouButton } from "foucui";
import { computed, nextTick, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    options: string[];
    placeholder?: string;
    disabled?: boolean;
    searchPlaceholder?: string;
  }>(),
  {
    placeholder: "请选择（可多选）",
    disabled: false,
    searchPlaceholder: "筛选…",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const query = ref("");

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => o.toLowerCase().includes(q));
});

const summary = computed(() => {
  if (!props.modelValue.length) return "";
  if (props.modelValue.length <= 3) return props.modelValue.join(", ");
  return `${props.modelValue.slice(0, 2).join(", ")} 等 ${props.modelValue.length} 项`;
});

function setOption(opt: string, on: boolean) {
  const set = new Set(props.modelValue);
  if (on) set.add(opt);
  else set.delete(opt);
  const ordered = props.options.filter((o) => set.has(o));
  const extra = [...set].filter((x) => !props.options.includes(x));
  emit("update:modelValue", [...ordered, ...extra]);
}

async function positionPanel() {
  await nextTick();
  const el = rootRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const panelW = Math.max(r.width, 220);
  let left = r.left;
  if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
  let top = r.bottom + 4;
  const maxH = 240;
  if (top + maxH > window.innerHeight - 8) top = Math.max(8, r.top - maxH - 4);
  panelStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
    width: `${panelW}px`,
  };
}

async function toggleOpen() {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) {
    query.value = "";
    await positionPanel();
  }
}

function onDocPointer(e: PointerEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (rootRef.value?.contains(t)) return;
  const panel = document.querySelector(".msd-panel-float");
  if (panel?.contains(t)) return;
  open.value = false;
}

watch(open, (v) => {
  if (v) {
    document.addEventListener("pointerdown", onDocPointer, true);
    window.addEventListener("resize", positionPanel);
  } else {
    document.removeEventListener("pointerdown", onDocPointer, true);
    window.removeEventListener("resize", positionPanel);
  }
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("resize", positionPanel);
});
</script>

<template>
  <div ref="rootRef" class="msd ui-font" :class="{ open, disabled }">
    <FouButton
      class="msd-trigger"
      icon="list-check-2"
      text
      native-type="button"
      :disabled="disabled"
      @click="toggleOpen"
    >
      <span class="msd-text" :class="{ placeholder: !modelValue.length }">
        {{ summary || placeholder }}
      </span>
      <span class="msd-arrow" aria-hidden="true">▾</span>
    </FouButton>
    <Teleport to="body">
      <div
        v-if="open"
        class="msd-panel-float ui-font"
        :style="panelStyle"
        role="listbox"
        aria-multiselectable="true"
      >
        <FouInput
          v-model="query"
          size="small"
          clearable
          :placeholder="searchPlaceholder"
          @click.stop
        />
        <div class="msd-list">
          <label
            v-for="o in filtered"
            :key="o"
            class="msd-item"
            @click.stop
          >
            <FouCheckbox
              :model-value="modelValue.includes(o)"
              @update:model-value="(v: boolean) => setOption(o, v)"
            />
            <span>{{ o }}</span>
          </label>
          <p v-if="!filtered.length" class="msd-empty">无匹配项</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.msd {
  position: relative;
  width: 100%;
  min-width: 0;
}
.msd.disabled {
  opacity: 0.6;
}
.msd-trigger {
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border, #d0d5dd);
  background: var(--bg, #fff);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}
.msd-trigger:disabled {
  cursor: not-allowed;
}
.msd.open .msd-trigger {
  border-color: var(--primary, #14b8a6);
  box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.12);
}
.msd-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msd-text.placeholder {
  color: var(--muted, #94a3b8);
}
.msd-arrow {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--muted);
}
.msd-panel-float {
  position: fixed;
  z-index: 26000;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--hairline, rgba(15, 23, 42, 0.12));
  background: var(--surface-card, #fff);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.16);
}
.msd-list {
  overflow-y: auto;
  max-height: 190px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.msd-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.msd-item:hover {
  background: var(--surface-soft, #f8fafc);
}
.msd-empty {
  margin: 8px 4px;
  font-size: 12px;
  color: var(--muted);
}
</style>
