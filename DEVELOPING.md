# Developing · 开源版开发文档

社区 QQ 群：**1102740387**

**详细开发代码说明（推荐）：**

- 仓库内：[wiki/Home.md](./wiki/Home.md)（完整目录）  
- Gitee Wiki：https://gitee.com/jiukakeji/xumuge/wikis  

产品介绍：[README.zh-CN.md](./README.zh-CN.md) · [README.en.md](./README.en.md)

---

## 快速开始

```bash
git clone https://gitee.com/jiukakeji/xumuge.git
cd xumuge/xu-desktop
cp .env.example .env.development
pnpm i
pnpm tauri:dev
```

打包（未签名）：`pnpm build:release:oss-unsigned`

## Wiki 章节

| 文档 | 内容 |
|------|------|
| [wiki/01-环境与构建.md](./wiki/01-环境与构建.md) | 环境、调试、OSS 打包 |
| [wiki/02-仓库目录与技术栈.md](./wiki/02-仓库目录与技术栈.md) | 目录与技术栈 |
| [wiki/03-前端代码结构.md](./wiki/03-前端代码结构.md) | `src/` 模块 |
| [wiki/04-路由与页面.md](./wiki/04-路由与页面.md) | 路由表 |
| [wiki/05-HTTP与鉴权.md](./wiki/05-HTTP与鉴权.md) | request / Token |
| [wiki/06-Tauri与Rust.md](./wiki/06-Tauri与Rust.md) | Native / Agent |
| [wiki/07-岗位包构建.md](./wiki/07-岗位包构建.md) | zh-virmoon / xupack |
| [wiki/08-环境变量.md](./wiki/08-环境变量.md) | `.env` |
| [wiki/09-常见问题.md](./wiki/09-常见问题.md) | FAQ |

## 使用范围

个人使用不受限制；禁止未经授权的商用 SaaS / 付费托管。见 [NOTICE](./NOTICE)。

## English (short)

Full developer docs: [wiki/Home.md](./wiki/Home.md). QQ: **1102740387**. Use **pnpm**. `pnpm tauri:dev` · `pnpm build:release:oss-unsigned`.
