# Developing · 开源版开发文档

Virmoor / 虚募阁 open-source staging · 中英对照

社区 QQ 群：**1102740387**

---

## 中文

### 1. 前置

- Node.js + pnpm  
- Rust（Tauri 2）  
- Windows：WebView2  
- 许可证：**AGPL-3.0**（见 [LICENSE](./LICENSE)）

### 2. 目录

| 路径 | 作用 |
|------|------|
| `xu-desktop/` | 桌面源码（白名单导出） |
| `xu-desktop/role-packs-src/zh-virmoon/` | **约 461** 个非 market 演示岗位 MD |
| `demo-skills/` | 轻量 Skill 导入样例 |
| `.env.example` | 占位域名 `xxx.com`（勿提交真实密钥） |

### 3. 本地开发

```bash
cd xu-desktop
cp .env.example .env.development
# 按需改成自建 API；占位 xxx.com 不是真实服务
pnpm i
pnpm tauri:dev
```

缺 `src-tauri/bin/rg.exe` 时：在 monorepo 根执行 `node scripts/export-opensource-desktop.mjs`，或 `pnpm setup:rg`。

### 4. 从私有仓刷新

```bash
# monorepo 根
node scripts/export-opensource-desktop.mjs
# 仅刷新 461 岗：
node scripts/lib/copy-zh-virmoon-oss-demo.mjs
```

导出规则：`originSource !== market` → 保留约 461；丢弃 market（约 761）。

### 5. 编译演示岗包 / 安装包

```bash
cd xu-desktop
pnpm build:role-pack:full
# 或一键未签名 NSIS：
pnpm build:release:oss-unsigned
```

- 源：`role-packs-src/zh-virmoon`  
- 产物文件名：`resources/role-packs/full.zh-CN.xupack`（满足 Tauri / guard；**gitignore**）  
- 无 Authenticode 签名  

若 cargo 对 `opensource/.../target` 报「拒绝访问」：

```powershell
$env:CARGO_TARGET_DIR="<writable-target-dir>"
pnpm build:release:oss-unsigned
```

### 6. AGPL 注意

修改并以网络服务形式提供本程序时，须按 AGPL-3.0 向远程用户提供对应源码（见 NOTICE / LICENSE §13）。

### 7. 不要做什么

- 勿提交真实 `.env` / 证书 / `*.xupack`  
- 勿把 `zh-CN-virmoor`、market 岗拷进公开仓  
- 勿未经授权 push 陌生公开远程  

---

## English

### Prerequisites

Node + pnpm, Rust/Tauri 2, WebView2 on Windows. License: **AGPL-3.0**.

### Dev

```bash
cd xu-desktop
cp .env.example .env.development
pnpm i && pnpm tauri:dev
```

### Demo pack (~461 roles)

Non-market subset of `zh-virmoon`. Refresh: `node scripts/lib/copy-zh-virmoon-oss-demo.mjs` from the private monorepo root. Build: `pnpm build:role-pack:full` or `pnpm build:release:oss-unsigned`.

### Community

QQ group: **1102740387**
