# 虚募阁（Virmoor）· 开源桌面端

- **代码许可**：[AGPL-3.0](LICENSE)（与上级 [opensource/LICENSE](../LICENSE) 一致）
- **演示岗位**：`role-packs-src/zh-virmoon`（约 461）
- **社区 QQ**：1102740387

## 说明

本目录为桌面客户端源码（白名单导出）与演示岗包。构建出的 `.xupack` 默认 gitignore；请本地 `pnpm build:role-pack:full` 或 `pnpm build:release:oss-unsigned`。

个人使用不受限制；禁止未经授权的商用 SaaS 等运营，见上级 [NOTICE](../NOTICE) / [README.zh-CN.md](../README.zh-CN.md)。

## 快速开始

见上级 [DEVELOPING.md](../DEVELOPING.md) / [USAGE.md](../USAGE.md)。

```bash
cp .env.example .env.development
pnpm i
pnpm tauri:dev
pnpm build:release:oss-unsigned
```
