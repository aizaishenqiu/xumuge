# 06 · Tauri 与 Rust

QQ 群：`1102740387`

路径：`xu-desktop/src-tauri/`。

## 1. 结构

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json          # 窗口、bundle.resources（含岗包、rg）
├── capabilities/            # 权限声明
├── bin/rg.exe               # ripgrep sidecar
└── src/
    ├── main.rs / lib.rs
    ├── commands/            # 前端 invoke 的命令
    ├── agent/               # Native Agent 相关
    ├── role_pack/           # 岗位包加载
    ├── voice/               # 语音
    ├── mcp/                 # MCP
    ├── employee/            # 员工/派活相关
    ├── desktop_db.rs        # 本机库
    ├── xu_env.rs / xu_paths.rs
    └── …
```

运行时数据目录遵循产品约定（如应用数据目录下的库文件），**不要**在代码里写死本机绝对路径（如 `E:\…`）。

## 2. 前后端调用

前端使用 `@tauri-apps/api` 的 `invoke` / 事件；具体命令名以 `commands/` 与生成绑定为准。

改 Rust 命令后：

1. 保持命令签名与前端调用一致  
2. `pnpm tauri:dev` 验证  
3. 注意 Windows 下子进程 `CREATE_NO_WINDOW` 等产品约定（避免弹黑框）  

## 3. Native Agent

桌面主对话与派活走 **Native Agent**（Rust 侧循环），**不** spawn 外部 hermes CLI。调试 Agent 行为时优先看 `src-tauri/src/agent/` 与相关前端编排。

## 4. 打包相关配置

- `tauri.conf.json`：`bundle.resources` 需包含 `full.zh-CN.xupack` 与 `rg.exe` 等。  
- 开源未签名构建由 `scripts/build-release-oss-unsigned.mjs` 写临时 `tauri.windows.conf.json`（无 `certificateThumbprint`）。  
