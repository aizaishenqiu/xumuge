/** High-contrast 2D catalog previews (top-down furniture glyphs). */

import type { PropKind } from "./catalog";

export type PreviewStyleId = "oak" | "walnut" | "white" | "slate" | "teal" | "navy" | "default";

const cache = new Map<string, string>();

type Palette = {
  bg: string;
  wood: string;
  woodDark: string;
  fabric: string;
  metal: string;
  ink: string;
  accent: string;
  glass: string;
};

const PALETTES: Record<PreviewStyleId, Palette> = {
  default: {
    bg: "#eef2f7",
    wood: "#c9a87c",
    woodDark: "#8b6914",
    fabric: "#3d7a6a",
    metal: "#475569",
    ink: "#0f172a",
    accent: "#2563eb",
    glass: "#7dd3fc",
  },
  oak: {
    bg: "#f5efe4",
    wood: "#d4a574",
    woodDark: "#a67c52",
    fabric: "#6b8f71",
    metal: "#57534e",
    ink: "#1c1917",
    accent: "#b45309",
    glass: "#a5d8ff",
  },
  walnut: {
    bg: "#f0ebe4",
    wood: "#6f4e37",
    woodDark: "#4a3728",
    fabric: "#5c4033",
    metal: "#44403c",
    ink: "#1c1917",
    accent: "#92400e",
    glass: "#93c5fd",
  },
  white: {
    bg: "#f1f5f9",
    wood: "#f8fafc",
    woodDark: "#cbd5e1",
    fabric: "#94a3b8",
    metal: "#64748b",
    ink: "#0f172a",
    accent: "#0ea5e9",
    glass: "#bae6fd",
  },
  slate: {
    bg: "#e2e8f0",
    wood: "#64748b",
    woodDark: "#334155",
    fabric: "#475569",
    metal: "#1e293b",
    ink: "#0f172a",
    accent: "#6366f1",
    glass: "#a5b4fc",
  },
  teal: {
    bg: "#e6fffa",
    wood: "#2c7a7b",
    woodDark: "#234e52",
    fabric: "#319795",
    metal: "#285e61",
    ink: "#134e4a",
    accent: "#0d9488",
    glass: "#99f6e4",
  },
  navy: {
    bg: "#e8eef8",
    wood: "#1e3a5f",
    woodDark: "#0f2744",
    fabric: "#2c5282",
    metal: "#2d3748",
    ink: "#0b1a2e",
    accent: "#3b82f6",
    glass: "#93c5fd",
  },
};

function drawRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
  lw = 2,
) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

function drawRound(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  stroke?: string,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function grid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = "rgba(15,23,42,0.06)";
  ctx.lineWidth = 1;
  for (let x = 20; x < w; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h - 36);
    ctx.stroke();
  }
  for (let y = 20; y < h - 36; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

export function catalogPreviewDataUrl(
  kind: PropKind,
  name: string,
  styleId: PreviewStyleId | string = "default",
): string {
  const style = (styleId in PALETTES ? styleId : "default") as PreviewStyleId;
  const key = `${kind}:${name}:${style}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const W = 320;
  const H = 220;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const p = PALETTES[style];

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  grid(ctx, W, H);
  ctx.strokeStyle = "rgba(15,23,42,0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  const ink = p.ink;
  const wood = p.wood;
  const dark = p.woodDark;

  switch (kind) {
    case "desk":
    case "desk_compact":
      drawRect(ctx, 70, 55, 180, 78, wood, ink, 2.5);
      drawRect(ctx, 82, 42, 56, 22, dark, ink);
      drawRect(ctx, 138, 145, 42, 30, p.metal, ink);
      if (kind === "desk_compact") drawRect(ctx, 90, 70, 140, 48, wood, dark);
      break;
    case "desk_duo":
      drawRect(ctx, 40, 55, 240, 78, wood, ink, 2.5);
      drawRect(ctx, 55, 42, 50, 20, dark, ink);
      drawRect(ctx, 215, 42, 50, 20, dark, ink);
      drawRect(ctx, 70, 145, 38, 28, p.metal, ink);
      drawRect(ctx, 212, 145, 38, 28, p.metal, ink);
      break;
    case "desk_l": {
      // Continuous L: main wing + left return
      ctx.beginPath();
      ctx.moveTo(55, 55);
      ctx.lineTo(250, 55);
      ctx.lineTo(250, 130);
      ctx.lineTo(130, 130);
      ctx.lineTo(130, 175);
      ctx.lineTo(55, 175);
      ctx.closePath();
      ctx.fillStyle = wood;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      drawRect(ctx, 145, 70, 40, 16, dark, ink);
      drawRect(ctx, 155, 140, 36, 26, p.metal, ink);
      break;
    }
    case "desk_bench":
      drawRect(ctx, 45, 45, 230, 100, wood, ink, 2.5);
      drawRect(ctx, 55, 90, 210, 10, p.metal, ink);
      drawRect(ctx, 70, 52, 44, 18, dark, ink);
      drawRect(ctx, 206, 118, 44, 18, dark, ink);
      break;
    case "desk_corner":
      drawRect(ctx, 55, 70, 150, 70, wood, ink, 2.5);
      drawRect(ctx, 175, 30, 70, 110, wood, ink, 2.5);
      drawRect(ctx, 90, 55, 40, 16, dark, ink);
      break;
    case "desk_standing":
      drawRect(ctx, 75, 65, 170, 55, wood, ink, 2.5);
      drawRect(ctx, 95, 52, 50, 18, dark, ink);
      drawRect(ctx, 85, 130, 18, 35, p.metal, ink);
      drawRect(ctx, 215, 130, 18, 35, p.metal, ink);
      break;
    case "desk_arc":
      ctx.beginPath();
      ctx.arc(160, 130, 85, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineWidth = 28;
      ctx.strokeStyle = wood;
      ctx.stroke();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      drawRect(ctx, 145, 145, 30, 28, p.metal, ink);
      break;
    case "desk_exec":
    case "desk_exec_l":
    case "desk_exec_arc":
      drawRect(ctx, 40, 60, 240, 85, wood, ink, 2.5);
      drawRect(ctx, 55, 72, 55, 60, dark, ink);
      drawRect(ctx, 210, 72, 55, 60, dark, ink);
      drawRect(ctx, 130, 48, 60, 24, p.metal, ink);
      if (kind === "desk_exec_l") drawRect(ctx, 220, 25, 60, 95, wood, ink, 2.5);
      if (kind === "desk_exec_arc") {
        ctx.beginPath();
        ctx.arc(160, 135, 70, Math.PI * 1.1, Math.PI * 1.9);
        ctx.lineWidth = 16;
        ctx.strokeStyle = dark;
        ctx.stroke();
      }
      break;
    case "chair_exec":
      drawRound(ctx, 160, 95, 38, p.fabric, ink);
      drawRect(ctx, 140, 125, 40, 28, dark, ink);
      drawRect(ctx, 148, 55, 24, 20, dark, ink);
      break;
    case "sofa":
    case "sofa_large":
    case "sofa_loveseat": {
      const w = kind === "sofa_loveseat" ? 160 : kind === "sofa_large" ? 250 : 210;
      const x = (W - w) / 2;
      drawRect(ctx, x, 70, w, 70, p.fabric, ink, 2.5);
      drawRect(ctx, x, 58, w, 18, p.fabric, ink);
      drawRect(ctx, x, 70, 16, 70, dark, ink);
      drawRect(ctx, x + w - 16, 70, 16, 70, dark, ink);
      break;
    }
    case "sofa_corner":
      drawRect(ctx, 40, 95, 170, 60, p.fabric, ink, 2.5);
      drawRect(ctx, 180, 35, 70, 120, p.fabric, ink, 2.5);
      break;
    case "coffee_table":
      drawRect(ctx, 85, 70, 150, 60, wood, ink, 2.5);
      break;
    case "coffee_table_glass":
      drawRect(ctx, 85, 70, 150, 60, p.glass, ink, 2.5);
      drawRect(ctx, 100, 82, 120, 36, "rgba(255,255,255,0.35)");
      break;
    case "coffee_table_round":
      drawRound(ctx, 160, 100, 52, wood, ink);
      break;
    case "cabinet":
    case "shelf":
      drawRect(ctx, 100, 40, 120, 120, wood, ink, 2.5);
      drawRect(ctx, 110, 55, 100, 8, dark);
      drawRect(ctx, 110, 90, 100, 8, dark);
      drawRect(ctx, 110, 125, 100, 8, dark);
      break;
    case "wall":
      drawRect(ctx, 50, 90, 220, 28, "#c4b5a0", ink, 2.5);
      break;
    case "door":
    case "door_glass":
    case "door_double":
    case "door_double_glass":
      drawRect(
        ctx,
        kind.includes("double") ? 100 : 130,
        35,
        kind.includes("double") ? 120 : 60,
        130,
        kind.includes("glass") ? p.glass : "#a16207",
        ink,
        2.5,
      );
      break;
    case "reception_desk":
    case "reception_glass":
    case "reception_split":
    case "reception_arch":
    case "reception_minimal":
    case "reception_marble":
      drawRect(ctx, 40, 100, 240, 50, p.wood, ink, 2.5);
      drawRect(ctx, 100, 55, 120, 40, p.accent, ink, 2);
      break;
    case "window":
    case "window_wide":
      drawRect(ctx, 50, 55, kind === "window_wide" ? 220 : 160, 80, p.glass, ink, 2.5);
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.moveTo(W / 2, 55);
      ctx.lineTo(W / 2, 135);
      ctx.stroke();
      break;
    case "plant":
    case "plant_large":
    case "tree":
    case "bush":
    case "flower":
    case "flower_pot":
      drawRect(ctx, 140, 130, 40, 30, "#92400e", ink);
      drawRound(ctx, 160, 95, kind.includes("large") || kind === "tree" ? 48 : 32, "#16a34a", ink);
      if (kind === "flower" || kind === "flower_pot") {
        drawRound(ctx, 145, 85, 10, "#f472b6", ink);
        drawRound(ctx, 175, 90, 10, "#fbbf24", ink);
      }
      break;
    case "room_finance":
    case "room_sales":
    case "room_tech":
    case "room_procure":
    case "room_code":
      drawRect(ctx, 50, 40, 220, 120, "#fff", ink, 3);
      drawRect(ctx, 50, 40, 220, 28, p.accent, ink);
      ctx.fillStyle = "#fff";
      ctx.font = "700 14px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(name.slice(0, 8), 160, 60);
      drawRect(ctx, 70, 85, 70, 50, wood, ink);
      drawRect(ctx, 180, 90, 50, 40, p.fabric, ink);
      break;
    case "whiteboard":
      drawRect(ctx, 60, 45, 200, 110, "#f8fafc", ink, 2.5);
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(90, 80);
      ctx.lineTo(200, 80);
      ctx.moveTo(90, 110);
      ctx.lineTo(170, 110);
      ctx.stroke();
      break;
    case "partition":
      drawRect(ctx, 145, 35, 30, 140, "#e2e8f0", ink, 2.5);
      break;
    case "water_dispenser":
      drawRect(ctx, 130, 50, 60, 110, "#e2e8f0", ink, 2.5);
      drawRound(ctx, 160, 70, 18, p.glass, ink);
      break;
    default:
      drawRect(ctx, 95, 55, 130, 90, wood, ink, 2.5);
      drawRect(ctx, 115, 75, 90, 50, p.metal, ink);
      break;
  }

  // Label bar
  ctx.fillStyle = "rgba(15,23,42,0.88)";
  ctx.fillRect(0, H - 36, W, 36);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 15px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name.slice(0, 16), W / 2, H - 13);

  const url = canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
}
