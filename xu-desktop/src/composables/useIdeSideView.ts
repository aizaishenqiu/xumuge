import { ref } from "vue";

export type IdeSideView =
  | "explorer"
  | "search"
  | "scm"
  | "problems"
  | "extensions"
  | "npm"
  | "outline"
  | "timeline";

const STORAGE_KEY = "xu.ide.sideView";

function readStored(): IdeSideView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const allowed: IdeSideView[] = [
      "explorer",
      "search",
      "scm",
      "problems",
      "extensions",
      "npm",
      "outline",
      "timeline",
    ];
    if (raw === "canvas") {
      localStorage.setItem(STORAGE_KEY, "explorer");
      return "explorer";
    }
    if (raw && allowed.includes(raw as IdeSideView)) return raw as IdeSideView;
  } catch {
    /* ignore */
  }
  return "explorer";
}

const activeView = ref<IdeSideView>(readStored());

const ALLOWED: IdeSideView[] = [
  "explorer",
  "search",
  "scm",
  "problems",
  "extensions",
  "npm",
  "outline",
  "timeline",
];

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    if (ALLOWED.includes(e.newValue as IdeSideView)) {
      activeView.value = e.newValue as IdeSideView;
    }
  });
}

export function useIdeSideView() {
  function setView(view: IdeSideView) {
    activeView.value = view;
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch {
      /* ignore */
    }
  }

  return { activeView, setView };
}

export const IDE_VIEW_ITEMS: {
  id: IdeSideView;
  icon: string;
  label: string;
  title: string;
}[] = [
  { id: "explorer", icon: "folder-2-line", label: "资源", title: "资源管理器" },
  { id: "search", icon: "search-line", label: "搜索", title: "搜索" },
  { id: "scm", icon: "git-branch-line", label: "Git", title: "源代码管理" },
  { id: "problems", icon: "error-warning-line", label: "问题", title: "问题" },
  { id: "extensions", icon: "puzzle-line", label: "扩展", title: "扩展与检查" },
  { id: "npm", icon: "terminal-box-line", label: "npm", title: "npm 脚本" },
  { id: "outline", icon: "list-unordered", label: "大纲", title: "大纲" },
  { id: "timeline", icon: "history-line", label: "时间线", title: "时间线" },
];
