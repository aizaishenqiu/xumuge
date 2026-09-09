# Xu AI Employee（完全脱离 Hermes）

本目录为方案 C 落地包，见 [`docs/design/2026-08-21-fou-ai-employee-runtime.md`](../../docs/design/2026-08-21-fou-ai-employee-runtime.md)。

## 模块

| 文件 | 职责 | 禁止 |
|------|------|------|
| `roster.ts` | 花名册 CRUD | Agent / Hermes |
| `policy.ts` | 工作区策略前缀 | LLM |
| `brains.ts` | 解析端点（只读 xu.db） | `set_hermes_model` / config.yaml |
| `session.ts` | 员工↔Xu session | Hermes state.db 当真源 |
| `dispatch.ts` | 派活 → `xu_emp_dispatch_task` | `hermes chat` |
| `agent.ts` | 订阅 `xu:chunk` 流式事件 | Hermes 事件桥 |
| `memory.ts` | 虚募阁记忆 CRUD / preamble | Hermes MEMORY.md |

## 使用

```ts
import { dispatchEmployeeTask, listenFouChunks, upsertMemory } from "../employee";

await upsertMemory({ scope: "global", title: "偏好", body: "回复用中文" });
await dispatchEmployeeTask(emp, { task: "在工作区写 README 大纲" });
```

## 现状（B-P1 + A0–A2）

- Rust Agent：`list_dir` / `read_file` / `write_file`（写仅工作区；读含 readExtra）
- 派活注入 `build_memory_preamble`；表 `memories`；命令 `xu_list/upsert/delete_memory`
- UI：`#/memory` → `MemoryPage.vue`（新建/编辑/导入 Hermes/预览注入）
- 办公室条显示工具调用摘要
- 尚未：shell 工具、删 Hermes Chat 桥 / Dashboard

旧路径 `utils/employeeTask.ts` / `opsBrains.applyEmployeeBrain` 仅供迁移。
