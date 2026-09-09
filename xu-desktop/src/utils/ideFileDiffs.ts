/**
 * @file ideFileDiffs.ts IDE 窗与 Chat 共享的助手改文件 Diff
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-07
 * @version 1.0.0
 * @category Cache
 * @algo ide-chat-diff-bridge
 */
import { computed, ref, type Ref } from "vue";
import type { PatchFileChange } from "./patchDiff";

const fileDiffByPath: Ref<Record<string, PatchFileChange[]>> = ref({});

function normKey(absPath: string): string {
  return absPath.replace(/\\/g, "/").toLowerCase();
}

/** Duty: 记录助手对某绝对路径的补丁变更（供 IDE 编辑器「变更」页）。 */
export function setIdeFileDiff(absPath: string, changes: PatchFileChange[]): void {
  const key = normKey(absPath);
  if (!key || !changes.length) return;
  fileDiffByPath.value = { ...fileDiffByPath.value, [key]: changes };
}

/** Duty: 取某路径当前 Diff；无则 null。 */
export function getIdeFileDiff(absPath: string): PatchFileChange[] | null {
  const key = normKey(absPath);
  if (!key) return null;
  return fileDiffByPath.value[key] ?? null;
}

/** Duty: IDE 页按当前打开文件取 Diff。 */
export function useActiveIdeFileDiff(path: Ref<string | null | undefined>) {
  return computed(() => {
    const p = path.value?.trim();
    if (!p) return null;
    return getIdeFileDiff(p);
  });
}
