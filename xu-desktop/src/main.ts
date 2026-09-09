import { createApp } from "vue";
import { createPinia } from "pinia";
import { setupFoucui } from "foucui";
import "foucui/dist/foucui.css";
import App from "./App.vue";
import { router } from "./router";
import { i18n } from "./i18n";
import { applyDocumentTitle } from "./utils/brandSettings";
import { initThemeSync } from "./composables/useTheme";
import { clearStuckUiBlockers, installUiBlockerGuard } from "./utils/clearStuckUiBlockers";
import "./index.css";
import "./styles/qiu-overrides.css";

applyDocumentTitle();
initThemeSync();
installUiBlockerGuard();

const app = createApp(App);
app.use(createPinia());
setupFoucui(app);
app.use(i18n);
app.use(router);
app.mount("#root");
