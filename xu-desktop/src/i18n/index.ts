import { createI18n } from "vue-i18n";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

export const UI_LOCALE_KEY = "xu.ui.locale";
export type UiLocale = "zh-CN" | "en-US";

export function readUiLocale(): UiLocale {
  try {
    const raw = localStorage.getItem(UI_LOCALE_KEY);
    if (raw === "en-US" || raw === "zh-CN") return raw;
  } catch {
    /* ignore */
  }
  return "zh-CN";
}

export function applyDocumentLang(locale: UiLocale): void {
  document.documentElement.lang = locale === "en-US" ? "en" : "zh-CN";
}

export const i18n = createI18n({
  legacy: false,
  locale: readUiLocale(),
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS,
  },
});

applyDocumentLang(readUiLocale());
