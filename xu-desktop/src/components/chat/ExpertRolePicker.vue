<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { FouButton } from "foucui";
import ProjectRolePickerDialog from "../ProjectRolePickerDialog.vue";
import {
  ensureAgencyCatalog,
  getAgencyRole,
  type AgencyRole,
} from "../../office/agencyRoles";

const props = defineProps<{
  roleId: string | null;
}>();

const emit = defineEmits<{
  "update:roleId": [id: string | null];
}>();

const dialogOpen = ref(false);
const pickerSelectedIds = ref<string[]>([]);

const role = computed(() => (props.roleId ? getAgencyRole(props.roleId) : null));

const pillLabel = computed(() => {
  const r = role.value;
  if (!r) return "通用助手";
  return `${r.emoji || "👤"} ${r.nameZh || r.name}`;
});

onMounted(() => {
  void ensureAgencyCatalog();
});

watch(dialogOpen, (open) => {
  if (open) {
    pickerSelectedIds.value = props.roleId ? [props.roleId] : [];
  }
});

function openDialog() {
  dialogOpen.value = true;
}

function onPick(r: AgencyRole) {
  if (!pickerSelectedIds.value.includes(r.id)) {
    pickerSelectedIds.value = [...pickerSelectedIds.value, r.id];
  }
  emit("update:roleId", r.id);
}

function onUnpick(roleId: string) {
  pickerSelectedIds.value = pickerSelectedIds.value.filter((id) => id !== roleId);
  if (props.roleId === roleId) {
    const rest = pickerSelectedIds.value;
    emit("update:roleId", rest.length ? rest[rest.length - 1]! : null);
  }
}

function clearRole() {
  pickerSelectedIds.value = [];
  emit("update:roleId", null);
}
</script>

<template>
  <div class="expert-picker">
    <FouButton
      class="footer-pill"
      :class="{ active: roleId }"
      icon="user-star-line"
      size="small"
      text
      native-type="button"
      @click="openDialog"
    >
      <span class="pill-label">{{ pillLabel }}</span>
      <span class="caret">▾</span>
    </FouButton>
    <FouButton
      v-if="roleId"
      icon="close-line"
      size="small"
      text
      native-type="button"
      aria-label="清除岗位"
      title="清除岗位"
      @click.stop="clearRole"
    />
    <ProjectRolePickerDialog
      v-if="dialogOpen"
      open
      single-select
      :selected-role-ids="pickerSelectedIds"
      @close="dialogOpen = false"
      @pick="onPick"
      @unpick="onUnpick"
    />
  </div>
</template>

<style scoped>
.expert-picker {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.footer-pill.active {
  border-color: var(--primary);
  background: var(--primary-glow);
}
.expert-picker :deep(.footer-pill.fou-button) {
  max-width: 120px;
}
.pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.caret {
  opacity: 0.5;
  font-size: 10px;
}
</style>
