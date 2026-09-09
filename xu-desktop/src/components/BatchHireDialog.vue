<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FouButton } from "foucui";
import {
  AVATAR_STYLES,
  addEmployee,
  readEmployees,
  type Employee,
} from "../utils/employees";
import { cachedSession } from "../utils/auth";
import { writeDeskCount } from "../utils/officeSettings";
import {
  AGENCY_DIVISIONS,
  ensureAgencyCatalog,
  listAgencyRoles,
  getAgencyRole,
  type AgencyDivision,
} from "../office/agencyRoles";
import {
  COMPANY_STAFFING_PRESETS,
  type CompanyStaffingPresetId,
} from "../office/companyStaffing";
import {
  assignDesksByDivision,
  buildStaffedOfficeLayout,
  type StaffedRoomKind,
} from "../office/defaultLayout";
import { saveOfficeLayout, loadOfficeLayout } from "../utils/officeLayout";
import { resolveLegacyAgencyRoleId } from "../office/agencyRoleIdMap";
import { ROOM_DEFAULT_LABEL } from "../office/catalog";
import { toUserError } from "../utils/userFacingError";

const props = withDefaults(
  defineProps<{
    isOpen?: boolean;
    visible?: boolean;
  }>(),
  { isOpen: undefined, visible: undefined },
);

const emit = defineEmits<{
  close: [];
  done: [emps: Employee[]];
}>();

const parentOpen = computed(() => Boolean(props.isOpen ?? props.visible));
const dialogOpen = computed({
  get: () => parentOpen.value,
  set: (v: boolean) => {
    if (!v) emit("close");
  },
});

const ROOM_OPTIONS: StaffedRoomKind[] = [
  "room_tech",
  "room_sales",
  "room_finance",
  "room_procure",
  "room_code",
];

const companyPresetId = ref<CompanyStaffingPresetId | "">("software_full");
const headcount = ref(3);
const roleIds = ref<string[]>([
  resolveLegacyAgencyRoleId("engineering-frontend-developer"),
  resolveLegacyAgencyRoleId("engineering-frontend-developer"),
  resolveLegacyAgencyRoleId("engineering-frontend-developer"),
]);
const selectedRooms = ref<StaffedRoomKind[]>(["room_tech", "room_sales", "room_finance"]);
const layoutMode = ref<"generate" | "keep">("generate");
const workspaceRoot = ref("");
const error = ref("");
const saving = ref(false);

function applyCompanyPreset(id: CompanyStaffingPresetId | "") {
  companyPresetId.value = id;
  if (!id) return;
  const preset = COMPANY_STAFFING_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  roleIds.value = [...preset.roleIds];
  headcount.value = Math.max(1, Math.min(16, preset.roleIds.length));
  selectedRooms.value = [...preset.rooms];
  layoutMode.value = "generate";
}

watch(headcount, (n) => {
  const count = Math.max(1, Math.min(16, Math.floor(n) || 1));
  headcount.value = count;
  while (roleIds.value.length < count) {
    roleIds.value.push(roleIds.value[roleIds.value.length - 1] || resolveLegacyAgencyRoleId("engineering-frontend-developer"));
  }
  while (roleIds.value.length > count) roleIds.value.pop();
});

watch(parentOpen, (open) => {
  if (!open) return;
  error.value = "";
  saving.value = false;
  void ensureAgencyCatalog().then(() => {
    if (companyPresetId.value) applyCompanyPreset(companyPresetId.value);
  });
});

function toggleRoom(kind: StaffedRoomKind) {
  const i = selectedRooms.value.indexOf(kind);
  if (i >= 0) selectedRooms.value = selectedRooms.value.filter((k) => k !== kind);
  else selectedRooms.value = [...selectedRooms.value, kind];
}

function fillByDivision(div: AgencyDivision) {
  companyPresetId.value = "";
  const pool = listAgencyRoles().filter((r) => r.division === div);
  if (pool.length === 0) return;
  roleIds.value = Array.from({ length: headcount.value }, (_, i) => pool[i % pool.length].id);
}

async function pickWorkspace() {
  try {
    const selected = await openFileDialog({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) workspaceRoot.value = selected;
  } catch (e) {
    error.value = toUserError(e);
  }
}

async function submit() {
  error.value = "";
  const n = headcount.value;
  const session = cachedSession();
  const existing = readEmployees().length;
  if (session && !session.permissions.full) {
    const max = session.permissions.maxEmployees;
    if (existing + n > max) {
      error.value = `试用账号最多 ${max} 名员工（当前 ${existing}，再加 ${n} 超限）`;
      return;
    }
  }
  const needsWs = roleIds.value.some((id) => getAgencyRole(id)?.roleKind !== "boss");
  if (needsWs && !workspaceRoot.value.trim()) {
    error.value = "请设置共享可写工作区（批量非 boss 必填）";
    return;
  }
  if (layoutMode.value === "generate" && selectedRooms.value.length === 0) {
    error.value = "请至少勾选一个办公室模块";
    return;
  }

  saving.value = true;
  try {
    let layout =
      layoutMode.value === "generate"
        ? buildStaffedOfficeLayout({ deskCount: n, rooms: selectedRooms.value })
        : await loadOfficeLayout();

    if (layoutMode.value === "generate") {
      writeDeskCount(n);
      await saveOfficeLayout(layout);
    }

    const seats = assignDesksByDivision(layout, roleIds.value, (id) => getAgencyRole(id)?.division);
    const created: Employee[] = [];
    for (let i = 0; i < n; i++) {
      const roleId = roleIds.value[i];
      const agency = getAgencyRole(roleId);
      const emp = await addEmployee({
        role: agency?.nameZh || "员工",
        avatarId: AVATAR_STYLES[i % AVATAR_STYLES.length].id,
        deskIndex: seats[i] ?? i,
        workspaceRoot: workspaceRoot.value.trim() || undefined,
        roleKind: agency?.roleKind ?? "worker",
        brainSlot: agency?.brainSlot ?? "work",
        agentRoleId: roleId,
      });
      created.push(emp);
    }
    emit("done", created);
    emit("close");
  } catch (e) {
    error.value = toUserError(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <FouDialog
    v-model="dialogOpen"
    title="批量入职"
    width="720px"
    append-to-body
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    :show-fullscreen="false"
    :show-minimize="false"
    :draggable="false"
    :resizable="false"
    :z-index="20000"
    @close="emit('close')"
  >
    <label class="bh-field">
      <span>人数（1–16）</span>
      <FouInput v-model.number="headcount" type="number" :min="1" :max="16" />
    </label>

    <div class="bh-field">
      <span>按公司编制（自动填入角色与办公室）</span>
      <div class="bh-row">
        <FouButton
          v-for="p in COMPANY_STAFFING_PRESETS"
          :key="p.id"
          :icon="p.icon"
          size="small"
          native-type="button"
          :type="companyPresetId === p.id ? 'primary' : 'default'"
          @click="applyCompanyPreset(p.id)"
        >
          {{ p.name }}
        </FouButton>
      </div>
      <p v-if="companyPresetId" class="bh-hint ui-font">
        {{ COMPANY_STAFFING_PRESETS.find((x) => x.id === companyPresetId)?.description }}
      </p>
    </div>

    <div class="bh-field">
      <span>快捷填角色（按部门）</span>
      <div class="bh-row">
        <FouButton
          v-for="d in AGENCY_DIVISIONS"
          :key="d.id"
          icon="team-line"
          size="small"
          native-type="button"
          @click="fillByDivision(d.id)"
        >
          按{{ d.name }}填满
        </FouButton>
      </div>
    </div>

    <div class="bh-field">
      <span>角色列表（可重复）</span>
      <div v-for="(_, i) in roleIds" :key="i" class="bh-role-row">
        <span class="bh-idx">#{{ i + 1 }}</span>
        <select v-model="roleIds[i]" class="bh-select ui-font">
          <option v-for="r in listAgencyRoles()" :key="r.id" :value="r.id">
            {{ r.emoji }} {{ r.nameZh || r.name }}
          </option>
        </select>
      </div>
    </div>

    <div class="bh-field">
      <span>办公室模块</span>
      <div class="bh-row">
        <FouButton
          v-for="kind in ROOM_OPTIONS"
          :key="kind"
          icon="building-line"
          size="small"
          native-type="button"
          :type="selectedRooms.includes(kind) ? 'primary' : 'default'"
          @click="toggleRoom(kind)"
        >
          {{ ROOM_DEFAULT_LABEL[kind] || kind }}
        </FouButton>
      </div>
    </div>

    <div class="bh-field">
      <span>布局</span>
      <div class="bh-row">
        <FouButton
          icon="layout-grid-line"
          size="small"
          native-type="button"
          :type="layoutMode === 'generate' ? 'primary' : 'default'"
          @click="layoutMode = 'generate'"
        >
          生成默认布局
        </FouButton>
        <FouButton
          icon="map-pin-line"
          size="small"
          native-type="button"
          :type="layoutMode === 'keep' ? 'primary' : 'default'"
          @click="layoutMode = 'keep'"
        >
          仅加人保留当前布局
        </FouButton>
      </div>
    </div>

    <div class="bh-field">
      <span>共享可写工作区*</span>
      <div class="bh-path">
        <FouInput v-model="workspaceRoot" placeholder="绝对路径" />
        <FouButton icon="folder-open-line" native-type="button" @click="pickWorkspace">
          浏览
        </FouButton>
      </div>
    </div>

    <p v-if="error" class="bh-error">{{ error }}</p>

    <template #footer>
      <FouButton icon="close-line" native-type="button" @click="emit('close')">取消</FouButton>
      <FouButton
        type="primary"
        icon="user-add-line"
        native-type="button"
        :disabled="saving"
        @click="submit"
      >
        {{ saving ? "入职中…" : "一键入职" }}
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.bh-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--muted);
}
.bh-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bh-role-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.bh-idx {
  width: 28px;
  font-variant-numeric: tabular-nums;
}
.bh-select {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--hairline);
  background: var(--canvas);
  color: var(--body);
}
.bh-path {
  display: flex;
  gap: 8px;
}
.bh-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  opacity: 0.85;
}
.bh-error {
  color: #b91c1c;
  font-size: 13px;
}
</style>
