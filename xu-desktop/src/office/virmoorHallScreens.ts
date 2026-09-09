/**
 * @file virmoorHallScreens.ts 工位屏与大厅大墙：工位画面 + 夜景窗
 * @author qiuye <yjk150@qq.com>
 * @date 2026-08-30
 * @updated 2026-08-30
 * @version 1.1.0
 * @category UI
 * @algo canvas-texture
 */

import type { OfficeHallDisplay } from '../utils/officeHallDisplay'
import { DEFAULT_OFFICE_HALL_DISPLAY } from '../utils/officeHallDisplay'

export const SCREEN_KINDS = ['code', 'calendar', 'sheet', 'chat', 'kanban', 'plan', 'term', 'wire'] as const
export type ScreenKind = (typeof SCREEN_KINDS)[number]

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d')
  return { c, ctx }
}

function fill(ctx: CanvasRenderingContext2D, color: string, w: number, h: number) {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
}

export function drawDeskScreen(kind: ScreenKind): HTMLCanvasElement {
  const { c, ctx } = canvas(256, 160)
  fill(ctx, '#0b1018', 256, 160)
  ctx.font = '11px Segoe UI, Microsoft YaHei, sans-serif'

  if (kind === 'code') {
    fill(ctx, '#0d1117', 256, 160)
    ctx.fillStyle = '#3d4450'
    ctx.fillRect(0, 0, 256, 18)
    ctx.fillStyle = '#c9d1d9'
    ctx.fillText('login.ts', 8, 13)
    ctx.fillStyle = '#8b949e'
    ctx.fillText('1   export function gate() {', 8, 36)
    ctx.fillStyle = '#ff7b72'
    ctx.fillText('2     if (!ok) return', 8, 52)
    ctx.fillStyle = '#79c0ff'
    ctx.fillText('3     writeDisk()', 8, 68)
    ctx.fillStyle = '#a5d6ff'
    ctx.fillText('4     notify(user)', 8, 84)
    ctx.fillStyle = '#8b949e'
    ctx.fillText('5   }', 8, 100)
    ctx.fillStyle = '#3fb950'
    ctx.fillRect(8, 118, 120, 6)
    ctx.fillStyle = '#58a6ff'
    ctx.fillRect(8, 132, 80, 6)
  } else if (kind === 'calendar') {
    fill(ctx, '#141820', 256, 160)
    ctx.fillStyle = '#e8c27a'
    ctx.fillText('办公室 · 日程', 10, 18)
    for (let r = 0; r < 3; r += 1) {
      for (let col = 0; col < 5; col += 1) {
        const x = 12 + col * 46
        const y = 32 + r * 38
        ctx.fillStyle = r === 1 && col === 2 ? '#3ec8d4' : '#1c2430'
        ctx.fillRect(x, y, 40, 30)
        ctx.fillStyle = '#f0e6d2'
        ctx.fillText(String(r * 5 + col + 3), x + 6, y + 18)
      }
    }
  } else if (kind === 'sheet') {
    fill(ctx, '#102014', 256, 160)
    ctx.fillStyle = '#9be9a8'
    ctx.fillText('项目进度表', 10, 16)
    for (let r = 0; r < 6; r += 1) {
      for (let col = 0; col < 4; col += 1) {
        ctx.fillStyle = r === 0 ? '#1a3a24' : '#16301c'
        ctx.fillRect(10 + col * 60, 26 + r * 20, 56, 16)
      }
    }
    ctx.fillStyle = '#d4f5dc'
    ctx.fillText('进行中  3', 16, 40)
    ctx.fillText('已完成  7', 16, 60)
    ctx.fillText('等批准  1', 16, 80)
  } else if (kind === 'chat') {
    fill(ctx, '#16120e', 256, 160)
    ctx.fillStyle = '#e0b45a'
    ctx.fillText('问询会话', 10, 16)
    ctx.fillStyle = '#3a3228'
    ctx.fillRect(12, 28, 150, 28)
    ctx.fillStyle = '#fff8ea'
    ctx.fillText('这怎么用？', 20, 46)
    ctx.fillStyle = '#1e2a30'
    ctx.fillRect(70, 66, 174, 40)
    ctx.fillStyle = '#c5e4ec'
    ctx.fillText('问询不改文件。', 80, 90)
  } else if (kind === 'kanban') {
    fill(ctx, '#12141c', 256, 160)
    ;['计划', '进行', '待批'].forEach((name, i) => {
      ctx.fillStyle = '#1c2230'
      ctx.fillRect(10 + i * 80, 12, 72, 136)
      ctx.fillStyle = '#f2ead2'
      ctx.fillText(name, 20 + i * 80, 28)
      ctx.fillStyle = i === 2 ? '#e0b45a' : '#3ec8d4'
      ctx.fillRect(18 + i * 80, 40, 56, 18)
      ctx.fillRect(18 + i * 80, 66, 56, 18)
    })
  } else if (kind === 'plan') {
    fill(ctx, '#181410', 256, 160)
    ctx.fillStyle = '#e0b45a'
    ctx.fillText('计划稿', 10, 18)
    ;[0, 1, 2, 3].forEach((i) => {
      ctx.fillStyle = '#2a2218'
      ctx.fillRect(12, 32 + i * 28, 232, 20)
      ctx.fillStyle = '#f0e6d2'
      ctx.fillText(`${i + 1}. 步骤 / 风险 / 验收`, 20, 46 + i * 28)
    })
  } else if (kind === 'term') {
    fill(ctx, '#050805', 256, 160)
    ctx.fillStyle = '#3fb950'
    ctx.fillText('$ virmoor --ask', 10, 22)
    ctx.fillText('> 只回答，不写盘', 10, 42)
    ctx.fillStyle = '#8b949e'
    ctx.fillText('$ # 智能体要批准', 10, 68)
    ctx.fillStyle = '#e0b45a'
    ctx.fillText('await approve()', 10, 94)
    ctx.fillStyle = '#3fb950'
    ctx.fillText('_', 10, 120)
  } else {
    fill(ctx, '#101018', 256, 160)
    ctx.strokeStyle = '#8eb4ff'
    ctx.strokeRect(16, 20, 100, 70)
    ctx.strokeRect(130, 20, 110, 120)
    ctx.fillStyle = '#b8d4ff'
    ctx.fillText('工作区示意', 16, 14)
    ctx.fillStyle = '#2a3348'
    ctx.fillRect(140, 36, 90, 16)
    ctx.fillRect(140, 60, 70, 16)
    ctx.fillRect(140, 84, 90, 16)
  }
  return c
}

/** 大厅大屏用品牌图（与顶栏 icon 同源） */
export function loadHallLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = '/icon.png'
  })
}

/** 按用户配置加载 Logo（data URL 或默认 icon） */
export function loadHallLogoFromConfig(logoDataUrl?: string | null): Promise<HTMLImageElement | null> {
  const src = logoDataUrl?.trim()
  if (!src) return loadHallLogo()
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => {
      void loadHallLogo().then(resolve)
    }
    img.src = src
  })
}

export function drawHallScreen(
  logo?: HTMLImageElement | null,
  display: OfficeHallDisplay = DEFAULT_OFFICE_HALL_DISPLAY,
): HTMLCanvasElement {
  const { c, ctx } = canvas(1024, 256)
  const g = ctx.createLinearGradient(0, 0, 1024, 256)
  g.addColorStop(0, '#0a0e16')
  g.addColorStop(1, '#16100c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1024, 256)
  ctx.strokeStyle = 'rgba(224,180,90,0.45)'
  ctx.strokeRect(18, 18, 988, 220)

  const logoSize = 108
  let textX = 48
  if (logo) {
    const logoY = (256 - logoSize) / 2
    ctx.save()
    ctx.beginPath()
    const r = 18
    const x = 48
    const y = logoY
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + logoSize, y, x + logoSize, y + logoSize, r)
    ctx.arcTo(x + logoSize, y + logoSize, x, y + logoSize, r)
    ctx.arcTo(x, y + logoSize, x, y, r)
    ctx.arcTo(x, y, x + logoSize, y, r)
    ctx.closePath()
    ctx.clip()
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(x, y, logoSize, logoSize)
    ctx.drawImage(logo, x, y, logoSize, logoSize)
    ctx.restore()
    textX = 48 + logoSize + 28
  }

  ctx.fillStyle = '#e0b45a'
  ctx.font = '28px Segoe UI, Microsoft YaHei, sans-serif'
  ctx.fillText(display.brandName, textX, 80)
  ctx.fillStyle = '#fff8ea'
  ctx.font = 'bold 72px Segoe UI, Microsoft YaHei, sans-serif'
  ctx.fillText(display.mainTitle, textX, 168)
  ctx.fillStyle = '#c5e4ec'
  ctx.font = '22px Segoe UI, Microsoft YaHei, sans-serif'
  ctx.fillText(display.subtitle, textX, 210)
  return c
}

/** 前台屏风：用户可配标语（高对比，贴在屏风大面） */
export function drawFoldingScreenBanner(display: OfficeHallDisplay = DEFAULT_OFFICE_HALL_DISPLAY): HTMLCanvasElement {
  const w = 2048
  const h = 896
  const { c, ctx } = canvas(w, h)
  fill(ctx, '#1a1520', w, h)
  ctx.fillStyle = '#2a2230'
  ctx.fillRect(0, 0, w, 48)
  ctx.fillRect(0, h - 48, w, 48)
  ctx.strokeStyle = '#e0b45a'
  ctx.lineWidth = 10
  ctx.strokeRect(36, 36, w - 72, h - 72)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#e0b45a'
  ctx.font = 'bold 120px Segoe UI, Microsoft YaHei, PingFang SC, sans-serif'
  ctx.fillText(display.foldingTitle, w / 2, h / 2 - 80)
  ctx.fillStyle = '#fff8ea'
  ctx.font = 'bold 88px Segoe UI, Microsoft YaHei, PingFang SC, sans-serif'
  ctx.fillText(display.foldingSubtitle, w / 2, h / 2 + 100)
  return c
}

/** 大厅背后大墙：夜景城市窗（方案 C） */
export function drawNightCityWall(): HTMLCanvasElement {
  const w = 1536
  const h = 512
  const { c, ctx } = canvas(w, h)

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#050814')
  sky.addColorStop(0.45, '#0a1228')
  sky.addColorStop(0.78, '#12182a')
  sky.addColorStop(1, '#1a1420')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  // 星点
  for (let i = 0; i < 90; i += 1) {
    const x = (i * 97) % w
    const y = ((i * 53) % Math.floor(h * 0.42)) + 8
    ctx.fillStyle = `rgba(255,255,255,${0.25 + (i % 5) * 0.1})`
    ctx.fillRect(x, y, 1.5, 1.5)
  }

  // 远山/雾
  ctx.fillStyle = 'rgba(30, 40, 70, 0.55)'
  ctx.beginPath()
  ctx.moveTo(0, h * 0.62)
  for (let x = 0; x <= w; x += 48) {
    const y = h * 0.55 + Math.sin(x * 0.01) * 18 + Math.cos(x * 0.004) * 12
    ctx.lineTo(x, y)
  }
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()

  // 楼群剪影 + 窗灯（步长必须为正，避免 % 负余数死循环）
  const buildings: { x: number; bw: number; bh: number }[] = []
  let x = 0
  let guard = 0
  while (x < w + 40 && guard < 80) {
    guard += 1
    const bw = 48 + Math.abs((x * 17) % 70)
    const bh = 90 + Math.abs((x * 31) % 220)
    buildings.push({ x, bw, bh })
    x += Math.max(40, bw + 6 + Math.abs((x * 13) % 18))
  }
  buildings.forEach((b, i) => {
    const top = h - 40 - b.bh
    ctx.fillStyle = i % 3 === 0 ? '#0c101c' : i % 3 === 1 ? '#101628' : '#0a0e18'
    ctx.fillRect(b.x, top, b.bw, b.bh + 40)
    const cols = Math.max(2, Math.floor(b.bw / 14))
    const rows = Math.max(3, Math.floor(b.bh / 16))
    for (let r = 0; r < rows; r += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (((r * 7 + col * 3 + i) % 5) === 0) continue
        const lit = ((r + col + i) * 11) % 7 !== 0
        if (!lit) continue
        const warm = ((r * col + i) % 3) === 0
        ctx.fillStyle = warm ? 'rgba(255, 210, 120, 0.85)' : 'rgba(120, 200, 255, 0.7)'
        ctx.fillRect(b.x + 6 + col * 12, top + 10 + r * 14, 6, 8)
      }
    }
  })

  // 近景地面反光
  const ground = ctx.createLinearGradient(0, h * 0.78, 0, h)
  ground.addColorStop(0, 'rgba(224, 180, 90, 0.08)')
  ground.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
  ctx.fillStyle = ground
  ctx.fillRect(0, h * 0.78, w, h * 0.22)

  // 窗框（办公室落地窗）
  ctx.strokeStyle = 'rgba(180, 190, 210, 0.55)'
  ctx.lineWidth = 10
  ctx.strokeRect(8, 8, w - 16, h - 16)
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(w / 3, 8)
  ctx.lineTo(w / 3, h - 8)
  ctx.moveTo((w * 2) / 3, 8)
  ctx.lineTo((w * 2) / 3, h - 8)
  ctx.moveTo(8, h / 2)
  ctx.lineTo(w - 8, h / 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(224, 180, 90, 0.35)'
  ctx.lineWidth = 2
  ctx.strokeRect(14, 14, w - 28, h - 28)

  return c
}
