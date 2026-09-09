<script setup lang="ts">
import { onApiCatch, toUserError } from "../utils/userFacingError";
/**
 * @author qiuye <yjk150@qq.com>
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { FouButton, fouMsg } from "foucui";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  AGENCY_CATALOG_META,
  AGENCY_DIVISIONS,
  BRAIN_SLOT_ZH,
  ROLE_KIND_ZH,
  addCustomAgencyRole,
  agencyOverrideVersion,
  ensureAgencyCatalog,
  getAgencyRoleOverride,
  isCustomAgencyRole,
  listAgencyRoles,
  removeCustomAgencyRole,
  resetAgencyRoleOverride,
  saveAgencyRoleOverride,
  searchAgencyRoles,
  updateCustomAgencyRole,
  downloadAgencyLocalBundle,
  importAgencyLocalBundle,
  listAgencyTags,
  migrateAgencyRoleOverridesReadonly,
  parseAgencyTagsInput,
  formatAgencyTagsInput,
  kickoffWaveLabel,
  type AgencyRole,
} from "../office/agencyRoles";
import { AGENCY_TEAM_PACKS } from "../office/agencyTeamPacks";
import AgencyTaxonomyTree from "../components/AgencyTaxonomyTree.vue";
import PageHelpButton from "../components/help/PageHelpButton.vue";
import RolePackCatalogBanner from "../components/RolePackCatalogBanner.vue";
import {
  importUserSkillFile,
  openSkillsFolder,
  scanUserSkills,
  skillAppliesTo,
} from "../skills/userSkillsDir";
import type { InstalledCapabilityPack } from "../capabilities/types";

const router = useRouter();
const route = useRoute();
const query = ref("");
const taxonomyTab = ref<"industry" | "position">("industry");
const filterId = ref<string>("all");
const activeDivision = ref<string>("all");
const kindFilter = ref<"all" | AgencyRole["roleKind"]>("all");
const tagFilter = ref<string>("all");
const selectedId = ref("");
const draftName = ref("");
const draftDesc = ref("");
const draftPrompt = ref("");
const draftRequirements = ref("");
const draftSkillMd = ref("");
const draftTags = ref("");
const saveHint = ref("");
const importInput = ref<HTMLInputElement | null>(null);
const roleUserSkills = ref<InstalledCapabilityPack[]>([]);
const skillImportBusy = ref(false);

const createOpen = ref(false);
const createName = ref("");
const createDesc = ref("");
const createPrompt = ref("");
const createRequirements = ref("");
const createSkillMd = ref("");
const createTags = ref("");
const createDivision = ref("engineering");
const createKind = ref<AgencyRole["roleKind"]>("worker");
const createSlot = ref<AgencyRole["brainSlot"]>("work");
const createError = ref("");

void ensureAgencyCatalog().then(() => {
  if (migrateAgencyRoleOverridesReadonly()) {
    saveHint.value = "已清除历史岗位微调数据；岗位包人设现为只读。";
  }
  if (!selectedId.value) selectedId.value = listAgencyRoles()[0]?.id ?? "";
  if (AGENCY_DIVISIONS[0]) createDivision.value = AGENCY_DIVISIONS[0].id;
});

const allRoles = computed(() => {
  void agencyOverrideVersion.value;
  return listAgencyRoles();
});

const filtered = computed(() => {
  void agencyOverrideVersion.value;
  let list = query.value.trim() ? searchAgencyRoles(query.value) : allRoles.value;
  if (filterId.value !== "all") {
    if (taxonomyTab.value === "industry") {
      list = list.filter((r) => r.industryId === filterId.value);
    } else {
      list = list.filter((r) => r.positionCategory === filterId.value);
    }
  } else if (activeDivision.value !== "all") {
    list = list.filter((r) => r.division === activeDivision.value);
  }
  if (kindFilter.value !== "all") {
    list = list.filter((r) => r.roleKind === kindFilter.value);
  }
  if (tagFilter.value !== "all") {
    list = list.filter((r) => (r.tags || []).includes(tagFilter.value));
  }
  return list;
});

const availableTags = computed(() => {
  void agencyOverrideVersion.value;
  void activeDivision.value;
  if (activeDivision.value === "specialized" || activeDivision.value === "strategy") {
    const set = new Set<string>();
    for (const r of allRoles.value) {
      if (r.division !== activeDivision.value) continue;
      for (const t of r.tags || []) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "zh"));
  }
  return listAgencyTags();
});

const catalogTags = computed(() => {
  void agencyOverrideVersion.value;
  return listAgencyTags();
});

const showTagFilter = computed(() => {
  if (tagFilter.value !== "all") return true;
  if (activeDivision.value === "specialized" || activeDivision.value === "strategy") return true;
  return allRoles.value.some((r) => isCustomAgencyRole(r.id) && (r.tags?.length || 0) > 0);
});

const packHits = computed(() => {
  void agencyOverrideVersion.value;
  return AGENCY_TEAM_PACKS.map((p) => ({
    ...p,
    found: p.roleIds.filter((id) => allRoles.value.some((r) => r.id === id)).length,
    total: p.roleIds.length,
  }));
});

const divisionSelectOptions = computed(() =>
  AGENCY_DIVISIONS.map((d) => ({ value: d.id, label: d.name })),
);
const roleKindSelectOptions = computed(() =>
  Object.entries(ROLE_KIND_ZH).map(([value, label]) => ({ value, label })),
);
const brainSlotSelectOptions = computed(() =>
  Object.entries(BRAIN_SLOT_ZH).map(([value, label]) => ({ value, label })),
);

function applyPack(packId: string) {
  const pack = AGENCY_TEAM_PACKS.find((p) => p.id === packId);
  if (!pack) return;
  const first = pack.roleIds.find((id) => allRoles.value.some((r) => r.id === id));
  if (first) {
    selectedId.value = first;
    activeDivision.value = "all";
    kindFilter.value = "all";
    tagFilter.value = "all";
    const role = allRoles.value.find((r) => r.id === first);
    if (role) loadDraft(role);
  }
  saveHint.value = `已定位推荐班底「${pack.nameZh}」（${pack.roleIds.length} 岗）`;
}

watch([taxonomyTab, filterId], () => {
  tagFilter.value = "all";
});

function switchTaxonomyTab(tab: "industry" | "position") {
  taxonomyTab.value = tab;
  filterId.value = "all";
  activeDivision.value = "all";
}

watch(activeDivision, () => {
  if (tagFilter.value === "all") return;
  if (!availableTags.value.includes(tagFilter.value)) tagFilter.value = "all";
});

const selected = computed(
  () => allRoles.value.find((r) => r.id === selectedId.value) ?? filtered.value[0] ?? null,
);

const selectedIsCustom = computed(() => isCustomAgencyRole(selected.value?.id));

const dirty = computed(() => {
  if (!selected.value) return false;
  const tagsDirty =
    selectedIsCustom.value &&
    formatAgencyTagsInput(parseAgencyTagsInput(draftTags.value)) !==
      formatAgencyTagsInput(selected.value.tags);
  return (
    draftName.value !== selected.value.nameZh ||
    draftDesc.value !== selected.value.description ||
    draftPrompt.value !== selected.value.prompt ||
    draftRequirements.value !== (selected.value.roleRequirements || "") ||
    draftSkillMd.value !== (selected.value.roleSkillMd || "") ||
    tagsDirty
  );
});

const hasOverride = computed(() =>
  Boolean(selected.value && !selectedIsCustom.value && getAgencyRoleOverride(selected.value.id)),
);

function loadDraft(role: AgencyRole | null) {
  if (!role) {
    draftName.value = "";
    draftDesc.value = "";
    draftPrompt.value = "";
    draftRequirements.value = "";
    draftSkillMd.value = "";
    draftTags.value = "";
    return;
  }
  draftName.value = role.nameZh;
  draftDesc.value = role.description;
  draftTags.value = formatAgencyTagsInput(role.tags);
  draftPrompt.value = isCustomAgencyRole(role.id) ? role.prompt : "";
  draftRequirements.value = isCustomAgencyRole(role.id) ? role.roleRequirements || "" : "";
  draftSkillMd.value = isCustomAgencyRole(role.id) ? role.roleSkillMd || "" : "";
  saveHint.value = "";
}

function roleCapabilities(role: AgencyRole): string[] {
  const out: string[] = [];
  const kind = ROLE_KIND_ZH[role.roleKind] || role.roleKind;
  const slot = BRAIN_SLOT_ZH[role.brainSlot] || role.brainSlot;
  if (kind) out.push(`角色类型：${kind}`);
  if (slot) out.push(`脑槽：${slot}`);
  if (role.kickoffWave) out.push(`派活阶段：${kickoffWaveLabel(role.kickoffWave)}`);
  for (const t of role.tags || []) out.push(t);
  return out;
}

function pick(role: AgencyRole) {
  selectedId.value = role.id;
  loadDraft(role);
}

watch(
  selected,
  (r) => {
    loadDraft(r);
    void refreshRoleUserSkills();
  },
  { immediate: true },
);

async function refreshRoleUserSkills() {
  const role = selected.value;
  if (!role) {
    roleUserSkills.value = [];
    return;
  }
  try {
    const all = await scanUserSkills();
    roleUserSkills.value = all.filter((p) => skillAppliesTo(p.manifest, role.id, null) && p.manifest.roleId);
  } catch {
    roleUserSkills.value = [];
  }
}

async function importRoleSkill() {
  if (!selected.value) return;
  const path = await openFileDialog({
    multiple: false,
    filters: [{ name: "SKILL.md", extensions: ["md", "xucap", "json"] }],
    title: "导入本岗 SKILL.md（复制到本机技能目录，不上传）",
  });
  if (!path || typeof path !== "string") return;
  skillImportBusy.value = true;
  try {
    const row = await importUserSkillFile(path, { roleId: selected.value.id });
    saveHint.value = `已绑定本岗技能「${row.manifest.name}」（文档/虚募阁技能，卸载不删）`;
    fouMsg.success(saveHint.value);
    await refreshRoleUserSkills();
  } catch (e) {
    saveHint.value = toUserError(e);
    void onApiCatch(e, (m) => { saveHint.value = m });
  } finally {
    skillImportBusy.value = false;
  }
}

async function openUserSkillsFolder() {
  try {
    await openSkillsFolder();
  } catch (e) {
    void onApiCatch(e);
  }
}

function saveDraft() {
  if (!selected.value) return;
  try {
    if (selectedIsCustom.value) {
      updateCustomAgencyRole(selected.value.id, {
        nameZh: draftName.value,
        description: draftDesc.value,
        prompt: draftPrompt.value,
        roleRequirements: draftRequirements.value,
        roleSkillMd: draftSkillMd.value,
        tags: parseAgencyTagsInput(draftTags.value),
      });
      saveHint.value = "已保存自定义岗位";
    } else {
      saveAgencyRoleOverride(selected.value.id, {
        nameZh: draftName.value,
        description: draftDesc.value,
        prompt: draftPrompt.value,
      });
      saveHint.value = "已保存本地微调";
    }
  } catch (e) {
    saveHint.value = toUserError(e);
  }
}

function resetDraft() {
  if (!selected.value || selectedIsCustom.value) return;
  const r = resetAgencyRoleOverride(selected.value.id);
  loadDraft(r ?? null);
  saveHint.value = "已恢复目录默认";
}

function deleteCustom() {
  if (!selected.value || !selectedIsCustom.value) return;
  const id = selected.value.id;
  if (!window.confirm(`删除自定义岗位「${selected.value.nameZh}」？`)) return;
  removeCustomAgencyRole(id);
  selectedId.value = listAgencyRoles()[0]?.id ?? "";
  saveHint.value = "已删除自定义岗位";
}

function hireSelected() {
  if (!selected.value) return;
  void router.push({
    path: "/team",
    query: { hire: selected.value.id },
  });
}

function openCreate() {
  createError.value = "";
  createName.value = "";
  createDesc.value = "";
  createPrompt.value = "";
  createRequirements.value = "";
  createSkillMd.value = "";
  createTags.value = "";
  createKind.value = "worker";
  createSlot.value = "work";
  createDivision.value =
    activeDivision.value !== "all"
      ? activeDivision.value
      : AGENCY_DIVISIONS[0]?.id || "engineering";
  createOpen.value = true;
}

onMounted(() => {
  if (route.query.create === "1") {
    openCreate();
    void router.replace({ path: "/agency" });
  }
});

function exportLocal() {
  downloadAgencyLocalBundle(`xu-agency-local-${new Date().toISOString().slice(0, 10)}.json`);
  saveHint.value = "已导出本地微调与自定义岗位 JSON";
}

function triggerImport() {
  importInput.value?.click();
}

async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text) as unknown;
    if (!window.confirm(`合并导入「${file.name}」到本地微调与自定义岗位？`)) return;
    const r = importAgencyLocalBundle(data, "merge");
    saveHint.value = `已合并导入：微调 ${r.overrides} · 自定义 ${r.custom}`;
  } catch (e) {
    saveHint.value = toUserError(e);
  }
}

function submitCreate() {
  createError.value = "";
  try {
    const role = addCustomAgencyRole({
      nameZh: createName.value,
      description: createDesc.value,
      prompt: createPrompt.value,
      roleRequirements: createRequirements.value,
      roleSkillMd: createSkillMd.value,
      division: createDivision.value,
      roleKind: createKind.value,
      brainSlot: createSlot.value,
      tags: parseAgencyTagsInput(createTags.value),
    });
    createOpen.value = false;
    selectedId.value = role.id;
    activeDivision.value = role.division;
    loadDraft(role);
    saveHint.value = "已新建自定义岗位";
  } catch (e) {
    createError.value = toUserError(e);
  }
}

function appendDraftTag(tag: string) {
  const cur = parseAgencyTagsInput(draftTags.value);
  if (!cur.includes(tag)) cur.push(tag);
  draftTags.value = formatAgencyTagsInput(cur);
}

function appendCreateTag(tag: string) {
  const cur = parseAgencyTagsInput(createTags.value);
  if (!cur.includes(tag)) cur.push(tag);
  createTags.value = formatAgencyTagsInput(cur);
}
</script>

<template>
  <div class="vue-page agency-page">
    <header class="vue-page-header">
      <div>
        <h1 class="ui-font">岗位库</h1>
        <p class="ui-font muted">
          本地 {{ AGENCY_CATALOG_META.count }} 个岗位（岗位包人设只读）· 可新建自定义岗位
        </p>
      </div>
      <div class="agency-header-actions">
        <PageHelpButton topic="agency.roles" label="帮助" />
        <FouButton icon="add-line" type="primary" @click="openCreate">新建岗位</FouButton>
        <FouButton icon="upload-2-line" @click="importRoleSkill">导入本岗技能</FouButton>
        <FouButton icon="folder-open-line" @click="openUserSkillsFolder">技能文件夹</FouButton>
        <FouButton icon="user-add-line" @click="hireSelected">用此岗位入职</FouButton>
        <FouButton icon="group-line" @click="router.push('/office')">去办公室</FouButton>
      </div>
    </header>

    <RolePackCatalogBanner />

    <div class="agency-layout">
      <aside class="agency-side">
        <div class="agency-tax-tabs">
          <FouButton
            icon="building-line"
            size="small"
            native-type="button"
            :type="taxonomyTab === 'industry' ? 'primary' : 'default'"
            @click="switchTaxonomyTab('industry')"
          >
            按行业
          </FouButton>
          <FouButton
            icon="briefcase-line"
            size="small"
            native-type="button"
            :type="taxonomyTab === 'position' ? 'primary' : 'default'"
            @click="switchTaxonomyTab('position')"
          >
            按岗位
          </FouButton>
        </div>
        <AgencyTaxonomyTree v-model="filterId" :mode="taxonomyTab" />
      </aside>

      <section class="agency-main">
        <div class="agency-packs">
          <FouButton
            v-for="p in packHits"
            :key="p.id"
            icon="group-2-line"
            size="small"
            native-type="button"
            @click="applyPack(p.id)"
          >
            {{ p.nameZh }}（{{ p.found }}/{{ p.total }}）
          </FouButton>
        </div>
        <div class="agency-search">
          <FouInput v-model="query" clearable placeholder="中文搜索：岗位名、部门、描述、提示词…" />
        </div>
        <div class="agency-filters">
          <FouButton
            icon="filter-3-line"
            size="small"
            native-type="button"
            :type="kindFilter === 'all' ? 'primary' : 'default'"
            @click="kindFilter = 'all'"
          >
            全部类型
          </FouButton>
          <FouButton
            v-for="(label, key) in ROLE_KIND_ZH"
            :key="key"
            icon="user-star-line"
            size="small"
            native-type="button"
            :type="kindFilter === key ? 'primary' : 'default'"
            @click="kindFilter = key as AgencyRole['roleKind']"
          >
            {{ label }}
          </FouButton>
        </div>
        <div v-if="showTagFilter && availableTags.length" class="agency-filters agency-tags">
          <FouButton
            icon="price-tag-3-line"
            size="small"
            native-type="button"
            :type="tagFilter === 'all' ? 'primary' : 'default'"
            @click="tagFilter = 'all'"
          >
            全部标签
          </FouButton>
          <FouButton
            v-for="t in availableTags"
            :key="t"
            icon="bookmark-line"
            size="small"
            native-type="button"
            :type="tagFilter === t ? 'primary' : 'default'"
            @click="tagFilter = t"
          >
            {{ t }}
          </FouButton>
        </div>
        <div class="agency-list" role="list">
          <FouButton
            v-for="r in filtered"
            :key="r.id"
            class="agency-card ui-font"
            :class="{ on: selectedId === r.id }"
            icon="user-line"
            text
            native-type="button"
            @click="pick(r)"
          >
            <span class="agency-card-emoji" aria-hidden="true">{{ r.emoji || "👤" }}</span>
            <span class="agency-card-body">
              <span class="agency-card-title">
                {{ r.nameZh }}
                <span v-if="isCustomAgencyRole(r.id)" class="tag-mini">自定义</span>
              </span>
              <span class="agency-card-meta">
                {{ r.industryZh || r.divisionZh }} · {{ r.positionCategoryZh || r.positionZh || r.nameZh }}
                <template v-if="r.kickoffWave"> · {{ kickoffWaveLabel(r.kickoffWave) }}</template>
                <template v-if="r.tags?.length"> · {{ r.tags.slice(0, 2).join(" / ") }}</template>
              </span>
            </span>
          </FouButton>
          <p v-if="!filtered.length" class="muted empty">无匹配岗位，换个中文关键词试试</p>
        </div>
      </section>

      <aside v-if="selected" class="agency-detail">
        <div class="detail-head">
          <span class="detail-emoji">{{ selected.emoji || "👤" }}</span>
          <div>
            <h2 class="ui-font">{{ draftName || selected.nameZh }}</h2>
            <p class="agency-meta ui-font">
              {{ selected.industryZh || selected.divisionZh }} · {{ selected.positionCategoryZh || "—" }} ·
              {{ selected.positionZh || selected.nameZh }} ·
              {{ BRAIN_SLOT_ZH[selected.brainSlot] || selected.brainSlot }} ·
              {{ ROLE_KIND_ZH[selected.roleKind] || selected.roleKind }}
              <span v-if="selected.kickoffWave" class="tag">派活：{{ kickoffWaveLabel(selected.kickoffWave) }}</span>
              <span v-for="t in selected.tags || []" :key="t" class="tag">{{ t }}</span>
              <span v-if="hasOverride" class="tag">已微调</span>
              <span v-if="selectedIsCustom" class="tag">自定义</span>
            </p>
          </div>
        </div>

        <template v-if="selectedIsCustom">
          <label class="field ui-font">
            <span>岗位名称（中文）</span>
            <FouInput v-model="draftName" maxlength="40" />
          </label>
          <label class="field ui-font">
            <span>简介</span>
            <textarea v-model="draftDesc" class="agency-textarea" rows="3" />
          </label>
          <label class="field ui-font">
            <span>标签（逗号分隔，可点选）</span>
            <FouInput v-model="draftTags" clearable placeholder="例如：法务合规，智能体平台" />
            <div class="tag-suggest">
              <FouButton
                v-for="t in catalogTags.slice(0, 12)"
                :key="t"
                icon="add-line"
                size="small"
                native-type="button"
                @click="appendDraftTag(t)"
              >
                {{ t }}
              </FouButton>
            </div>
          </label>
          <label class="field ui-font">
            <span>人设提示词</span>
            <textarea v-model="draftPrompt" class="agency-textarea" rows="6" placeholder="自定义岗位的人设与职责说明" />
          </label>
          <label class="field ui-font">
            <span>本岗需求说明</span>
            <textarea
              v-model="draftRequirements"
              class="agency-textarea"
              rows="4"
              placeholder="该岗位常接什么需求、边界、交付物（派活时注入）"
            />
          </label>
          <label class="field ui-font">
            <span>岗位 Skill（Markdown）</span>
            <textarea
              v-model="draftSkillMd"
              class="agency-textarea"
              rows="8"
              placeholder="等同项目 Skill：何时用、步骤、输出格式、XU_ACCEPTANCE_REPORT 要求"
            />
          </label>
        </template>
        <template v-else>
          <div class="field ui-font">
            <span class="field-label">岗位名称</span>
            <p class="field-readonly">{{ selected.nameZh }}</p>
          </div>
          <div class="field ui-font">
            <span class="field-label">简介</span>
            <p class="field-readonly desc">{{ selected.description || "—" }}</p>
          </div>
          <div class="field ui-font">
            <span class="field-label">功能职责</span>
            <ul v-if="roleCapabilities(selected).length" class="cap-list">
              <li v-for="(c, i) in roleCapabilities(selected)" :key="i">{{ c }}</li>
            </ul>
            <p v-else class="field-readonly muted">—</p>
          </div>
        </template>

        <div class="field ui-font">
          <span class="field-label">本机技能（卸载不删）</span>
          <p class="field-readonly muted">
            导入的 SKILL.md 复制到「文档/虚募阁技能」，只在本机运行、不上传。目录岗与自定义岗均可绑定。
          </p>
          <ul v-if="roleUserSkills.length" class="cap-list">
            <li v-for="s in roleUserSkills" :key="s.manifest.id">
              {{ s.manifest.name }}{{ s.enabled ? "" : "（已禁用）" }}
            </li>
          </ul>
          <p v-else class="field-readonly muted">尚未绑定本岗技能</p>
          <div class="detail-actions" style="margin-top: 8px">
            <FouButton
              icon="upload-2-line"
              size="small"
              :loading="skillImportBusy"
              @click="importRoleSkill"
            >
              导入 SKILL.md
            </FouButton>
            <FouButton icon="folder-open-line" size="small" @click="openUserSkillsFolder">
              打开文件夹
            </FouButton>
          </div>
        </div>

        <div class="detail-actions">
          <FouButton
            v-if="selectedIsCustom"
            icon="save-line"
            type="primary"
            :disabled="!dirty"
            @click="saveDraft"
          >
            保存岗位
          </FouButton>
          <FouButton
            v-if="selectedIsCustom"
            icon="delete-bin-line"
            @click="deleteCustom"
          >
            删除
          </FouButton>
          <FouButton icon="user-add-line" @click="hireSelected">入职</FouButton>
        </div>
        <p v-if="saveHint" class="muted tip">{{ saveHint }}</p>
      </aside>
    </div>

    <FouDialog v-model="createOpen" title="新建自定义岗位" width="520px" append-to-body>
      <div class="create-form ui-font">
        <label class="field">
          <span>岗位名称*</span>
          <FouInput v-model="createName" maxlength="40" placeholder="例如：驻场实施顾问" />
        </label>
        <label class="field">
          <span>分类（属性）*</span>
          <FouSelect v-model="createDivision" :options="divisionSelectOptions" placeholder="选择分类" />
        </label>
        <div class="create-row">
          <label class="field">
            <span>角色类型</span>
            <FouSelect v-model="createKind" :options="roleKindSelectOptions" />
          </label>
          <label class="field">
            <span>脑槽</span>
            <FouSelect v-model="createSlot" :options="brainSlotSelectOptions" />
          </label>
        </div>
        <label class="field">
          <span>简介</span>
          <textarea v-model="createDesc" class="agency-textarea" rows="2" />
        </label>
        <label class="field">
          <span>标签（可选，逗号分隔）</span>
          <FouInput v-model="createTags" clearable placeholder="例如：客户成功，销售售前" />
          <div v-if="catalogTags.length" class="tag-suggest">
            <FouButton
              v-for="t in catalogTags.slice(0, 10)"
              :key="t"
              icon="add-line"
              size="small"
              native-type="button"
              @click="appendCreateTag(t)"
            >
              {{ t }}
            </FouButton>
          </div>
        </label>
        <label class="field">
          <span>人设提示词</span>
          <textarea v-model="createPrompt" class="agency-textarea" rows="3" placeholder="可空，将自动生成默认人设" />
        </label>
        <label class="field">
          <span>本岗需求说明</span>
          <textarea
            v-model="createRequirements"
            class="agency-textarea"
            rows="3"
            placeholder="该岗位负责什么、不接什么"
          />
        </label>
        <label class="field">
          <span>岗位 Skill（Markdown）</span>
          <textarea
            v-model="createSkillMd"
            class="agency-textarea"
            rows="5"
            placeholder="工作流程、工具约束、验收自报格式"
          />
        </label>
        <p v-if="createError" class="create-err">{{ createError }}</p>
      </div>
      <template #footer>
        <FouButton icon="close-line" @click="createOpen = false">取消</FouButton>
        <FouButton icon="check-line" type="primary" @click="submitCreate">创建</FouButton>
      </template>
    </FouDialog>
  </div>
</template>

<style scoped>
.agency-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.agency-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.agency-import-input {
  display: none;
}
.agency-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) minmax(320px, 400px);
  gap: 14px;
  padding: 0 16px 16px;
}
.agency-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid var(--hairline);
  background: color-mix(in srgb, var(--surface-card) 92%, transparent);
}
.agency-tax-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
  flex-shrink: 0;
  padding: 4px;
  border-radius: 10px;
  background: var(--surface-soft);
  border: 1px solid var(--hairline);
}
.agency-tax-tabs :deep(.fou-button) {
  flex: 1;
  border-radius: 8px !important;
}
.agency-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
}
.agency-search :deep(.fou-input),
.agency-search :deep(input) {
  width: 100%;
}
.agency-packs,
.agency-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.tag-suggest {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.agency-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-content: start;
  padding: 4px;
}
.agency-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  text-align: left;
  border: 1px solid var(--hairline);
  border-radius: 14px;
  padding: 14px 16px;
  background: var(--surface-card);
  cursor: pointer;
  min-height: 104px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.agency-card :deep(.fou-button__label) {
  display: contents;
}
.agency-card :deep(.fou-button__icon) {
  display: none;
}
.agency-card:hover {
  border-color: color-mix(in srgb, var(--primary) 55%, var(--hairline));
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}
.agency-card.on {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, var(--surface-card));
}
.agency-card-emoji {
  font-size: 28px;
  line-height: 1;
  flex-shrink: 0;
}
.agency-card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.agency-card-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--ink);
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  word-break: break-word;
}
.agency-card-meta {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.4;
  word-break: break-word;
}
.tag-mini {
  margin-left: 4px;
  font-size: 10px;
  font-weight: 500;
  color: var(--primary);
}
.agency-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--hairline);
  border-radius: 14px;
  padding: 16px;
  background: var(--surface-card);
  overflow: auto;
}
.detail-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.detail-emoji {
  font-size: 36px;
  line-height: 1;
}
.agency-detail h2 {
  margin: 0 0 4px;
  font-size: 18px;
}
.agency-meta {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
  word-break: break-word;
}
.tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 18%, transparent);
  color: var(--primary);
  font-size: 11px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.agency-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--surface-soft);
  color: var(--ink);
  font: inherit;
  line-height: 1.5;
  resize: vertical;
}
.agency-textarea.prompt {
  min-height: 220px;
  font-size: 12.5px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.field-label {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.field-readonly {
  margin: 0;
  font-size: 14px;
  color: var(--body-strong);
  line-height: 1.5;
}
.field-readonly.desc {
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
  word-break: break-word;
}
.cap-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--body);
  line-height: 1.55;
  max-height: 200px;
  overflow-y: auto;
  word-break: break-word;
}
.tip {
  margin: 0;
  font-size: 12px;
}
.empty {
  grid-column: 1 / -1;
  padding: 24px;
  text-align: center;
}
.muted {
  color: var(--muted);
}
.create-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.create-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.create-err {
  margin: 0;
  color: var(--error, #dc2626);
  font-size: 13px;
}
@media (max-width: 1100px) {
  .agency-layout {
    grid-template-columns: 160px minmax(0, 1fr);
  }
  .agency-detail {
    grid-column: 1 / -1;
    max-height: 42vh;
  }
}
@media (max-width: 720px) {
  .agency-layout {
    grid-template-columns: 1fr;
  }
}
</style>
