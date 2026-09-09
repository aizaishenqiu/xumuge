# 虚募阁 Virmoor · 开源仓库

**语言 / Language：** [中文](#中文) · [English](#english)

和你的 AI 公司说话｜问询 · 计划 · 智能体  
Talk to your AI Company | Inquiry · Plan · Agent  

官网 / Website：https://xumuge.com  
社区 QQ：**1102740387**  

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![status](https://img.shields.io/badge/status-early--preview-orange)](DISCLAIMER.md)

---

<a id="中文"></a>

## 中文

**语言：** [中文](#中文) · [English](#english)

### 资产开源边界说明

本仓库开放虚募阁 Virmoor **桌面客户端**源代码（**AGPL-3.0**），包含 UI 渲染、三闸门执行引擎、文件审批、工作区管理等程序逻辑，以及演示用岗位源 `xu-desktop/role-packs-src/zh-virmoon`（约 **461** 岗，非 market）。

以下内容**不属于**本仓库完整商业资产，**不随商业闭源包一并开源**：

- 商业全量岗位树（如 `zh-CN-virmoor`）、market 岗、商业 `.xupack` 制品  
- 后端账号 / 发证服务、私有向量与运营数据  
- 官网与管理端  

编译运行开源代码后，基础对话、文件审批闸门与演示岗包可本地使用；云账号、检查更新、完整商店能力等需对接自建或官方后端（见 `.env.example` 占位域名 `xxx.com`）。

更多： [OPEN_SOURCE.md](./OPEN_SOURCE.md) · [ALLOWLIST.md](./ALLOWLIST.md) · [EXCLUSIONS.md](./EXCLUSIONS.md) · [LICENSE](./LICENSE) · [NOTICE](./NOTICE)

> **Important：** 本项目为早期预览版本，仍在持续打磨。存在功能异常、适配卡顿、未知 Bug，**不建议直接用于生产环境**。使用前请阅读完整免责声明 [DISCLAIMER.md](./DISCLAIMER.md)。

### 项目介绍

虚募阁 Virmoor 是面向本地工作流的 AI 智能体桌面客户端。设计核心思想：**不让 AI 随意改动你的本地文件**，所有写文件操作必须经过用户批准确认。

分为三道工作闸门：

1. **问询 Inquiry**：仅回答问题，完全不触碰磁盘；适合咨询用法、评估方案可行性。  
2. **计划 Plan**：输出执行步骤、风险点、验收标准；只做方案推演，不执行、不改文件。  
3. **智能体 Agent**：实际动手执行任务；修改本地文件前会弹出对话框等待用户点击同意（不是终端输入 Y 确认）。

网页官网仅做展示大厅示意。截图、语音、本地文件读写、审批闸门等能力**仅在桌面端完整实现**；网页版无法完成完整工作流。

### 核心特性

| 特性 | 说明 |
|------|------|
| 三闸门隔离 | 问询 / 计划 / 智能体，能力逐级开放，防止误操作 |
| 文件变更强确认 | 智能体写盘必须弹窗由用户手动批准 |
| 办公室视图 | 可视化任务状态、待审批与进行中任务 |
| 项目与工作区 | 任务列表管理；从对话打开工作区；首页不是 IDE |
| 云账号打通 | 官网注册账号，桌面端登录使用（需配置账号服务） |

### 最终用户快速上手

1. 在官网注册账号：https://xumuge.com  
2. 下载并安装虚募阁桌面端（正式安装包见官网；本仓库可自行用下方命令打未签名开源包）  
3. 使用流程：优先【问询】→ 产出方案后切换【计划】评估风险 → 用户确认后再启用【智能体】执行  

**不要**跳过计划，直接启用智能体执行文件修改。

### 开发者构建与运行（pnpm）

本仓库使用 **pnpm**（不是 npm）。开源树根目录含说明文档；桌面工程在 `xu-desktop/`。

```bash
# 1. 克隆仓库
git clone https://gitee.com/jiukakeji/xumuge.git
cd xumuge

# 2. 进入桌面工程并安装依赖
cd xu-desktop
cp .env.example .env.development   # 按需改 API；占位 xxx.com 非真实服务
pnpm i

# 3. 本地开发调试（Tauri 桌面）
pnpm tauri:dev

# 4. 打包 Windows 开源安装包（无签名；会先编译 zh-virmoon 演示岗包）
pnpm build:release:oss-unsigned
```

更细步骤与 FAQ（`rg.exe`、`CARGO_TARGET_DIR` 等）：[DEVELOPING.md](./DEVELOPING.md) · [USAGE.md](./USAGE.md)

### 仓库结构（摘要）

| 路径 | 说明 |
|------|------|
| `xu-desktop/` | 桌面客户端源码 |
| `xu-desktop/role-packs-src/zh-virmoon/` | 演示岗位 MD（约 461） |
| `demo-skills/` | 轻量 Skill 样例 |
| `LICENSE` / `NOTICE` / `DISCLAIMER.md` | AGPL-3.0 与免责声明 |

---

<a id="english"></a>

## English

**Language:** [中文](#中文) · [English](#english)

Talk to your AI Company | Inquiry · Plan · Agent  

Website: https://xumuge.com · QQ: **1102740387** · License: **AGPL-3.0**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![status](https://img.shields.io/badge/status-early--preview-orange)](DISCLAIMER.md)

### Open Source Boundary Notice

This repository open-sources the **Virmoor desktop client** (**AGPL-3.0**): UI, three-gate execution engine, file approval, workspace management, plus demo roles under `xu-desktop/role-packs-src/zh-virmoon` (~**461** non-market roles).

**Not** included as commercial open assets:

- Full commercial role trees (e.g. `zh-CN-virmoor`), market roles, commercial `.xupack` artifacts  
- Backend account / licensing services, private vector / ops data  
- Marketing site and admin consoles  

After building, you can run local chat, approval gates, and the demo pack. Cloud login / updates / store features need your own or official APIs (see `.env.example` placeholders on `xxx.com`).

See [OPEN_SOURCE.md](./OPEN_SOURCE.md), [ALLOWLIST.md](./ALLOWLIST.md), [EXCLUSIONS.md](./EXCLUSIONS.md).

> **Important:** Early preview. Bugs and compatibility issues may exist — **not** for production. Read [DISCLAIMER.md](./DISCLAIMER.md).

### Introduction

Virmoor is a local-workflow AI agent desktop client. Core idea: **AI must not freely rewrite your disk** — every write requires explicit user approval.

Three gates:

1. **Inquiry** — answers only; never touches disk.  
2. **Plan** — steps, risks, acceptance criteria; no execution.  
3. **Agent** — executes; file writes require a **popup approval** (not a terminal `Y`).

The website is a showcase lobby. Screenshot, voice, local I/O and approval gates are complete **only** on desktop.

### Core Features

- Three-gate isolation (Inquiry / Plan / Agent)  
- Mandatory popup approval for Agent file writes  
- Office view for task / approval status  
- Project & workspace management (home is not an IDE)  
- Cloud account sign-in when account API is configured  

### End User Quick Start

1. Register at https://xumuge.com  
2. Install the desktop client (or build the unsigned OSS installer below)  
3. Workflow: **Inquiry** → **Plan** → then **Agent**. Do **not** skip Plan before file changes.

### Build & Run (pnpm)

This repo uses **pnpm**, not npm. App code lives in `xu-desktop/`.

```bash
git clone https://gitee.com/jiukakeji/xumuge.git
cd xumuge/xu-desktop
cp .env.example .env.development
pnpm i
pnpm tauri:dev
pnpm build:release:oss-unsigned
```

Details: [DEVELOPING.md](./DEVELOPING.md) · [USAGE.md](./USAGE.md)
