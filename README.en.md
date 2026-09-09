# Virmoor · English Guide

**Language:** [简体中文](./README.zh-CN.md) · [English](./README.en.md)

Talk to your AI Company | Inquiry · Plan · Agent  

Website: https://xumuge.com  

## Community & Contact

| Channel | Info |
|---------|------|
| **QQ group** | **`1102740387`** (please note: open-source / Virmoor) |
| Website | https://xumuge.com |
| License | [AGPL-3.0](./LICENSE) · [NOTICE](./NOTICE) |
| Disclaimer | [DISCLAIMER.md](./DISCLAIMER.md) |

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![QQ Group](https://img.shields.io/badge/QQ-1102740387-12B7F5)](#community--contact)
[![status](https://img.shields.io/badge/status-early--preview-orange)](DISCLAIMER.md)

---

## 1. Open Source Boundary

This repository open-sources the Virmoor **desktop client** (**AGPL-3.0**): UI, three-gate engine, file approval, workspaces, office, agency UI, voice, connectors, plus demo roles:

- `xu-desktop/role-packs-src/zh-virmoon` (~**461** non-market roles)

**Still closed / separately licensed:**

- Full commercial trees (e.g. `zh-CN-virmoor`), market roles, commercial `.xupack`  
- Account / licensing backends, private vectors / ops data  
- Website, admin consoles, commercial `.foubiz` plugins  

After building you can use gates, write approvals, the demo pack, and most UI locally. Cloud login, updates, and full store need your own or official APIs (`xu-desktop/.env.example` uses `xxx.com` placeholders).

See [OPEN_SOURCE.md](./OPEN_SOURCE.md), [ALLOWLIST.md](./ALLOWLIST.md), [EXCLUSIONS.md](./EXCLUSIONS.md).

> **Important:** Early preview — **not** for production. Read [DISCLAIMER.md](./DISCLAIMER.md).

---

## 2. Introduction

Virmoor is a **local-workflow** AI agent desktop client. Core idea:

**AI must not freely rewrite your disk — every write needs a popup approval.**

### Three gates

| Gate | Role |
|------|------|
| **Inquiry** | Answers only; no disk writes |
| **Plan** | Steps, risks, acceptance criteria; no execution |
| **Agent** | Executes; file writes require a **dialog approval** (not terminal `Y`) |

Also: read-only “vulnerability” diagnostics, multi-session Agent, and auto routing by phrasing. The website is a showcase lobby — full I/O and gates exist **only** on desktop.

Recommended flow: **Inquiry → Plan → Agent**. Do not skip Plan before file changes.

---

## 3. Detailed Features

### 3.1 Account, startup, help

- Cloud login (configure account API)  
- Onboarding for three-brain setup  
- In-app help, updater, feedback  

### 3.2 Home chat & gates

- Inquiry / Plan / Agent / vulnerability modes  
- Multi-task sessions; auto routing  
- Role experts from the agency library  
- Default permissions vs full-access trust mode  
- Three brains (commander / worker / code); local & remote, verified models only  
- Context compression; Codex-style patch review with undo  
- Attachments, “remember”, region screenshots  
- Conversation-first home; open full-screen IDE on demand  

### 3.3 Built-in IDE

- Editor, terminal, file tree  
- Optional drive to local Cursor / VS Code CLI  
- Playwright QA; advanced / autopilot features (experimental, gated)  

### 3.4 Canvas

- Vector sketch (export PNG / PDF / SVG / DXF, etc.)  
- Chat-directed drawing  
- Flowcharts, Gantt-style previews, asset library  

### 3.5 Voice

- Full-screen voice call with subtitles  
- Push-to-talk input; wake word  
- Multi-engine TTS (system / Kokoro / CosyVoice, optional packs)  

### 3.6 Projects & office

- Industry-filtered projects; queues and industry pipelines  
- 3D AI office, immersive mode, Brief clarify, kickoff waves  
- Design preview, mid-run steer, release security checklist  

### 3.7 Team, monitor, contacts

- AI team roster; live dispatch monitor; staff DMs  

### 3.8 Agency & packs

- Role browser (~**461** open demo roles in `zh-virmoon`)  
- `.xupack` install/import (commercial full packs not in this repo)  
- Custom roles / user `SKILL.md`  

### 3.9 Memory, MCP, connections

- Markdown memory; “get smarter” distillation  
- MCP tools; Blender / 3ds Max hosts (authorized)  
- Feishu / WeCom inbound & outbound (cautious write policy)  

### 3.10 Settings & more

Company branding, brains, billing, concurrency, guardrails, privacy, security audit, license, shortcuts, personal center, legal; capability packs (`.xucap`), commercial plugins (`.foubiz`), semi-auto leads notes.

---

## 4. End-user quick start

1. Optional: register at https://xumuge.com  
2. Install desktop or build the OSS installer (section 5)  
3. Configure model APIs → Inquiry → Plan → Agent  
4. Join **QQ group `1102740387`** for help  

---

## 5. Build (pnpm)

Use **pnpm**, not npm. App lives in `xu-desktop/`.

```bash
git clone https://gitee.com/jiukakeji/xumuge.git
cd xumuge/xu-desktop
cp .env.example .env.development
pnpm i
pnpm tauri:dev
pnpm build:release:oss-unsigned
```

See [DEVELOPING.md](./DEVELOPING.md) · [USAGE.md](./USAGE.md).

---

## 6. Repository layout

| Path | Purpose |
|------|---------|
| `xu-desktop/` | Desktop sources |
| `xu-desktop/role-packs-src/zh-virmoon/` | Demo roles (~461) |
| `demo-skills/` | Light Skill samples |
| `README.zh-CN.md` / `README.en.md` | Full CN / EN docs |
| `LICENSE` / `NOTICE` / `DISCLAIMER.md` | License & disclaimer |

---

## 7. QQ group (again)

**Group ID: `1102740387`**  
Please mention you came from the open-source repository.
