import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  applyDocumentLang,
  readUiLocale,
  UI_LOCALE_KEY,
  type UiLocale,
} from "../i18n";

const LOCALE_OPTIONS: Array<{ value: UiLocale; labelKey: "settings.localeZhCN" | "settings.localeEnUS" }> = [
  { value: "zh-CN", labelKey: "settings.localeZhCN" },
  { value: "en-US", labelKey: "settings.localeEnUS" },
];

export function useUiLocale() {
  const { locale, t } = useI18n();

  const current = computed(() => (locale.value === "en-US" ? "en-US" : "zh-CN") as UiLocale);

  const options = computed(() =>
    LOCALE_OPTIONS.map((o) => ({
      value: o.value,
      label: t(o.labelKey),
    })),
  );

  function setLocale(next: UiLocale) {
    locale.value = next;
    applyDocumentLang(next);
    try {
      localStorage.setItem(UI_LOCALE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  /** Sync vue-i18n with storage on settings mount. */
  function hydrateLocale() {
    const stored = readUiLocale();
    if (locale.value !== stored) {
      locale.value = stored;
      applyDocumentLang(stored);
    }
  }

  return { locale: current, options, setLocale, hydrateLocale };
}
