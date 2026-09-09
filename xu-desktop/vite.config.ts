/**
 * @file 桌面前端构建与测试配置
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.0.0
 * @category Config
 * @algo none
 */

/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";

const CELL_START = 'name: "FouTableCellContent"';
const CELL_END = "}), ji =";

/** foucui@2.3.x FouTableCellContent 须用 m(createVNode)，setup 内 y 为 ref */
function patchFoucuiTableH(): Plugin {
  const FOUCUI_RE = /[/\\]node_modules[/\\]foucui[/\\]dist[/\\]foucui\.js$/;

  function patchSource(code: string): string {
    const start = code.indexOf(CELL_START);
    if (start === -1) return code;
    const end = code.indexOf(CELL_END, start);
    if (end === -1) return code;
    const endPos = end + CELL_END.length;
    const block = code.slice(start, endPos);
    if (!block.includes('class: "xu-table__text"')) return code;
    const nextBlock = block.replace(/\b[hy]\(/g, "m(");
    if (nextBlock === block) return code;
    return code.slice(0, start) + nextBlock + code.slice(endPos);
  }

  return {
    name: "patch-foucui-table-h",
    enforce: "pre",
    transform(code, id) {
      if (!FOUCUI_RE.test(id.replace(/\\/g, "/"))) return;
      const next = patchSource(code);
      if (next !== code) return { code: next, map: null };
    },
    config() {
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [
              {
                name: "patch-foucui-h-esbuild",
                setup(build) {
                  build.onLoad({ filter: /foucui[/\\]dist[/\\]foucui\.js$/ }, async (args) => {
                    const fs = await import("node:fs");
                    let contents = await fs.promises.readFile(args.path, "utf8");
                    contents = contents.replace(/^\/\* fou-table-h-patch(-v2)? \*\/\n/, "");
                    contents = patchSource(contents);
                    return { contents, loader: "js" };
                  });
                },
              },
            ],
          },
        },
      };
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [patchFoucuiTableH(), vue()],
  clearScreen: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
  optimizeDeps: {
    include: ["mermaid", "@vue-flow/core"],
  },
  build: {
    minify: true,
    cssMinify: true,
    sourcemap: false,
  },
  server: {
    // 必须绑定 127.0.0.1：若仅监听 [::1]，本机其它项目占 127.0.0.1:1420 时 Tauri 会加载错前端（如 gpt-xumuge WORKSPACE）。
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri + 大岗位 JSON：后台翻译脚本写入时会触发全应用 HMR「假重启」甚至 WebView 崩溃
      ignored: ["**/src-tauri/**", "**/role-packs-src/**", "**/*.xupack"],
    },
  },
}));
