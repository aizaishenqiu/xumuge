# 虚募阁 Virmoor · Wiki 开发文档首页

> 和你的 AI 公司说话｜问询 · 计划 · 智能体  
> 仓库：https://gitee.com/jiukakeji/xumuge  
> 官网：https://xumuge.com  
> **社区 QQ 群：`1102740387`**

本 Wiki 面向**开发者**：从环境搭建到代码结构、路由、HTTP、Tauri/Rust、岗位包与打包。产品介绍请看仓库 [README.zh-CN.md](https://gitee.com/jiukakeji/xumuge/blob/main/README.zh-CN.md)。

许可：**AGPL-3.0** · 个人使用不受限制；禁止未经授权的商用 SaaS / 付费托管（见仓库 NOTICE）。

## 文档目录

| 页面 | 内容 |
|------|------|
| [01-环境与构建](01-环境与构建) | Node/pnpm/Rust、本地调试、OSS 打包 |
| [02-仓库目录与技术栈](02-仓库目录与技术栈) | 顶层布局、依赖与脚本 |
| [03-前端代码结构](03-前端代码结构) | `src/` 模块划分与约定 |
| [04-路由与页面](04-路由与页面) | Vue Router 路径与页面对应 |
| [05-HTTP与鉴权](05-HTTP与鉴权) | `request.ts`、Token、错误弹窗 |
| [06-Tauri与Rust](06-Tauri与Rust) | `src-tauri`、命令与本机能力 |
| [07-岗位包构建](07-岗位包构建) | `zh-virmoon`、`.xupack`、oss-unsigned |
| [08-环境变量](08-环境变量) | `.env.example` 与 `appEnv.ts` |
| [09-常见问题](09-常见问题) | rg.exe、Cargo 拒绝访问等 |

## 30 秒上手

**最终用户（安装包）：**  
下载 [虚募阁_1.0.2_x64-setup.exe](https://gitee.com/jiukakeji/xumuge/releases/download/%E8%99%9A%E5%8B%9F%E9%98%81%E4%B8%80%E4%BA%BAAI%E5%85%AC%E5%8F%B8%E6%A1%8C%E9%9D%A2%E7%AB%AF/%E8%99%9A%E5%8B%9F%E9%98%81_1.0.2_x64-setup.exe)（Gitee 直链）。

**开发者：**

```bash
git clone https://gitee.com/jiukakeji/xumuge.git
cd xumuge/xu-desktop
cp .env.example .env.development
pnpm i
pnpm tauri:dev
```

使用 **pnpm**，不要用 npm 作为主包管理器。
