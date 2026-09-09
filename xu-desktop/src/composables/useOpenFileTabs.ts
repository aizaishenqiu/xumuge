import { computed, ref } from "vue";
import { fouConfirmPromise, fouMsg } from "foucui";

export type OpenFileTab = {
  path: string;
  dirty: boolean;
  pinned: boolean;
  /** Ephemeral preview tab (replaced on next single-click open). */
  preview: boolean;
};

export type OpenFileOptions = {
  preview?: boolean;
  pin?: boolean;
};

function normPath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function fileName(path: string): string {
  return path.replace(/^.*[/\\]/, "") || path;
}

export function useOpenFileTabs() {
  const tabs = ref<OpenFileTab[]>([]);
  const activePath = ref<string | null>(null);

  const activeTab = computed(() =>
    tabs.value.find((t) => normPath(t.path) === normPath(activePath.value ?? "")) ?? null,
  );

  function findTab(path: string): OpenFileTab | undefined {
    return tabs.value.find((t) => normPath(t.path) === normPath(path));
  }

  function sortTabs() {
    const pinned = tabs.value.filter((t) => t.pinned);
    const unpinned = tabs.value.filter((t) => !t.pinned);
    tabs.value = [...pinned, ...unpinned];
  }

  function openFile(path: string, opts: OpenFileOptions = {}) {
    const trimmed = path.trim();
    if (!trimmed) return;

    const preview = opts.preview ?? false;
    const existing = findTab(trimmed);
    if (existing) {
      if (!preview) existing.preview = false;
      if (opts.pin) existing.pinned = true;
      activePath.value = trimmed;
      sortTabs();
      return;
    }

    if (preview) {
      tabs.value = tabs.value.filter((t) => !t.preview || t.pinned);
    }

    const tab: OpenFileTab = {
      path: trimmed,
      dirty: false,
      pinned: opts.pin ?? false,
      preview,
    };
    tabs.value.push(tab);
    sortTabs();
    activePath.value = trimmed;
  }

  function setActive(path: string | null) {
    if (!path) {
      activePath.value = null;
      return;
    }
    if (findTab(path)) activePath.value = path;
  }

  function setDirty(path: string, dirty: boolean) {
    const tab = findTab(path);
    if (tab) tab.dirty = dirty;
  }

  function keepOpen(path: string) {
    const tab = findTab(path);
    if (tab) tab.preview = false;
  }

  function togglePin(path: string) {
    const tab = findTab(path);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    tab.preview = false;
    sortTabs();
  }

  async function confirmCloseDirty(tab: OpenFileTab): Promise<boolean> {
    if (!tab.dirty) return true;
    const action = await fouConfirmPromise(
      `「${fileName(tab.path)}」有未保存的更改，确定关闭？`,
      "未保存的更改",
      { confirmButtonText: "关闭", cancelButtonText: "取消" },
    );
    return action === "confirm";
  }

  async function closeTab(path: string) {
    const tab = findTab(path);
    if (!tab) return;
    if (!(await confirmCloseDirty(tab))) return;

    const idx = tabs.value.findIndex((t) => normPath(t.path) === normPath(path));
    tabs.value = tabs.value.filter((t) => normPath(t.path) !== normPath(path));

    if (normPath(activePath.value ?? "") === normPath(path)) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null;
      activePath.value = next?.path ?? null;
    }
  }

  async function closeOthers(path: string) {
    const toClose = tabs.value.filter((t) => normPath(t.path) !== normPath(path));
    for (const tab of toClose) {
      if (!(await confirmCloseDirty(tab))) return;
    }
    tabs.value = tabs.value.filter((t) => normPath(t.path) === normPath(path));
    activePath.value = path;
  }

  async function closeToRight(path: string) {
    const idx = tabs.value.findIndex((t) => normPath(t.path) === normPath(path));
    if (idx < 0) return;
    const toClose = tabs.value.slice(idx + 1);
    for (const tab of toClose) {
      if (!(await confirmCloseDirty(tab))) return;
    }
    tabs.value = tabs.value.slice(0, idx + 1);
    if (!findTab(activePath.value ?? "")) activePath.value = path;
  }

  async function closeSaved() {
    const dirty = tabs.value.filter((t) => t.dirty);
    const saved = tabs.value.filter((t) => !t.dirty);
    if (!saved.length) {
      fouMsg.info("没有可关闭的已保存标签页");
      return;
    }
    tabs.value = dirty;
    if (activePath.value && !findTab(activePath.value)) {
      activePath.value = tabs.value[tabs.value.length - 1]?.path ?? null;
    }
    sortTabs();
  }

  async function closeAll() {
    for (const tab of tabs.value) {
      if (!(await confirmCloseDirty(tab))) return;
    }
    tabs.value = [];
    activePath.value = null;
  }

  function removeTabSilent(path: string) {
    tabs.value = tabs.value.filter((t) => normPath(t.path) !== normPath(path));
    if (normPath(activePath.value ?? "") === normPath(path)) {
      activePath.value = tabs.value[tabs.value.length - 1]?.path ?? null;
    }
  }

  return {
    tabs,
    activePath,
    activeTab,
    openFile,
    setActive,
    setDirty,
    keepOpen,
    togglePin,
    closeTab,
    closeOthers,
    closeToRight,
    closeSaved,
    closeAll,
    removeTabSilent,
    findTab,
  };
}
