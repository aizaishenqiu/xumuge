# Allowlist · 公开仓允许进入的路径

> Staging tree: `opensource/`  
> Anything not listed here must not be copied into a public git tree.

## 中文

| 路径 | 说明 |
|------|------|
| `opensource/README.md` | 中英简介 |
| `opensource/LICENSE` | **AGPL-3.0** |
| `opensource/NOTICE` | 商标与保留声明 |
| `opensource/OPEN_SOURCE.md` | 开源模式 |
| `opensource/USAGE.md` / `DEVELOPING.md` | 使用与开发 |
| `opensource/ALLOWLIST.md` / `EXCLUSIONS.md` | 白名单 / 红线 |
| `opensource/.gitignore` | 防误提交 |
| `opensource/demo-skills/**` | 轻量 demo Skill |
| `opensource/xu-desktop/**` | 剥离后的桌面源码 |
| `opensource/xu-desktop/role-packs-src/zh-virmoon/**` | **约 461** 非 market 演示岗位 MD |

**导出：**

```bash
node scripts/export-opensource-desktop.mjs
# 或仅岗包：
node scripts/lib/copy-zh-virmoon-oss-demo.mjs
```

## English

Public git may include bilingual notices, `demo-skills/`, stripped `xu-desktop/`, and **non-market** `role-packs-src/zh-virmoon` (~461). License: AGPL-3.0.
