# Usage · 使用说明

Virmoor / 虚募阁 open-source staging · 中英对照  
QQ 群：**1102740387** · License: **AGPL-3.0**

**下载安装包（Windows）：** [Release · 虚募阁一人AI公司桌面端](https://gitee.com/jiukakeji/xumuge/releases/tag/%E8%99%9A%E5%8B%9F%E9%98%81%E4%B8%80%E4%BA%BAAI%E5%85%AC%E5%8F%B8%E6%A1%8C%E9%9D%A2%E7%AB%AF) → 附件 **`虚募阁_1.0.2_x64-setup.exe`**

更完整的开发流程见 [DEVELOPING.md](./DEVELOPING.md)。

---

## 中文

### 1. 目录说明

| 路径 | 作用 |
|------|------|
| `xu-desktop/` | 桌面端可编译源码 |
| `xu-desktop/role-packs-src/zh-virmoon/` | **约 461** 演示岗位（非 market） |
| `demo-skills/` | 轻量 Skill Markdown |
| `README.md` / `OPEN_SOURCE.md` | 简介与开源模式 |

### 2. 开发运行

```bash
cd xu-desktop
cp .env.example .env.development
# 示例域名为 xxx.com / api.xxx.com，请改成自建地址；勿提交真实密钥
pnpm i
pnpm tauri:dev
```

### 3. 导入轻量 Demo Skills（可选）

见 [demo-skills/README.md](./demo-skills/README.md)。主演示内容已是 `role-packs-src/zh-virmoon` 岗包。

### 4. 打 Windows 安装包（开源）

```bash
cd xu-desktop
pnpm i
pnpm build:release:oss-unsigned
```

行为：

1. `XU_WIN_CODE_SIGN_DEFER=1`（无证书）  
2. 从 `role-packs-src/zh-virmoon` 编译 `full.zh-CN.xupack`（约 461 岗 demo）  
3. `guard-release-bundle` → `prepare-release-clean` → `pnpm exec tauri build`  

若 cargo「拒绝访问」：

```powershell
$env:CARGO_TARGET_DIR="<writable-target-dir>"
pnpm build:release:oss-unsigned
```

正式签名包 / 商业 `zh-CN-virmoor`：仅私有 `web/xu-desktop` 的 `pnpm build:release`。

### 5. 不要做什么

- 勿提交真实 `.env` / 证书 / 构建出的 `*.xupack`  
- 勿把 market 岗或 `zh-CN-virmoor` 拷进公开仓  
- 勿未经授权 push 陌生公开远程  

### 6. API

账号 / 更新 / 商店：自建后端；`.env` 中配置，示例为 `xxx.com`。

---

## English

Dev: copy `.env.example` → local env (`xxx.com` placeholders), `pnpm i`, `pnpm tauri:dev`.  
Installer: `pnpm build:release:oss-unsigned` builds the ~461-role zh-virmoon demo pack then unsigned NSIS.  
QQ: **1102740387**. AGPL-3.0.
