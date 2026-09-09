import { onMounted, onUnmounted, ref } from "vue";
import { readLs } from "../utils/xuStorage";

export type GuideBotAppearance = "classic" | "voxel" | "anime" | "cyber" | "pod";

const GUIDE_BOT_KEY = "xu.guideBot.appearance";
const GUIDE_BOT_KEY_LEGACY = "hermes.guideBot.appearance";
const GUIDE_BOT_EVENT = "xu-guide-bot-appearance";

const VALID: GuideBotAppearance[] = ["classic", "voxel", "anime", "cyber", "pod"];

export function readGuideBotAppearance(): GuideBotAppearance {
  try {
    const saved = readLs(GUIDE_BOT_KEY, GUIDE_BOT_KEY_LEGACY) as GuideBotAppearance | null;
    return saved && VALID.includes(saved) ? saved : "classic";
  } catch {
    return "classic";
  }
}

export function useGuideBotAppearance() {
  const appearance = ref<GuideBotAppearance>(readGuideBotAppearance());

  function onChange() {
    appearance.value = readGuideBotAppearance();
  }

  onMounted(() => {
    window.addEventListener(GUIDE_BOT_EVENT, onChange);
    window.addEventListener("hermes-guide-bot-appearance", onChange);
  });

  onUnmounted(() => {
    window.removeEventListener(GUIDE_BOT_EVENT, onChange);
    window.removeEventListener("hermes-guide-bot-appearance", onChange);
  });

  return { appearance };
}
