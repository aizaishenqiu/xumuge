# Exclusions · 硬红线（一点不准传过去）

> If it appears in this list, it must **never** enter a public git tree derived from this staging area.

## 中文 · 整模块禁止

| 路径 / 形态 | 原因 |
|-------------|------|
| `server/` | Go API / 运营后端，不开源 |
| `web/xu-web-front/` | 官网，不开源 |
| `web/xu-web-server/` | 底座与管理端，不开源 |
| 主仓根 `docs/**` | 私有规划（开源树可保留 `xu-desktop/docs/config/taxonomy-*.json`） |
| `web/xu-desktop/docs/**`（除 `docs/config/*.json`） | 应用内 help / design / audits |
| `.cursor/**` | Agent 规则，不开源 |

## 中文 · 密钥与证书（L0）

| 路径 / 形态 | 原因 |
|-------------|------|
| 真实 `.env` / `.env.production` / `.env.local` | 密钥 |
| `*.pem` `*.key` `*.p12` `*.pfx` | 私钥与证书 |
| `src-tauri/certificates/` | 代码签名 |
| `XU_PACK_KEY` 及任何 pack 主密钥 | 可解商业岗位包 |

## 中文 · 商业 / 非 demo 岗包（L1）

| 路径 / 形态 | 原因 |
|-------------|------|
| `role-packs-src/zh-CN` / `zh-CN-virmoor` / `zh-virmoon` **全量含 market** | 超出开源 461 子集 |
| `originSource: market` 的岗位 MD | 不开源 |
| 已构建的 `full*.xupack` / `dev.full*.xupack` | 二进制不进公开 git（本地构建可有） |
| `tools/license-server/data/**` | 已发卡与主密钥 |
| `commercial-plugins-src/` `*.foubiz` | 商业插件 |

**允许例外**：`opensource/xu-desktop/role-packs-src/zh-virmoon/**` 中 **非 market** 约 461 岗。

## 中文 · 构建与运行时

| 路径 / 形态 | 原因 |
|-------------|------|
| `node_modules/` `dist/` `**/target/` | 构建产物 |
| 安装包 `*.exe` `*.msi` 等 | 发布物（`rg.exe` sidecar 除外） |
| 用户本机运行时数据 | 永不进 git |

## English

- Never publish market roles, `zh-CN-virmoor`, production secrets, or built commercial `.xupack` into public git.
- Open-source demo roles = non-market `zh-virmoon` subset (~461) only.
- Website / Go API / admin stay closed.
