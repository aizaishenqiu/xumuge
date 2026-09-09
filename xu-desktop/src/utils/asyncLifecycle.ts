/**
 * @file Vue 异步任务代次与卸载后 disposer 竞态防护
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category UI
 * @algo monotonic-generation-token
 */

/** 单调代次守卫；取消或卸载会让所有既有 token 立即失效。 */
export class AsyncGenerationGuard {
  private generation = 0;
  private disposed = false;

  begin(): number {
    this.disposed = false;
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
  }

  isCurrent(token: number): boolean {
    return !this.disposed && token === this.generation;
  }
}

/**
 * 接收异步注册返回的清理函数。
 * 依赖调用方的卸载状态；若注册完成时已卸载则立即清理，不再保存悬空监听。
 */
export function retainAsyncDisposer(
  disposer: () => void,
  isDisposed: () => boolean,
  retain: (disposer: () => void) => void,
): boolean {
  if (isDisposed()) {
    disposer();
    return false;
  }
  retain(disposer);
  return true;
}
