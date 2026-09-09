/**
 * @file 全链路固定数据聚合回归入口
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-31
 * @version 1.1.0
 * @category Other
 * @algo fail-fast-process-orchestration
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const serverRoot = path.join(repoRoot, "server");

const stages = [
  {
    name: "前端全链路定向测试",
    command: process.execPath,
    cwd: desktopRoot,
    args: [
      path.join(desktopRoot, "node_modules/vitest/vitest.mjs"),
      "run",
      "src/help/fullChainHelp.test.ts",
      "src/utils/voiceCall.test.ts",
      "src/stores/voiceSettings.test.ts",
      "src/utils/screenshotEditor.test.ts",
      "src/intent/requirementsGate.test.ts",
      "src/utils/contextMemory.test.ts",
      "src/training/roleTraining.test.ts",
      "src/utils/codingSurfacePrefs.test.ts",
    ],
  },
  {
    name: "Rust 本地数据库与安全门禁测试",
    command: "cargo",
    cwd: path.join(desktopRoot, "src-tauri"),
    args: ["test", "--lib"],
  },
  {
    name: "服务端岗位训练测试",
    command: "go",
    cwd: serverRoot,
    args: ["test", "./app/aidesktop/training/..."],
  },
];

for (const stage of stages) {
  console.log(`\n[集成回归] ${stage.name}`);
  const result = spawnSync(stage.command, stage.args, {
    cwd: stage.cwd,
    env: { ...process.env, CI: "1" },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[集成回归] 无法启动：${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`[集成回归] 子进程被信号 ${result.signal} 终止`);
    process.exit(1);
  }
  if (!Number.isInteger(result.status) || result.status !== 0) {
    const exitCode = Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    console.error(`[集成回归] ${stage.name} 失败（退出码 ${exitCode}）`);
    process.exit(exitCode);
  }
}

console.log("\n[集成回归] 全部阶段通过");
