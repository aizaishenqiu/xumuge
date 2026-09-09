import { ref } from "vue";
import { router } from "../router";
import {
  DEFAULT_HELP_TOPIC,
  helpTopicForRoute,
  resolveHelpTopicId,
} from "../help/helpManifest";

export const helpPanelOpen = ref(false);
export const helpActiveTopic = ref(DEFAULT_HELP_TOPIC);

export function openHelp(topicId?: string) {
  helpActiveTopic.value = resolveHelpTopicId(topicId);
  helpPanelOpen.value = true;
}

export function closeHelpPanel() {
  helpPanelOpen.value = false;
}

export function openHelpForCurrentRoute() {
  const path = router.currentRoute.value.path;
  openHelp(helpTopicForRoute(path));
}

export function goHelpPage(topicId?: string) {
  const t = resolveHelpTopicId(topicId || helpActiveTopic.value);
  void router.push({ path: "/help", query: { t } });
}
