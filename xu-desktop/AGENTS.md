# Virmoor Desktop (open-source export)

This tree is an **allowlisted** export of the Virmoor desktop client.

- License: AGPL-3.0 (see `../LICENSE`)
- Demo roles: `role-packs-src/zh-virmoon` (~461 non-market) + `../demo-skills/`
- Do **not** commit real `.env`, certificates, or built `*.xupack`
- Configure API URLs via `.env.example` placeholders (`xxx.com`)

Build: see `package.json` (`pnpm i`, `pnpm tauri:dev`, `pnpm build:release:oss-unsigned`).
Docs: `../DEVELOPING.md`, `../USAGE.md`.
QQ: 1102740387
