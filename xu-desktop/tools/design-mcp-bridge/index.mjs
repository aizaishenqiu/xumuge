#!/usr/bin/env node
/**
 * @file stdio MCP：设计交付（UI 资产、导出说明、PS/Corel 脚本模板与执行）
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-02
 * @version 0.3.0
 * @category Parse
 * @algo stdio-mcp-jsonrpc
 */
import fs from "fs";
import path from "path";
import readline from "readline";
import {
  probeDesignApps,
  runPsScript,
  runCorelMacro,
  generateFromTemplate,
  generateAndRunPsExport,
} from "./runner.mjs";

const WORKSPACE = (process.env.XU_WORKSPACE_ROOT || process.cwd()).trim();
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
    throw new Error("当前岗位无权使用设计交付助手");
  }
}

function listUiAssets(root) {
  const uiDir = path.join(root, "UI");
  const out = [];
  const walk = (dir, rel = "") => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs, relPath);
      else if (/\.(png|svg|jpg|jpeg|webp|pdf|md|psd|cdr|ai)$/i.test(name)) {
        out.push({ path: `UI/${relPath}`, bytes: st.size });
      }
    }
  };
  walk(uiDir);
  return out;
}

function exportNotes(root, targetRel) {
  guardRole();
  const assets = listUiAssets(root);
  const lines = [
    "# 设计导出说明",
    "",
    "## UI 资产",
    "",
    ...assets.map((a) => `- ${a.path} (${a.bytes} B)`),
    "",
    "## 建议步骤",
    "",
    "1. 在 Photoshop / CorelDRAW 打开源稿（若有）。",
    "2. 使用设计交付助手的批导出脚本（须审批）或手工导出到 UI/。",
    "3. 勿用键鼠自动化点设计软件菜单。",
    "",
  ];
  if (targetRel) {
    const outPath = path.join(root, targetRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join("\n"), "utf8");
    return { written: targetRel, assetCount: assets.length };
  }
  return { assetCount: assets.length, preview: lines.join("\n").slice(0, 2000) };
}

function assetPaths(root) {
  return listUiAssets(root).map((a) => a.path);
}

function generatePsScript(root, relPath, templateName = "export_png_batch.jsx") {
  guardRole();
  const target = relPath || "UI/scripts/export_batch.jsx";
  return generateFromTemplate(root, templateName, target, assetPaths(root));
}

function generateCorelVba(root, relPath, templateName = "corel_export_bitmap.bas") {
  guardRole();
  const target = relPath || "UI/scripts/corel_export.bas";
  return generateFromTemplate(root, templateName, target, assetPaths(root));
}

const tools = [
  {
    name: "list_ui_assets",
    description: "列出项目 UI 目录下的交付资产",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "write_export_notes",
    description: "生成设计导出说明 markdown",
    inputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "默认 docs/DESIGN_EXPORT.md" },
      },
    },
  },
  {
    name: "probe_design_apps",
    description: "探测本机 Photoshop / CorelDRAW 是否可用（不启动批处理）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "generate_ps_export_script",
    description: "生成 Photoshop ExtendScript 批导出脚本（只落盘，不执行 PS）",
    inputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "默认 UI/scripts/export_batch.jsx" },
        template: {
          type: "string",
          enum: ["export_png_batch", "export_svg_slice", "normalize_layers"],
          description: "模板名（不含扩展名）",
        },
      },
    },
  },
  {
    name: "generate_corel_vba_stub",
    description: "生成 CorelDRAW VBA 宏（只落盘，不执行 Corel）",
    inputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "默认 UI/scripts/corel_export.bas" },
        template: {
          type: "string",
          enum: ["corel_export_bitmap", "corel_normalize_names"],
        },
      },
    },
  },
  {
    name: "run_ps_script",
    description: "【须审批】执行工作区内 .jsx 脚本（启动 Photoshop COM/CLI）",
    inputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "工作区相对路径，如 UI/scripts/export_batch.jsx" },
      },
      required: ["relativePath"],
    },
  },
  {
    name: "run_corel_macro",
    description: "【须审批】执行 Corel VBA 宏文件或已注册宏名",
    inputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "工作区 .bas 路径" },
        macroName: { type: "string", description: "已导入宏名（与 relativePath 二选一）" },
      },
    },
  },
  {
    name: "generate_and_run_ps_export",
    description: "【须审批】生成 PNG 批导出脚本并立即执行",
    inputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "默认 UI/scripts/export_batch.jsx" },
      },
    },
  },
];

function handleToolsCall(name, args) {
  if (name === "list_ui_assets") {
    guardRole();
    return { content: [{ type: "text", text: JSON.stringify(listUiAssets(WORKSPACE), null, 2) }] };
  }
  if (name === "write_export_notes") {
    const rel = (args?.relativePath || "docs/DESIGN_EXPORT.md").trim();
    return { content: [{ type: "text", text: JSON.stringify(exportNotes(WORKSPACE, rel), null, 2) }] };
  }
  if (name === "probe_design_apps") {
    guardRole();
    return { content: [{ type: "text", text: JSON.stringify(probeDesignApps(), null, 2) }] };
  }
  if (name === "generate_ps_export_script") {
    const rel = (args?.relativePath || "UI/scripts/export_batch.jsx").trim();
    const tpl = (args?.template || "export_png_batch").trim() + ".jsx";
    return {
      content: [{ type: "text", text: JSON.stringify(generatePsScript(WORKSPACE, rel, tpl), null, 2) }],
    };
  }
  if (name === "generate_corel_vba_stub") {
    const rel = (args?.relativePath || "UI/scripts/corel_export.bas").trim();
    const tpl = (args?.template || "corel_export_bitmap").trim() + ".bas";
    return {
      content: [{ type: "text", text: JSON.stringify(generateCorelVba(WORKSPACE, rel, tpl), null, 2) }],
    };
  }
  if (name === "run_ps_script") {
    guardRole();
    const rel = (args?.relativePath || "").trim();
    if (!rel) throw new Error("run_ps_script 需要 relativePath");
    return {
      content: [{ type: "text", text: JSON.stringify(runPsScript(WORKSPACE, rel), null, 2) }],
    };
  }
  if (name === "run_corel_macro") {
    guardRole();
    const rel = (args?.relativePath || "").trim();
    const macro = (args?.macroName || "").trim();
    return {
      content: [
        { type: "text", text: JSON.stringify(runCorelMacro(WORKSPACE, rel || null, macro || null), null, 2) },
      ],
    };
  }
  if (name === "generate_and_run_ps_export") {
    guardRole();
    const rel = (args?.relativePath || "UI/scripts/export_batch.jsx").trim();
    return {
      content: [{ type: "text", text: JSON.stringify(generateAndRunPsExport(WORKSPACE, rel), null, 2) }],
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
        serverInfo: { name: "xu-design-mcp-bridge", version: "0.3.0" },
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
