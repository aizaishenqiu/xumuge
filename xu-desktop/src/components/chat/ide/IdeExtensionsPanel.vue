/**
 * @file IdeExtensionsPanel.vue IDE 扩展与检查面板
 * @author qiuye <yjk150@qq.com/>
 * @date 2026-08-31
 * @updated 2026-09-07
 * @version 1.1.0
 * @category Layout
 * @algo eslint-and-typescript-detect
 */
<script setup lang="ts">
import { onApiCatch } from "../../../utils/userFacingError";
import { FouButton, fouAlert } from "foucui";
import { invoke } from "@tauri-apps/api/core";
import { onMounted, ref, watch } from "vue";
import { readIdeCliOverride } from "../../../utils/ideCli";
import { openIdeSettingsTab } from "../../../utils/ideSpecialTabs";
import { detectEslintInfo, type EslintInfo } from "../../../utils/workspaceLint";
import { detectTypescriptInfo, type TypescriptInfo } from "../../../utils/tsLanguageService";

const props = defineProps<{
  workingDir: string | null;
}>();

const eslintInfo = ref<EslintInfo | null>(null);
const tsInfo = ref<TypescriptInfo | null>(null);
const loading = ref(false);

async function refresh() {
  const ws = props.workingDir?.trim();
  if (!ws) {
    eslintInfo.value = null;
    tsInfo.value = null;
    return;
  }
  loading.value = true;
  try {
    const [e, t] = await Promise.all([
      detectEslintInfo(ws),
      detectTypescriptInfo(ws).catch(() => ({ installed: false, version: null })),
    ]);
    eslintInfo.value = e;
    tsInfo.value = t;
  } catch {
    eslintInfo.value = { installed: false, hasConfig: false, plugins: [] };
    tsInfo.value = { installed: false, version: null };
  } finally {
    loading.value = false;
  }
}

function openSettings() {
  openIdeSettingsTab("plugins");
}

async function openWorkspaceInIde() {
  const ws = props.workingDir?.trim();
  if (!ws) {
    void fouAlert("请先选择工作目录", "提示");
    return;
  }
  try {
    await invoke("open_with_editor", {
      path: ws,
      editor: readIdeCliOverride() || "cursor",
    });
  } catch (e) {
    void onApiCatch(e);
  }
}

onMounted(() => void refresh());
watch(() => props.workingDir, () => void refresh());
</script>

<template>
  <div class="ide-ext-panel ui-font">
    <header class="panel-head">
      <span class="panel-title">扩展与检查</span>
      <FouButton
        icon="refresh-line"
        size="small"
        text
        native-type="button"
        :loading="loading"
        aria-label="刷新"
        @click="refresh"
      />
    </header>
    <div class="ext-card">
      <h3>TypeScript</h3>
      <p v-if="!workingDir" class="muted">请先选择工作目录</p>
      <template v-else-if="tsInfo">
        <p>
          <FouIcon :icon="tsInfo.installed ? 'checkbox-circle-line' : 'close-circle-line'" size="14" />
          {{ tsInfo.installed ? "已安装" : "未安装" }}
          <template v-if="tsInfo.version"> · {{ tsInfo.version }}</template>
        </p>
        <p class="hint muted">
          内置 IDE 对 <strong>.ts / .tsx / .js / .jsx</strong> 提供类型诊断、悬停与跳转定义（依赖工作区
          typescript）。未安装时请在终端执行：pnpm add -D typescript。
        </p>
      </template>
    </div>
    <div class="ext-card">
      <h3>ESLint</h3>
      <p v-if="!workingDir" class="muted">请先选择工作目录</p>
      <template v-else-if="eslintInfo">
        <p>
          <FouIcon :icon="eslintInfo.installed ? 'checkbox-circle-line' : 'close-circle-line'" size="14" />
          {{ eslintInfo.installed ? "已安装" : "未安装" }}
          ·
          {{ eslintInfo.hasConfig ? "有配置" : "无配置" }}
        </p>
        <p v-if="eslintInfo.plugins.length" class="plugins">
          插件：{{ eslintInfo.plugins.join(", ") }}
        </p>
        <p class="hint muted">
          支持工作区 npm 安装的 ESLint。Markdown 预览与语法高亮已内置。
          <strong>不支持</strong> 安装 VS Code / Cursor 市场 .vsix；Python / Go / Rust 等完整语言服务与调试请点「在外部 IDE 打开」。
        </p>
      </template>
      <div class="ext-actions">
        <FouButton icon="settings-3-line" size="small" native-type="button" @click="openSettings">
          打开设置
        </FouButton>
        <FouButton
          icon="code-box-line"
          size="small"
          native-type="button"
          :disabled="!workingDir"
          @click="openWorkspaceInIde"
        >
          在外部 IDE 打开
        </FouButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ide-ext-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
  border-bottom: 1px solid var(--hairline);
}
.panel-title {
  font-size: 12px;
  font-weight: 600;
}
.ext-card {
  padding: 12px;
  border-bottom: 1px solid var(--hairline);
}
.ext-card h3 {
  margin: 0 0 8px;
  font-size: 13px;
}
.ext-card p {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.45;
}
.muted {
  color: var(--muted);
}
.hint {
  margin-top: 8px !important;
}
.plugins {
  word-break: break-all;
}
.ext-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
</style>
