#!/usr/bin/env node
/**
 * @file stdio MCP：Blender 脚本宿主（ping / eval / open / save / export / preview）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 0.1.0
 * @category Parse
 * @algo stdio-mcp-jsonrpc
 */
import readline from "readline";
import {
  blenderPing,
  blenderEval,
  blenderOpen,
  blenderSave,
  blenderExport,
  blenderRenderPreview,
} from "./blender_runner.mjs";

const ALLOWED = (process.env.XU_ALLOWED_ROLES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function roleAllowed() {
  if (!ALLOWED.length) return true;
  const role = (process.env.XU_EMPLOYEE_ROLE || "").trim();
  if (!role) return false;
  return ALLOWED.some((p) => {
    if (p.endsWith("*")) return role.startsWith(p.slice(0, -1));
    return role === p || role.includes(p);
  });
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function guardRole() {
  if (!roleAllowed()) {
    throw new Error("当前岗位无权使用 Blender 三维宿主");
  }
}

const tools = [
  {
    name: "blender_ping",
    description: "探测本机 Blender 是否可用，返回版本与当前工作区根",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string", description: "工作区绝对路径（虚募阁可自动注入）" },
      },
    },
  },
  {
    name: "blender_eval",
    description: "【须审批】在 Blender 后台执行短 Python（bpy）；有超时与危险片段拦截",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        code: { type: "string", description: "短 Python 源码" },
        blend: { type: "string", description: "可选：工作区内已有 .blend 相对路径" },
        timeoutMs: { type: "number" },
      },
      required: ["code"],
    },
  },
  {
    name: "blender_open",
    description: "后台打开工作区内 .blend 并回报对象数量",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        path: { type: "string", description: "工作区相对 .blend" },
      },
      required: ["path"],
    },
  },
  {
    name: "blender_save",
    description: "【须审批】将当前场景（或 from 指定 .blend）另存到工作区路径",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        path: { type: "string", description: "目标 .blend 相对路径" },
        blend: { type: "string", description: "可选源 .blend" },
      },
      required: ["path"],
    },
  },
  {
    name: "blender_export",
    description: "【须审批】导出 FBX/GLB/OBJ 到工作区",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        path: { type: "string", description: "导出相对路径" },
        format: { type: "string", enum: ["fbx", "glb", "gltf", "obj"] },
        blend: { type: "string", description: "可选源 .blend" },
        timeoutMs: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "blender_render_preview",
    description: "【须审批】低分辨率预览渲染到工作区 PNG",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        path: { type: "string", description: "默认 deliverables/blender_preview.png" },
        blend: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        timeoutMs: { type: "number" },
      },
    },
  },
];

function handleToolsCall(name, args) {
  guardRole();
  const a = args || {};
  if (name === "blender_ping") {
    return { content: [{ type: "text", text: JSON.stringify(blenderPing(a), null, 2) }] };
  }
  if (name === "blender_eval") {
    return { content: [{ type: "text", text: JSON.stringify(blenderEval(a), null, 2) }] };
  }
  if (name === "blender_open") {
    return { content: [{ type: "text", text: JSON.stringify(blenderOpen(a), null, 2) }] };
  }
  if (name === "blender_save") {
    return { content: [{ type: "text", text: JSON.stringify(blenderSave(a), null, 2) }] };
  }
  if (name === "blender_export") {
    return { content: [{ type: "text", text: JSON.stringify(blenderExport(a), null, 2) }] };
  }
  if (name === "blender_render_preview") {
    return {
      content: [{ type: "text", text: JSON.stringify(blenderRenderPreview(a), null, 2) }],
    };
  }
  throw new Error(`unknown tool: ${name}`);
}

const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "xu-mcp-blender-host", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }
  if (method === "tools/call") {
    try {
      const result = handleToolsCall(params?.name, params?.arguments || {});
      send({ jsonrpc: "2.0", id, result });
    } catch (e) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: String(e?.message || e) },
      });
    }
    return;
  }
  if (id != null) {
    send({ jsonrpc: "2.0", id, result: {} });
  }
});
