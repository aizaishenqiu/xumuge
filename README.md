# 虚募阁 Virmoor
> 和你的AI公司说话｜问询 · 计划 · 智能体
> Talk to your AI Company | Inquiry · Plan · Agent
官网 / Website：[https://xumuge.com](https://xumuge.com)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![status](https://img.shields.io/badge/status-early--preview-orange)]()

> ⚠️ 资产开源边界说明 | Open Source Boundary Notice
> 本仓库开放**虚募阁 Virmoor 桌面客户端源代码**（ASGPL 3.0协议），包含UI渲染、三闸门执行引擎、文件审批、工作区管理等程序逻辑。
> **AI员工岗位模型、岗位提示词模板库、岗位知识库、后端账号服务、私有向量数据不属于本仓库开源内容，闭源，不随代码一同开源。**
> 编译运行开源代码后，部分AI员工相关功能需要对接私有资产服务才能完整使用。
>
> This repository open sources the source code of Virmoor desktop client (MIT License), including UI rendering, three-gate execution engine, file approval, workspace management and other program logic.
> **AI staff job models, prompt template library, job knowledge base, backend account service and private vector data are NOT open-sourced. They are closed-source assets and not distributed together with the code.**
> After compiling and running the open-source code, some AI-staff related features require connection to the private asset service to work fully.

> ⚠️ Important：本项目为**早期预览版本**，仍在持续打磨。存在功能异常、适配卡顿、未知Bug，不建议直接用于生产环境，使用前请阅读完整免责声明 [DISCLAIMER.md](./DISCLAIMER.md)
> ⚠️ Important：This project is an **early preview release** and still under active development. Bugs, compatibility issues and performance defects may exist. It is NOT recommended for production use. Please read [DISCLAIMER.md](./DISCLAIMER.md) before use.

## 📖 项目介绍 | Introduction
虚募阁 Virmoor 是面向本地工作流的AI智能体桌面客户端。
设计核心思想：**不让AI随意改动你的本地文件，所有写文件操作必须经过用户批准确认**。

分为三道工作闸门：
- **问询 Inquiry**：仅回答问题，完全不触碰磁盘；适合咨询用法、评估方案可行性。
- **计划 Plan**：输出执行步骤、风险点、验收标准；只做方案推演，不执行、不改文件。
- **智能体 Agent**：实际动手执行任务；修改本地文件前会弹出对话框等待用户点击同意，不是终端输入Y确认。

> 网页官网仅做展示大厅示意，截图、语音、本地文件读写、审批闸门全部能力，仅在桌面端完整实现。网页版无法完成完整工作流。
>
> The official website is for demonstration only. Screenshot, voice, local file I/O and approval gate capabilities are fully implemented only in the desktop client. The web version cannot run the full workflow.

### ✨ 核心特性 | Core Features
1. 三闸门隔离：问询 / 计划 / 智能体，能力逐级开放，防止误操作。
   Three-gate isolation: Inquiry / Plan / Agent. Capabilities are unlocked step by step to avoid accidental operations.
2. 文件变更强确认：智能体写盘必须弹窗由用户手动批准。
   Mandatory approval for file changes: Agent can only write files after user manually approves in popup dialog.
3. 办公室视图：可视化查看任务状态、哪些任务等待审批、进行中任务。
   Office view: Visualize task status, pending approval tasks and running tasks.
4. 项目&工作区管理：任务列表管理，代码修改从对话打开工作区，首页不是IDE。
   Project & workspace management: Task list management, open workspace from conversation, not IDE-first UI.
5. 云账号打通：官网注册账号，桌面端直接登录使用。
   Cloud account integration: Register account on official website and sign in directly in desktop client.

## 🖥️ 最终用户快速上手 | End User Quick Start
1. 官网注册账号 | Register account on official website
2. 下载并安装虚募阁桌面端 | Download & install Virmoor desktop client
3. 使用流程：优先使用【问询】→产出方案后切换【计划】评估风险 → 用户确认后启用【智能体】执行
> 不要跳过计划直接启用智能体执行文件修改操作。
>
> Workflow: Start with【Inquiry】→ Switch to【Plan】to evaluate risks after solution is generated → Enable【Agent】for execution after user confirmation.
> Do NOT skip Plan phase and directly run Agent to modify files.

## 🛠️ 开发者构建&运行 | Build & Run for Developers
> 开源代码仅包含客户端程序引擎；AI员工岗位数据、岗位Prompt库为闭源资产，本仓库不提供。
> 编译后客户端可以本地调试基础对话、文件审批闸门能力；完整AI员工岗位能力需要对接私有后端资产接口。
>
> The open-source code only contains client engine. AI staff job data and prompt library are closed-source assets and not included in this repo.
> After compilation, you can debug basic conversation and file approval gates locally. Full AI staff capabilities require connecting to private backend asset API.

```bash
# 1.克隆仓库 | Clone repository
git clone https://gitee.com/jiukakeji/xumuge.git
cd xumuge

# 2.安装依赖 | Install dependencies
npm install

# 3.本地开发调试 | Local dev server
npm run dev

# 4.打包桌面客户端 | Build desktop package
npm run build
