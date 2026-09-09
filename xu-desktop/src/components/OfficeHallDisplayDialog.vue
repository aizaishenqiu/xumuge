<script setup lang="ts">
/**
 * @file OfficeHallDisplayDialog.vue 办公室 3D 大厅品牌墙 / 屏风文案设置
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @version 1.0.0
 * @category UI
 * @algo form-localStorage
 */
import { ref, watch } from "vue";
import { FouButton, fouAlert } from "foucui";
import {
  readOfficeHallDisplay,
  resetOfficeHallDisplay,
  writeOfficeHallDisplay,
  type OfficeHallDisplay,
} from "../utils/officeHallDisplay";

const open = defineModel<boolean>("open", { default: false });

const draft = ref<OfficeHallDisplay>(readOfficeHallDisplay());
const logoPreview = ref("");

function syncDraft() {
  draft.value = readOfficeHallDisplay();
  logoPreview.value = draft.value.logoDataUrl || "/icon.png";
}

watch(open, (v) => {
  if (v) syncDraft();
});

/** 选择本地图片作为大厅 Logo */
function onLogoPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    void fouAlert("请选择图片文件。", "Logo");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    void fouAlert("图片请小于 2MB。", "Logo");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result || "");
    draft.value.logoDataUrl = url;
    logoPreview.value = url;
  };
  reader.onerror = () => {
    void fouAlert("读取图片失败。", "Logo");
  };
  reader.readAsDataURL(file);
  input.value = "";
}

/** 清除自定义 Logo，恢复默认 icon */
function clearLogo() {
  draft.value.logoDataUrl = "";
  logoPreview.value = "/icon.png";
}

/** 保存并刷新 3D 大厅贴图 */
function save() {
  writeOfficeHallDisplay(draft.value);
  open.value = false;
}

/** 恢复全部默认文案 */
function restoreDefaults() {
  resetOfficeHallDisplay();
  syncDraft();
}
</script>

<template>
  <FouDialog
    v-model="open"
    title="大厅品牌与屏风"
    width="520px"
    append-to-body
    destroy-on-close
  >
    <p class="hall-dlg-hint ui-font">
      修改后即时更新远墙大屏与前台屏风；Logo 建议方形 PNG/JPG。
    </p>

    <div class="hall-dlg-logo">
      <img class="hall-dlg-logo-img" :src="logoPreview" alt="" />
      <div class="hall-dlg-logo-actions">
        <label class="hall-dlg-upload ui-font">
          <input type="file" accept="image/*" hidden @change="onLogoPick" />
          <span class="hall-dlg-upload-btn">
            <i class="ri-image-add-line" aria-hidden="true" />
            上传 Logo
          </span>
        </label>
        <FouButton icon="delete-bin-line" size="small" native-type="button" @click="clearLogo">
          恢复默认
        </FouButton>
      </div>
    </div>

    <div class="hall-dlg-grid ui-font">
      <label>
        <span>品牌英文名</span>
        <input v-model="draft.brandName" type="text" maxlength="32" placeholder="VIRMOOR" />
      </label>
      <label>
        <span>主标题</span>
        <input v-model="draft.mainTitle" type="text" maxlength="48" placeholder="虚募阁AI公司" />
      </label>
      <label class="span-2">
        <span>副标题</span>
        <input v-model="draft.subtitle" type="text" maxlength="64" placeholder="问询 · 计划 · 智能体" />
      </label>
      <label>
        <span>屏风主标语</span>
        <input v-model="draft.foldingTitle" type="text" maxlength="48" placeholder="虚募阁科技" />
      </label>
      <label>
        <span>屏风副标语</span>
        <input v-model="draft.foldingSubtitle" type="text" maxlength="48" placeholder="-- AI前沿站" />
      </label>
      <label class="span-2">
        <span>角标 HUD</span>
        <input v-model="draft.hudLabel" type="text" maxlength="48" placeholder="VIRMOOR // OFFICE" />
      </label>
      <label>
        <span>芯片 · 问询</span>
        <input v-model="draft.chipAsk" type="text" maxlength="16" />
      </label>
      <label>
        <span>芯片 · 计划</span>
        <input v-model="draft.chipPlan" type="text" maxlength="16" />
      </label>
      <label>
        <span>芯片 · 智能体</span>
        <input v-model="draft.chipAgent" type="text" maxlength="16" />
      </label>
      <label>
        <span>芯片 · 待批</span>
        <input v-model="draft.chipApprove" type="text" maxlength="16" />
      </label>
    </div>

    <template #footer>
      <FouButton icon="restart-line" native-type="button" @click="restoreDefaults">
        恢复默认
      </FouButton>
      <FouButton icon="close-line" native-type="button" @click="open = false">
        取消
      </FouButton>
      <FouButton icon="save-line" type="primary" native-type="button" @click="save">
        保存
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.hall-dlg-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted, #64748b);
}
.hall-dlg-logo {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}
.hall-dlg-logo-img {
  width: 72px;
  height: 72px;
  border-radius: 14px;
  object-fit: cover;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #0a0a0a;
}
.hall-dlg-logo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.hall-dlg-upload {
  display: inline-flex;
  cursor: pointer;
}
.hall-dlg-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--fou-border-color, #e2e8f0);
  font-size: 13px;
  background: var(--fou-fill-color-light, #f8fafc);
}
.hall-dlg-upload-btn:hover {
  border-color: var(--primary, #0f766e);
}
.hall-dlg-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}
.hall-dlg-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.hall-dlg-grid label.span-2 {
  grid-column: 1 / -1;
}
.hall-dlg-grid input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--fou-border-color, #e2e8f0);
  font-size: 13px;
}
</style>
