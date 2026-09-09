<!--
  @file 通话助手外观快捷控件（设置默认页仅用外观；音色请到各引擎页）
  @author qiuye <yjk150@qq.com>
  @date 2026-08-31
  @updated 2026-09-02
  @version 3.0.0
  @category UI
  @algo provider-aware-voice-quick
-->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { FouButton, FouSelect } from "foucui";
import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../../stores/voiceSettings";
import { listSystemVoices } from "../../utils/ttsProvider";
import { listVoicePacks, type InstalledVoicePack } from "../../utils/voicePacks";
import { listMoodsForGender, getVoiceMoodPreset } from "../../utils/voiceMoodPresets";
import {
  getVoiceTimbrePreset,
  listTimbresByGender,
  systemVoiceDirId,
  type VoiceGender,
} from "../../utils/voiceTimbrePresets";
import { getVoiceTonePreset, matchSystemVoiceForTone } from "../../utils/voiceTonePresets";
import { resolveProsody } from "../../utils/voiceToneEngineMap";
import { syncVoiceToTone } from "../../utils/voiceToneSync";
import {
  formatSystemVoiceLabel,
  filterSystemVoicesByGender,
  systemHasGender,
} from "../../utils/systemVoiceLabels";
import {
  kokoroVoiceGender,
  listKokoroVoicesByGender,
  resolveKokoroVoiceId,
} from "../../utils/kokoroVoiceMap";
import {
  loadVoiceAssistantId,
  saveVoiceAssistantId,
  VOICE_ASSISTANT_PRESETS,
} from "../../utils/voiceAssistantPrefs";

const props = withDefaults(
  defineProps<{
    compact?: boolean;
    packs?: InstalledVoicePack[] | null;
    /** appearance = 仅背景；full = 按当前引擎分表 */
    mode?: "appearance" | "full";
  }>(),
  { compact: false, packs: null, mode: "full" },
);

const emit = defineEmits<{
  backgroundChange: [string];
}>();

const settings = ref<VoiceSettings>(loadVoiceSettings());
const localPacks = ref<InstalledVoicePack[]>([]);
const packs = computed(() => (props.packs != null ? props.packs : localPacks.value));
const systemVoices = ref<SpeechSynthesisVoice[]>([]);
const assistantId = ref(loadVoiceAssistantId() || VOICE_ASSISTANT_PRESETS[0]?.id || "");

const provider = computed(() => settings.value.provider);
const showMood = computed(
  () =>
    provider.value === "cosyvoice" &&
    (settings.value.cosyBackend === "fastapi" || settings.value.apiSupportsMood !== false),
);
const showGender = computed(() => {
  if (provider.value === "system-webspeech") {
    return systemHasGender(systemVoices.value, "male");
  }
  return true;
});
const genderOptions = computed(() => {
  if (provider.value === "system-webspeech") {
    const opts: Array<{ label: string; value: VoiceGender }> = [
      { label: "女声", value: "female" },
    ];
    if (systemHasGender(systemVoices.value, "male")) {
      opts.push({ label: "男声", value: "male" });
    }
    return opts;
  }
  return [
    { label: "女声", value: "female" as VoiceGender },
    { label: "男声", value: "male" as VoiceGender },
  ];
});
const voiceOptions = computed(() => {
  if (provider.value === "system-webspeech") {
    return filterSystemVoicesByGender(systemVoices.value, settings.value.voiceGender).map((v) => ({
      label: formatSystemVoiceLabel(v),
      value: v.voiceURI,
    }));
  }
  if (provider.value === "sherpa-onnx") {
    const pack = packs.value.find((p) => p.provider === "sherpa-onnx");
    return listKokoroVoicesByGender(settings.value.voiceGender, pack?.voices).map((v) => ({
      label: v.label,
      value: v.id,
    }));
  }
  return listTimbresByGender(settings.value.voiceGender).map((t) => ({
    label: t.label,
    value: t.id,
  }));
});
const moodOptions = computed(() =>
  listMoodsForGender(settings.value.voiceGender).map((m) => ({ label: m.label, value: m.id })),
);
const backgroundOptions = computed(() =>
  VOICE_ASSISTANT_PRESETS.map((p) => ({
    label: `${p.genderLabel} · ${p.name}（${p.lookLabel}）`,
    value: p.id,
  })),
);
const selectedVoiceValue = computed(() => {
  if (provider.value === "system-webspeech") return settings.value.voice;
  if (provider.value === "sherpa-onnx") return resolveKokoroVoiceId(settings.value.voice);
  return settings.value.timbreId;
});

function persist(patch: Partial<VoiceSettings>) {
  settings.value = saveVoiceSettings({ ...settings.value, ...patch });
}

function selectGender(gender: VoiceGender) {
  if (settings.value.voiceGender === gender) return;
  if (provider.value === "system-webspeech") {
    const pool = filterSystemVoicesByGender(systemVoices.value, gender);
    persist({ voiceGender: gender, voice: pool[0]?.voiceURI || settings.value.voice });
    return;
  }
  if (provider.value === "sherpa-onnx") {
    const pack = packs.value.find((p) => p.provider === "sherpa-onnx");
    const list = listKokoroVoicesByGender(gender, pack?.voices);
    const next = list[0];
    if (next) {
      persist({ voiceGender: gender, voice: next.id });
    } else persist({ voiceGender: gender });
    return;
  }
  const next = listTimbresByGender(gender)[0];
  const moodId =
    gender === "male" && getVoiceMoodPreset(settings.value.moodId).femaleOnly
      ? "calm"
      : settings.value.moodId;
  if (next) applyCosyTimbre(next.id, gender);
  else persist({ voiceGender: gender, moodId });
}

function applySystemOrKokoroVoice(id: string) {
  if (provider.value === "system-webspeech") {
    persist({ voice: id });
    return;
  }
  if (provider.value === "sherpa-onnx") {
    const vid = resolveKokoroVoiceId(id);
    persist({ voice: vid, voiceGender: kokoroVoiceGender(vid) });
  }
}

function applyCosyTimbre(timbreId: string, genderOverride?: VoiceGender) {
  const timbre = getVoiceTimbrePreset(timbreId);
  const prosody = resolveProsody(timbre.id, settings.value.moodId);
  persist({
    voiceGender: genderOverride ?? timbre.gender,
    timbreId: timbre.id,
    toneId: timbre.id,
    rate: prosody.rate,
    pitch: prosody.pitch,
    voice: systemVoiceDirId(timbre.id),
  });
}

function onVoiceSelect(v: string) {
  if (provider.value === "cosyvoice") applyCosyTimbre(v);
  else applySystemOrKokoroVoice(v);
}

function applyMood(moodId: string) {
  if (!showMood.value) return;
  const mood = getVoiceMoodPreset(moodId);
  if (mood.femaleOnly && settings.value.voiceGender === "male") return;
  const prosody = resolveProsody(settings.value.timbreId || settings.value.toneId, mood.id);
  persist({ moodId: mood.id, rate: prosody.rate, pitch: prosody.pitch });
}

function onBackgroundChange(id: string) {
  assistantId.value = id;
  saveVoiceAssistantId(id);
  emit("backgroundChange", id);
}

onMounted(async () => {
  systemVoices.value = listSystemVoices();
  if (props.packs != null) {
    const patch = syncVoiceToTone(settings.value, packs.value, systemVoices.value);
    if (Object.keys(patch).length) persist(patch);
    return;
  }
  try {
    localPacks.value = await listVoicePacks();
  } catch {
    localPacks.value = [];
  }
  const patch = syncVoiceToTone(settings.value, packs.value, systemVoices.value);
  if (Object.keys(patch).length) persist(patch);
});
</script>

<template>
  <div class="voice-quick-controls" :class="{ compact }">
    <template v-if="mode === 'full'">
      <div v-if="showGender" class="vqc-row">
        <span class="vqc-label">性别</span>
        <div class="vqc-actions">
          <FouButton
            v-for="g in genderOptions"
            :key="g.value"
            :icon="g.value === 'female' ? 'user-smile-line' : 'user-line'"
            size="small"
            :type="settings.voiceGender === g.value ? 'primary' : 'default'"
            @click="selectGender(g.value)"
          >
            {{ g.label }}
          </FouButton>
        </div>
      </div>
      <div class="vqc-row">
        <span class="vqc-label">{{ provider === 'cosyvoice' ? '音色' : '声线' }}</span>
        <FouSelect
          class="vqc-select"
          :model-value="selectedVoiceValue"
          :options="voiceOptions"
          @update:model-value="(v: string) => onVoiceSelect(String(v))"
        />
      </div>
      <div v-if="showMood" class="vqc-row">
        <span class="vqc-label">心情</span>
        <FouSelect
          class="vqc-select"
          :model-value="settings.moodId"
          :options="moodOptions"
          @update:model-value="(v: string) => applyMood(String(v))"
        />
      </div>
    </template>
    <div class="vqc-row">
      <span class="vqc-label">背景</span>
      <FouSelect
        class="vqc-select"
        :model-value="assistantId"
        :options="backgroundOptions"
        @update:model-value="(v: string) => onBackgroundChange(String(v))"
      />
    </div>
  </div>
</template>

<style scoped>
.voice-quick-controls { display: grid; gap: 8px; }
.voice-quick-controls.compact { gap: 6px; padding: 8px 12px; border-top: 1px solid rgba(148, 163, 184, 0.2); }
.vqc-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vqc-label { min-width: 40px; font-size: 12px; color: #94a3b8; font-weight: 600; }
.compact .vqc-label { min-width: 36px; }
.vqc-select { min-width: 140px; max-width: 220px; }
.vqc-actions { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
