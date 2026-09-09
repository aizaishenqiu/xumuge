# Virmoor / 虚募阁 · Open Source Staging

中文在前 · English below.

**许可证 License：AGPL-3.0** · 社区 QQ 群：**1102740387**

---

## 中文

### 这是什么

本目录是 **虚募阁（Virmoor）桌面端开源交付暂存区**，可直接用于公开 git 上传（勿夹带私有仓其它目录）。

包含：

- 开源模式说明（本文件与 [OPEN_SOURCE.md](./OPEN_SOURCE.md)）
- 许可证 [LICENSE](./LICENSE)（**AGPL-3.0**）与 [NOTICE](./NOTICE)
- 白名单 / 红线：[ALLOWLIST.md](./ALLOWLIST.md)、[EXCLUSIONS.md](./EXCLUSIONS.md)
- **桌面源码**：[xu-desktop/](./xu-desktop/)
- **演示岗位（约 461）**：[xu-desktop/role-packs-src/zh-virmoon](./xu-desktop/role-packs-src/zh-virmoon)（非 market）
- 轻量 Skill：[demo-skills/](./demo-skills/)

**不包含**：官网、Go API、管理端、`zh-CN-virmoor` 商业树、market 岗、生产密钥。

| 文档 | 用途 |
|------|------|
| [USAGE.md](./USAGE.md) | 使用与打包 |
| [DEVELOPING.md](./DEVELOPING.md) | **开源版开发文档** |

### 如何构建

```bash
cd xu-desktop
cp .env.example .env.development   # 占位 xxx.com；勿提交真实密钥
pnpm i
pnpm tauri:dev
pnpm build:release:oss-unsigned    # 未签名 NSIS；先编译 461 岗 demo 包
```

从私有主仓重新导出：

```bash
node scripts/export-opensource-desktop.mjs
```

### 开源模式（一句话）

**桌面运行时 + 约 461 演示岗位按 AGPL-3.0 开源；商业正式岗包、发证与密钥闭源。**

详见 → [OPEN_SOURCE.md](./OPEN_SOURCE.md)

### 社区

QQ 群：**1102740387**

### 边界

- 禁止路径：[EXCLUSIONS.md](./EXCLUSIONS.md)
- API：自建或自行配置；示例域名为 `xxx.com`，非真实服务

---

## English

### What this is

Virmoor **desktop open-source staging** (AGPL-3.0): stripped `xu-desktop/`, ~461 non-market `zh-virmoon` demo roles, bilingual docs. QQ group: **1102740387**.

See [USAGE.md](./USAGE.md) and [DEVELOPING.md](./DEVELOPING.md).
