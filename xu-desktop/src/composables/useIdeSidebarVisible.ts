import { ref } from "vue";
import { readLs, writeLs } from "../utils/xuStorage";

const SIDEBAR_KEY = "xu.ide.sidebarVisible";

function readSidebarVisible(): boolean {
  try {
    return readLs(SIDEBAR_KEY, "1") !== "0";
  } catch {
    return true;
  }
}

/** Shared IDE left sidebar (Activity Bar + file tree) visibility. */
export const ideSidebarVisible = ref(readSidebarVisible());

export function toggleIdeSidebar() {
  ideSidebarVisible.value = !ideSidebarVisible.value;
  writeLs(SIDEBAR_KEY, ideSidebarVisible.value ? "1" : "0");
}

export function setIdeSidebarVisible(v: boolean) {
  ideSidebarVisible.value = v;
  writeLs(SIDEBAR_KEY, v ? "1" : "0");
}
