/**
 * @file Vitest 浏览器存储隔离环境
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo in-memory-key-value
 */

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(String(key)) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: createStorage(),
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: createStorage(),
});
