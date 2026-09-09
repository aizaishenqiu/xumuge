# 虚募阁（Virmoor）· 开源桌面端

面向普通用户的 AI 公司桌面客户端：零配置安装、办公室沉浸、岗位化派活。

- **代码许可**：[AGPL-3.0](LICENSE)（与上级 [opensource/LICENSE](../LICENSE) 一致）
- **演示岗位**：`role-packs-src/zh-virmoon`（约 461，非 market）
- **社区 QQ**：1102740387

## 重要说明

| 包含在本仓库 | 不包含 |
|--------------|--------|
| 客户端源码（白名单导出） | 官网 / Go API / 管理端 |
| `zh-virmoon` 演示岗包源 | 商业 `zh-CN-virmoor` / market 岗 |
| 轻量 `demo-skills/` | 生产密钥、签名证书 |

构建出的 `.xupack` 二进制默认 gitignore；请本地 `pnpm build:role-pack:full` 或 `pnpm build:release:oss-unsigned`。

## 快速开始

见上级 [DEVELOPING.md](../DEVELOPING.md) / [USAGE.md](../USAGE.md)。

```bash
cp .env.example .env.development   # 占位 xxx.com
pnpm i
pnpm tauri:dev
pnpm build:release:oss-unsigned
```
