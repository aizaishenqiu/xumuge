import { computed, ref, watch } from "vue";

const STORAGE_KEY = "xu.navbar.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const collapsed = ref(readCollapsed());

watch(collapsed, (v) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  document.documentElement.classList.toggle("nav-collapsed", v);
});

// sync on first load
if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("nav-collapsed", collapsed.value);
}

export function useNavCollapse() {
  const isCollapsed = computed(() => collapsed.value);
  function toggle() {
    collapsed.value = !collapsed.value;
  }
  function setCollapsed(v: boolean) {
    collapsed.value = v;
  }
  return { collapsed, isCollapsed, toggle, setCollapsed };
}
