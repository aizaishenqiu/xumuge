<!--
  @file CosyVoice 本地管理控制台（Vue 原生，Rust invoke 替代 manager.py）
  @author qiuye <yjk150@qq.com>
  @date 2026-09-01
  @updated 2026-09-03
  @version 1.2.0
  @category UI
  @algo native-cosy-console
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  FouButton,
  FouInput,
  FouSelect,
  fouAlert as showFouAlert,
  fouMsg,
} from "foucui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  cosyConsoleDeleteVoice,
  cosyConsoleEnv,
  cosyConsoleLog,
  cosyConsoleModels,
  cosyConsoleProbe,
  cosyConsoleRestart,
  cosyConsoleSaveVoice,
  cosyConsoleStart,
  cosyConsoleStatus,
  cosyConsoleStop,
  type CosyConsoleEnv,
  type CosyConsoleStatus,
} from "../utils/cosyConsoleApi";
import { setCosyWantRunning } from "../utils/cosyFastapiSidecarApi";
import { loadVoiceSettings, saveVoiceSettings } from "../stores/voiceSettings";
import { scanCosyFastapiVoices, type CosyFastapiVoicePreset } from "../utils/cosyFastapiVoices";
import { ensureSystemCosyVoices, labelForSystemVoiceId } from "../utils/cosySystemVoices";
import { synthesizeFastapiPcm, pcm16ToWavBlob, createCosyFastapiPlayer } from "../utils/cosyFastapiClient";
import { resolveCosyVoiceToneParams } from "../utils/voiceToneEngineMap";
import { toUserError, sanitizeUserDisplayText } from "../utils/userFacingError";

const BASE_KEY = "xu.cosy.console.baseUrl";

const tab = ref<"test" | "voices" | "speak" | "ops">("ops");
const baseUrl = ref(localStorage.getItem(BASE_KEY) || "http://127.0.0.1:50000");
const port = ref(50000);
const selectedModel = ref("");
const env = ref<CosyConsoleEnv | null>(null);
const status = ref<CosyConsoleStatus | null>(null);
const logLines = ref<string[]>([]);
const voices = ref<CosyFastapiVoicePreset[]>([]);
const busy = ref(false);
const probeBusy = ref(false);
const probeHint = ref("");
const settings = ref(loadVoiceSettings());

function needsReferenceWav(modelName?: string): boolean {
  const m = modelName || selectedModel.value || "";
  return (
    Boolean(settings.value.cosyVoice2 || env.value?.cosyVoice2) ||
    /CosyVoice[23]|Fun-CosyVoice/i.test(m)
  );
}

function resolveModelDir(): string {
  const name = selectedModel.value.trim();
  if (name && env.value?.modelRoot) {
    const root = env.value.modelRoot.replace(/\\/g, "/").replace(/\/$/, "");
    const base = name.replace(/\\/g, "/").split("/").pop() || name;
    return `${root}/${base}`;
  }
  return settings.value.cosyModelDir || "";
}

function resolveFallbackWav(): string {
  return env.value?.defaultPromptWav || settings.value.cosyDefaultPromptWav || "";
}

function resolveFallbackText(): string {
  return env.value?.defaultPromptText || settings.value.cosyDefaultPromptText || "";
}

const newVoice = ref({
  id: "",
  name: "",
  promptText: "",
  instruct: "",
  wavPath: "",
});

const testText = ref("你好，这是 CosyVoice 接口测试。");
const testInstruct = ref("");
const testVoiceId = ref("");
const speakText = ref("你好，虚募阁 CosyVoice 实时播报。");
const testBusy = ref(false);
const speakBusy = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let player: ReturnType<typeof createCosyFastapiPlayer> | null = null;

const modelOptions = computed(() =>
  (status.value?.models ?? []).map((m) => ({ label: m, value: m })),
);

const voiceOptions = computed(() =>
  voices.value.map((v) => ({
    label: v.id.startsWith("sys-") ? labelForSystemVoiceId(v.id) : v.name || v.id,
    value: v.id,
  })),
);

const seedHint = ref("");
const seedBusy = ref(false);

const statusPill = computed(() => {
  if (!status.value) return { text: "读取中…", cls: "wait" };
  if (status.value.healthy) return { text: `在线 · ${status.value.probe.latencyMs ?? "?"}ms`, cls: "ok" };
  if (status.value.running) return { text: "进程在跑 · API 未就绪", cls: "wait" };
  return { text: "未运行", cls: "err" };
});

const recentLogSummary = computed(() => {
  if (!logLines.value.length) return "暂无运行记录";
  const lines = logLines.value
    .slice(-6)
    .map((line) => sanitizeUserDisplayText(line, ""))
    .filter(Boolean);
  return lines.length ? lines.join("\n") : "服务运行中";
});

function saveBaseUrl() {
  localStorage.setItem(BASE_KEY, baseUrl.value.trim());
  saveVoiceSettings({ ...settings.value, cosyFastapiBaseUrl: baseUrl.value.trim() });
  fouMsg.success("已保存服务地址");
}

async function refreshAll() {
  try {
    settings.value = loadVoiceSettings();
    env.value = await cosyConsoleEnv();
    const models = await cosyConsoleModels();
    status.value = await cosyConsoleStatus(baseUrl.value, port.value);
    const runningLeaf = (status.value?.model || "").replace(/\\/g, "/").split("/").pop() || "";
    const savedLeaf = (settings.value.cosyModelDir || "").replace(/\\/g, "/").split("/").pop() || "";
    // 证据：下拉停在 CosyVoice2，实际在跑 Fun-CosyVoice3 → 用户以为「启不动/模型错」
    if (runningLeaf && models.includes(runningLeaf)) {
      selectedModel.value = runningLeaf;
    } else if (!selectedModel.value && models.length) {
      selectedModel.value =
        models.find((m) => m === savedLeaf) ||
        models.find((m) => /CosyVoice3|Fun-CosyVoice/i.test(m)) ||
        models.find((m) => /CosyVoice2/i.test(m)) ||
        models[0]!;
    }
    await refreshLogOnly();
    // 把 discover 到的参考音/音色库写回设置，便于入库
    if (env.value?.defaultPromptWav || env.value?.voicesRoot || status.value?.healthy) {
      const modelDir = resolveModelDir() || settings.value.cosyModelDir;
      settings.value = saveVoiceSettings({
        ...settings.value,
        cosyDefaultPromptWav:
          env.value?.defaultPromptWav || settings.value.cosyDefaultPromptWav,
        cosyDefaultPromptText:
          env.value?.defaultPromptText || settings.value.cosyDefaultPromptText,
        cosyVoicesRoot: env.value?.voicesRoot || settings.value.cosyVoicesRoot,
        cosyVoice2: env.value?.cosyVoice2 ?? settings.value.cosyVoice2,
        cosyFastapiBaseUrl: baseUrl.value.trim() || settings.value.cosyFastapiBaseUrl,
        ...(status.value?.healthy
          ? {
              provider: "cosyvoice" as const,
              cosyBackend: "fastapi" as const,
              cosyWantRunning: true,
              ...(modelDir ? { cosyModelDir: modelDir } : {}),
            }
          : {}),
      });
    }
    await seedSystemVoices(true);
  } catch (e) {
    await showFouAlert(toUserError(e), "控制台刷新失败");
  }
}

/**
 * 写入萝莉/御姐/夹子等系统音色到音色库（用户不必训练）。
 * silent=true 时失败不弹窗。
 */
async function seedSystemVoices(silent: boolean) {
  seedBusy.value = true;
  try {
    const rootHint = env.value?.voicesRoot || settings.value.cosyVoicesRoot;
    const wavHint = env.value?.defaultPromptWav || settings.value.cosyDefaultPromptWav;
    const result = await ensureSystemCosyVoices({
      voicesRoot: rootHint,
      defaultPromptWav: wavHint,
      defaultPromptText: env.value?.defaultPromptText || settings.value.cosyDefaultPromptText,
      persistRoot: true,
    });
    settings.value = loadVoiceSettings();
    const root = result.voicesRoot || settings.value.cosyVoicesRoot;
    if (root?.trim()) {
      const all = await scanCosyFastapiVoices(root);
      voices.value = [
        ...all.filter((v) => v.id.startsWith("sys-")),
        ...all.filter((v) => !v.id.startsWith("sys-")),
      ];
      if (!testVoiceId.value && voices.value.length) {
        const prefer =
          voices.value.find((v) => v.id === settings.value.voice) ||
          voices.value.find((v) => v.id.startsWith("sys-")) ||
          voices.value[0]!;
        testVoiceId.value = prefer.id;
      }
    }
    const n = result.created.length;
    seedHint.value =
      n > 0
        ? `已写入 ${n} 个系统音色（另跳过已有 ${result.skipped.length}）`
        : `系统音色已齐（${result.skipped.length} 个），库：${root || "—"}`;
    if (!silent && n > 0) fouMsg.success(seedHint.value);
  } catch (e) {
    seedHint.value = toUserError(e);
    if (!silent) {
      await showFouAlert(seedHint.value, "系统音色入库失败");
    }
  } finally {
    seedBusy.value = false;
  }
}

async function refreshLogOnly() {
  try {
    logLines.value = await cosyConsoleLog(80);
  } catch {
    logLines.value = ["（日志读取失败，可能含非 UTF-8 字符）"];
  }
}

async function runProbe() {
  probeBusy.value = true;
  try {
    const p = await cosyConsoleProbe(baseUrl.value);
    probeHint.value = p.message;
    if (p.ok) fouMsg.success(`连接正常 ${p.latencyMs ?? ""}ms`);
    else await showFouAlert(p.message, "连接失败");
  } catch (e) {
    await showFouAlert(toUserError(e), "探测失败");
  } finally {
    probeBusy.value = false;
  }
}

async function runStart() {
  const py = env.value?.python || settings.value.cosyPython;
  const srv = env.value?.serverScript || settings.value.cosyServerScript;
  if (!py || !srv) {
    await showFouAlert("请先在设置页自动检测 CosyVoice 路径。", "无法启动");
    return;
  }
  // 已在线：勿再点「启动」杀进程重拉，只同步默认引擎
  if (status.value?.healthy) {
    const modelDir = resolveModelDir() || settings.value.cosyModelDir;
    settings.value = saveVoiceSettings({
      ...settings.value,
      provider: "cosyvoice",
      cosyBackend: "fastapi",
      cosyWantRunning: true,
      cosyFastapiBaseUrl: baseUrl.value.trim() || settings.value.cosyFastapiBaseUrl,
      ...(modelDir ? { cosyModelDir: modelDir } : {}),
    });
    fouMsg.success("服务已在运行，已设为默认语音引擎");
    const { warmCosyFastapiQuiet } = await import("../utils/cosyFastapiWarm");
    void warmCosyFastapiQuiet({ force: true });
    return;
  }
  busy.value = true;
  try {
    const st = await cosyConsoleStart({
      python: py,
      serverScript: srv,
      model: selectedModel.value || settings.value.cosyModelDir,
      port: port.value,
      extraArgs: settings.value.cosyExtraArgs,
    });
    if (st.running) {
      const modelDir = resolveModelDir() || selectedModel.value || settings.value.cosyModelDir;
      settings.value = saveVoiceSettings({
        ...settings.value,
        provider: "cosyvoice",
        cosyBackend: "fastapi",
        cosyWantRunning: true,
        cosyFastapiBaseUrl: baseUrl.value.trim() || settings.value.cosyFastapiBaseUrl,
        ...(modelDir ? { cosyModelDir: modelDir } : {}),
      });
      try {
        await setCosyWantRunning({
          want: true,
          python: py,
          serverScript: srv,
          model: modelDir,
          port: port.value,
          extraArgs: settings.value.cosyExtraArgs,
        });
      } catch {
        // ignore
      }
    }
    fouMsg.success("已启动 sidecar");
    const { warmCosyFastapiQuiet } = await import("../utils/cosyFastapiWarm");
    void warmCosyFastapiQuiet({ force: true });
    await refreshAll();
  } catch (e) {
    await showFouAlert(toUserError(e), "启动失败");
  } finally {
    busy.value = false;
  }
}

async function runStop() {
  busy.value = true;
  try {
    await cosyConsoleStop();
    settings.value = saveVoiceSettings({ ...settings.value, cosyWantRunning: false });
    try {
      await setCosyWantRunning({ want: false });
    } catch {
      // ignore
    }
    fouMsg.success("已停止");
    await refreshAll();
  } catch (e) {
    await showFouAlert(toUserError(e), "停止失败");
  } finally {
    busy.value = false;
  }
}

async function runRestart() {
  const py = env.value?.python || settings.value.cosyPython;
  const srv = env.value?.serverScript || settings.value.cosyServerScript;
  if (!py || !srv) return;
  busy.value = true;
  try {
    const st = await cosyConsoleRestart({
      python: py,
      serverScript: srv,
      model: selectedModel.value,
      port: port.value,
      extraArgs: settings.value.cosyExtraArgs,
    });
    if (st.running) {
      settings.value = saveVoiceSettings({ ...settings.value, cosyWantRunning: true });
      try {
        await setCosyWantRunning({
          want: true,
          python: py,
          serverScript: srv,
          model: selectedModel.value || settings.value.cosyModelDir,
          port: port.value,
          extraArgs: settings.value.cosyExtraArgs,
        });
      } catch {
        // ignore
      }
    }
    fouMsg.success("已重启");
    await refreshAll();
  } catch (e) {
    await showFouAlert(toUserError(e), "重启失败");
  } finally {
    busy.value = false;
  }
}

async function pickRefWav() {
  const picked = await openFileDialog({
    multiple: false,
    filters: [{ name: "WAV", extensions: ["wav"] }],
    title: "选择参考音频",
  });
  if (picked && !Array.isArray(picked)) {
    newVoice.value.wavPath = String(picked);
  }
}

async function saveVoice() {
  let root = env.value?.voicesRoot || settings.value.cosyVoicesRoot;
  if (!root?.trim()) {
    try {
      const { defaultCosyVoicesRoot } = await import("../utils/cosySystemVoices");
      root = await defaultCosyVoicesRoot();
      settings.value = saveVoiceSettings({ ...settings.value, cosyVoicesRoot: root });
    } catch {
      await showFouAlert("未配置音色库目录，且无法创建默认库。", "无法保存");
      return;
    }
  }
  const id = newVoice.value.id.trim() || newVoice.value.name.trim().replace(/\s+/g, "_");
  if (!id || !newVoice.value.wavPath) {
    await showFouAlert("请填写名称并选择参考音频。", "无法保存");
    return;
  }
  busy.value = true;
  try {
    await cosyConsoleSaveVoice({
      voicesRoot: root,
      id,
      name: newVoice.value.name || id,
      promptText: newVoice.value.promptText,
      instruct: newVoice.value.instruct,
      wavPath: newVoice.value.wavPath,
    });
    fouMsg.success("音色已保存");
    newVoice.value = { id: "", name: "", promptText: "", instruct: "", wavPath: "" };
    await refreshAll();
  } catch (e) {
    await showFouAlert(toUserError(e), "保存失败");
  } finally {
    busy.value = false;
  }
}

async function deleteVoice(id: string) {
  const root = env.value?.voicesRoot || settings.value.cosyVoicesRoot;
  if (!root) return;
  busy.value = true;
  try {
    await cosyConsoleDeleteVoice(root, id);
    await refreshAll();
  } catch (e) {
    await showFouAlert(toUserError(e), "删除失败");
  } finally {
    busy.value = false;
  }
}

async function runApiTest() {
  testBusy.value = true;
  try {
    const preset = voices.value.find((v) => v.id === testVoiceId.value);
    const mapped = resolveCosyVoiceToneParams(settings.value.toneId);
    const instruct = (testInstruct.value || mapped.instruct || "").trim();
    const { pcm, sampleRate } = await synthesizeFastapiPcm({
      baseUrl: baseUrl.value,
      text: testText.value,
      promptWavPath: preset?.sampleWav,
      promptText: preset?.promptText,
      instruct,
      spkId: needsReferenceWav() ? "" : settings.value.cosyFastapiSpkId || "中文女",
      modelDir: resolveModelDir(),
      fallbackPromptWav: resolveFallbackWav(),
      fallbackPromptText: resolveFallbackText(),
    });
    const blob = pcm16ToWavBlob(pcm, sampleRate);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await audio.play();
    fouMsg.success("接口测试成功，正在播放");
  } catch (e) {
    await showFouAlert(toUserError(e), "接口测试失败");
  } finally {
    testBusy.value = false;
  }
}

async function runSpeak() {
  speakBusy.value = true;
  player?.stop();
  player = createCosyFastapiPlayer();
  try {
    const mapped = resolveCosyVoiceToneParams(settings.value.toneId);
    const preset = voices.value.find((v) => v.id === testVoiceId.value);
    await player.speak(speakText.value, {
      baseUrl: baseUrl.value,
      promptWavPath: preset?.sampleWav,
      promptText: preset?.promptText,
      instruct: mapped.instruct,
      spkId: needsReferenceWav() ? "" : settings.value.cosyFastapiSpkId || "中文女",
      modelDir: resolveModelDir(),
      fallbackPromptWav: resolveFallbackWav(),
      fallbackPromptText: resolveFallbackText(),
      volume: settings.value.volume,
    });
  } catch (e) {
    await showFouAlert(toUserError(e), "播报失败");
  } finally {
    speakBusy.value = false;
  }
}

function stopSpeak() {
  player?.stop();
  speakBusy.value = false;
}

async function closeWindow() {
  try {
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

onMounted(() => {
  void refreshAll();
  pollTimer = setInterval(() => {
    void cosyConsoleStatus(baseUrl.value, port.value)
      .then((s) => {
        status.value = s;
      })
      .catch(() => {});
  }, 4000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  player?.stop();
});
</script>

<template>
  <div class="cosy-console">
    <header class="cosy-console-header">
      <h1>CosyVoice 本地管理控制台</h1>
      <div class="cosy-console-cfg">
        <span class="hint">服务地址</span>
        <FouInput v-model="baseUrl" style="width: 280px" />
        <FouButton icon="save-line" size="small" @click="saveBaseUrl">保存</FouButton>
        <FouButton icon="radar-line" size="small" type="primary" :loading="probeBusy" @click="runProbe">
          检测连接
        </FouButton>
        <span class="pill" :class="statusPill.cls">{{ statusPill.text }}</span>
        <span v-if="probeHint" class="hint">{{ probeHint }}</span>
      </div>
    </header>

    <nav class="cosy-console-nav">
      <FouButton
        icon="flask-line"
        size="small"
        :type="tab === 'test' ? 'primary' : 'default'"
        @click="tab = 'test'"
      >
        接口测试
      </FouButton>
      <FouButton
        icon="user-voice-line"
        size="small"
        :type="tab === 'voices' ? 'primary' : 'default'"
        @click="tab = 'voices'"
      >
        音色库
      </FouButton>
      <FouButton
        icon="volume-up-line"
        size="small"
        :type="tab === 'speak' ? 'primary' : 'default'"
        @click="tab = 'speak'"
      >
        实时播报
      </FouButton>
      <FouButton
        icon="settings-3-line"
        size="small"
        :type="tab === 'ops' ? 'primary' : 'default'"
        @click="tab = 'ops'"
      >
        运行状态
      </FouButton>
      <FouButton icon="close-line" size="small" class="cosy-console-close" @click="closeWindow">
        关闭
      </FouButton>
    </nav>

    <main class="cosy-console-main">
      <section class="card">
        <h2>服务控制</h2>
        <div class="row">
          <span class="label">模型</span>
          <FouSelect
            v-model="selectedModel"
            :options="modelOptions"
            placeholder="选择模型"
            style="min-width: 220px"
          />
          <span class="label">端口</span>
          <FouInput v-model.number="port" type="number" style="width: 100px" />
          <FouButton
            icon="play-circle-line"
            :type="status?.healthy ? 'default' : 'primary'"
            size="small"
            :loading="busy"
            @click="runStart"
          >
            {{ status?.healthy ? "同步为默认引擎" : "启动" }}
          </FouButton>
          <FouButton icon="restart-line" size="small" :loading="busy" @click="runRestart">重启</FouButton>
          <FouButton icon="stop-circle-line" size="small" :loading="busy" @click="runStop">停止</FouButton>
          <span class="pill" :class="statusPill.cls">{{ statusPill.text }}</span>
        </div>
        <p v-if="status?.model" class="hint">当前模型：{{ status.model || selectedModel }}</p>
      </section>

      <section v-show="tab === 'ops'" class="card">
        <h2>运行状态</h2>
        <FouButton icon="refresh-line" size="small" @click="refreshAll">刷新</FouButton>
        <p class="log-summary">{{ recentLogSummary }}</p>
      </section>

      <section v-show="tab === 'test'" class="card">
        <h2>接口测试</h2>
        <div class="row">
          <span class="label">音色</span>
          <FouSelect
            v-model="testVoiceId"
            :options="voiceOptions"
            placeholder="选择系统音色（萝莉/御姐…）"
            clearable
          />
          <FouButton
            icon="magic-line"
            size="small"
            :loading="seedBusy"
            @click="seedSystemVoices(false)"
          >
            写入系统音色
          </FouButton>
        </div>
        <p v-if="seedHint" class="hint">{{ seedHint }}</p>
        <p v-if="!voiceOptions.length" class="hint">
          下拉为空时点「写入系统音色」：会用默认参考音自动生成萝莉/御姐/夹子等 sys-* 目录。
        </p>
        <FouInput v-model="testInstruct" placeholder="风格 instruct（可选）" />
        <textarea v-model="testText" class="ta" rows="3" />
        <FouButton icon="play-circle-line" type="primary" :loading="testBusy" @click="runApiTest">
          发起调用并播放
        </FouButton>
      </section>

      <section v-show="tab === 'speak'" class="card">
        <h2>实时播报</h2>
        <textarea v-model="speakText" class="ta" rows="3" />
        <div class="row">
          <FouButton icon="volume-up-line" type="primary" :loading="speakBusy" @click="runSpeak">播报</FouButton>
          <FouButton icon="stop-circle-line" @click="stopSpeak">停止</FouButton>
        </div>
      </section>

      <section v-show="tab === 'voices'" class="card">
        <h2>系统音色</h2>
        <p class="hint">
          一键写入 sys-*（默认参考音 + 各音色 instruct），无需用户训练。心情只叠加合成，不另建目录。
        </p>
        <div class="row">
          <FouButton
            icon="magic-line"
            type="primary"
            :loading="seedBusy"
            @click="seedSystemVoices(false)"
          >
            写入系统音色
          </FouButton>
          <FouButton icon="refresh-line" size="small" @click="refreshAll">刷新列表</FouButton>
        </div>
        <p v-if="seedHint" class="hint">{{ seedHint }}</p>
        <div v-if="!voices.filter((v) => v.id.startsWith('sys-')).length" class="empty">
          暂无系统音色。点上方「写入系统音色」即可生成萝莉/御姐/夹子/少年等。
        </div>
        <ul v-else class="voice-list">
          <li v-for="v in voices.filter((v) => v.id.startsWith('sys-'))" :key="v.id">
            <strong>{{ labelForSystemVoiceId(v.id) }}</strong>
            <span class="hint">{{ v.id }}</span>
          </li>
        </ul>

        <details class="advanced-import">
          <summary>高级：导入参考音</summary>
          <p class="hint">仅在需要自定义参考 wav 时使用；日常请用上方系统音色。</p>
          <div class="row">
            <FouInput v-model="newVoice.name" placeholder="名称" />
            <FouInput v-model="newVoice.id" placeholder="ID（可空）" />
            <FouButton icon="folder-open-line" size="small" @click="pickRefWav">选择参考音频</FouButton>
            <span class="hint">{{ newVoice.wavPath || "未选择" }}</span>
          </div>
          <textarea v-model="newVoice.promptText" class="ta" placeholder="参考文本转写" rows="2" />
          <FouInput v-model="newVoice.instruct" placeholder="风格指示（可选）" />
          <FouButton icon="save-line" type="primary" :loading="busy" @click="saveVoice">导入参考音</FouButton>
        </details>

        <h2 style="margin-top: 20px">自有音色</h2>
        <div v-if="!voices.filter((v) => !v.id.startsWith('sys-')).length" class="empty">暂无自有音色。</div>
        <ul v-else class="voice-list">
          <li v-for="v in voices.filter((v) => !v.id.startsWith('sys-'))" :key="v.id">
            <strong>{{ v.name || v.id }}</strong>
            <span class="hint">{{ v.missingPrompt ? "缺 prompt" : v.promptText.slice(0, 40) }}</span>
            <FouButton icon="delete-bin-line" size="small" @click="deleteVoice(v.id)">删除</FouButton>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.cosy-console {
  min-height: 100vh;
  background: #f6f7f9;
  color: #1f2328;
  font-size: 14px;
}
.cosy-console-header {
  background: #fff;
  border-bottom: 1px solid #e3e6ea;
  padding: 14px 20px;
}
.cosy-console-header h1 {
  font-size: 16px;
  margin: 0 0 10px;
}
.cosy-console-cfg {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.cosy-console-nav {
  display: flex;
  gap: 6px;
  padding: 10px 20px;
  background: #fff;
  border-bottom: 1px solid #e3e6ea;
}
.cosy-console-close {
  margin-left: auto;
}
.cosy-console-main {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px;
}
.card {
  background: #fff;
  border: 1px solid #e3e6ea;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}
.card h2 {
  font-size: 14px;
  margin: 0 0 12px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.label {
  color: #6b7280;
  min-width: 48px;
}
.hint {
  color: #6b7280;
  font-size: 12px;
}
.advanced-import {
  margin-top: 16px;
  padding: 12px;
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  background: #fafbfc;
}
.advanced-import summary {
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 8px;
}
.pill {
  padding: 2px 10px;
  border-radius: 20px;
  font-size: 12px;
  border: 1px solid #d0d5dc;
}
.pill.ok {
  background: #e6f4ea;
  color: #1a7f37;
  border-color: #b7dfc4;
}
.pill.err {
  background: #fdeaea;
  color: #c62828;
}
.pill.wait {
  background: #fdf3d8;
  color: #9a6700;
}
.log-summary {
  background: var(--surface-soft, #f8fafc);
  color: var(--body, #1e293b);
  padding: 12px;
  border-radius: 8px;
  max-height: 200px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.5;
  margin-top: 8px;
  white-space: pre-wrap;
}
.ta {
  width: 100%;
  margin: 8px 0;
  padding: 8px;
  border: 1px solid #d0d5dc;
  border-radius: 6px;
  font-family: inherit;
}
.empty {
  color: #6b7280;
  padding: 16px;
  text-align: center;
}
.voice-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.voice-list li {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #e3e6ea;
}
</style>
