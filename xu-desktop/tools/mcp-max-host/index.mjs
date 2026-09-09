#!/usr/bin/env node
/**
 * @file stdio MCP：3ds Max 脚本宿主（ping / eval / open / save / export / preview）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-06
 * @version 0.1.0
 * @category Parse
 * @algo stdio-mcp-jsonrpc
 */
import readline from "readline";
import {
  maxPing,
  maxEval,
  maxOpen,
  maxSave,
  maxExportFbx,
  maxRenderPreview,
} from "./max_runner.mjs";

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
    throw new Error("当前岗位无权使用 3ds Max 三维宿主");
  }
}

const tools = [
  {
    name: "max_ping",
    description: "探测本机 3ds Max / 3dsmaxbatch 是否可用（仅 Windows）",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string", description: "工作区绝对路径（虚募阁可自动注入）" },
      },
    },
  },
  {
    name: "max_eval",
    description: "【须审批】执行短 MaxScript 或 Python（pymxs）；有超时与危险片段拦截",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        code: { type: "string" },
        language: { type: "string", enum: ["mxs", "python"], description: "默认 mxs" },
        scene: { type: "string", description: "可选：工作区内已有 .max" },
        timeoutMs: { type: "number" },
      },
      required: ["code"],
    },
  },
  {
    name: "max_open",
    description: "后台打开工作区内 .max 并回报对象数量",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        path: { type: "string", description: "工作区相对 .max" },
      },
      required: ["path"],
    },
  },
  {
    name: "max_save",
    description: "【须审批】将场景另存到工作区 .max",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        path: { type: "string" },
        scene: { type: "string", description: "可选源 .max" },
      },
      required: ["path"],
    },
  },
  {
    name: "max_export_fbx",
    description: "【须审批】导出 FBX 到工作区",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        path: { type: "string" },
        scene: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "max_render_preview",
    description: "【须审批】低分辨率预览渲染到工作区 PNG",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        path: { type: "string", description: "默认 deliverables/max_preview.png" },
        scene: { type: "string" },
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
  if (name === "max_ping") {
    return { content: [{ type: "text", text: JSON.stringify(maxPing(a), null, 2) }] };
  }
  if (name === "max_eval") {
    return { content: [{ type: "text", text: JSON.stringify(maxEval(a), null, 2) }] };
  }
  if (name === "max_open") {
    return { content: [{ type: "text", text: JSON.stringify(maxOpen(a), null, 2) }] };
  }
  if (name === "max_save") {
    return { content: [{ type: "text", text: JSON.stringify(maxSave(a), null, 2) }] };
  }
  if (name === "max_export_fbx") {
    return { content: [{ type: "text", text: JSON.stringify(maxExportFbx(a), null, 2) }] };
  }
  if (name === "max_render_preview") {
    return {
      content: [{ type: "text", text: JSON.stringify(maxRenderPreview(a), null, 2) }],
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
        serverInfo: { name: "xu-mcp-max-host", version: "0.1.0" },
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
