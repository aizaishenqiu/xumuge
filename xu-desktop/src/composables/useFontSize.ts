import { onMounted, ref, watch } from "vue";
import { readLs, writeLs } from "../utils/xuStorage";

export type FontSize = "small" | "medium" | "large";

export const FONT_SIZES: FontSize[] = ["small", "medium", "large"];

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

function readStorage(key: string, legacyKey: string, def: FontSize): FontSize {
  try {
    const v = readLs(key, legacyKey) as FontSize | null;
    return v && FONT_SIZES.includes(v) ? v : def;
  } catch {
    return def;
  }
}

export function useFontSize() {
  const uiFontSize = ref<FontSize>("medium");

  onMounted(() => {
    uiFontSize.value = readStorage("xu.ui.fontSize", "hermes-ui-font-size", "medium");
  });

  watch(
    uiFontSize,
    (value) => {
      if (value === "medium") {
        document.documentElement.removeAttribute("data-ui-size");
      } else {
        document.documentElement.setAttribute("data-ui-size", value);
      }
      writeLs("xu.ui.fontSize", value, "hermes-ui-font-size");
    },
    { immediate: true },
  );

  return { uiFontSize };
}
