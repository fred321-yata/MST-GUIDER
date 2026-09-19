// Cross-correlate the code's room-grid lines against each floor's sheet ink
// to find the (dx, dy) shift (in sheet percent) that best aligns them.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function decodePng(buf) {
  let pos = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  let palette = null, trns = null
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'PLTE') palette = Buffer.from(data)
    else if (type === 'tRNS') trns = Buffer.from(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  const bpp = channels
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
    prev = cur
  }
  return { width, height, colorType, channels, palette, trns, data: out }
}

function pixelAt(img, x, y) {
  const { width, channels, data, colorType, palette, trns } = img
  const i = (y * width + x) * channels
  if (colorType === 3) {
    const idx = data[i]
    return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], trns && idx < trns.length ? trns[idx] : 255]
  }
  if (colorType === 0) return [data[i], data[i], data[i], 255]
  if (colorType === 4) return [data[i], data[i], data[i], data[i + 1]]
  if (colorType === 2) return [data[i], data[i + 1], data[i + 2], 255]
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

// Code grid (from indoor.ts room rects + hallway constants).
const CODE_V = [11.2, 17.8, 29.3, 40.8, 46.5, 51.8, 55.4, 65.9, 73.9, 83.9, 86.5, 91.9, 98.9]
const CODE_H = [31.5, 40, 41.7, 54, 57, 60.5, 66.3, 71.5, 74.8, 81.2, 86.2]
const GRID = { x0: 11.2, x1: 98.9, y0: 31.5, y1: 86.2 }

const SHEET_ORIGIN = { 1: [47, 50], 2: [44, 32], 3: [18, 14], 4: [47, 26] }
const SW = 650, SH = 435

for (const floor of [1, 2, 3, 4]) {
  const SRC = decodePng(readFileSync(`public/blueprints/mst-floor-${floor}.png`))
  const [ox, oy] = SHEET_ORIGIN[floor]
  // Ink mask of the sheet (dark gray drawing lines).
  const ink = new Uint8Array(SW * SH)
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const [r, g, b, a] = pixelAt(SRC, ox + x, oy + y)
    if (a < 40) continue
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (lum <= 120 && chroma < 34) ink[y * SW + x] = 1
  }
  // Grid-line mask builder at a given shift (sheet %).
  const buildGrid = (dx, dy) => {
    const mask = new Uint8Array(SW * SH)
    const px = (p) => Math.round((p / 100) * (SW - 1))
    const py = (p) => Math.round((p / 100) * (SH - 1))
    for (const vx of CODE_V) {
      const X = px(vx + dx)
      for (let t = py(GRID.y0 + dy); t <= py(GRID.y1 + dy); t++) {
        for (const w of [0, 1]) if (X + w < SW) mask[t * SW + X + w] = 1
      }
    }
    for (const hy of CODE_H) {
      const Y = py(hy + dy)
      for (let t = px(GRID.x0 + dx); t <= px(GRID.x1 + dx); t++) {
        for (const w of [0, 1]) if (Y + w < SH) mask[(Y + w) * SW + t] = 1
      }
    }
    return mask
  }
  // Score = fraction of grid pixels on ink.
  const score = (dx, dy) => {
    const g = buildGrid(dx, dy)
    let hit = 0, total = 0
    for (let i = 0; i < g.length; i++) if (g[i]) { total++; if (ink[i]) hit++ }
    return hit / total
  }
  let best = { dx: 0, dy: 0, s: -1 }
  for (let dx = -6; dx <= 6; dx += 0.5) {
    for (let dy = -6; dy <= 6; dy += 0.5) {
      const s = score(dx, dy)
      if (s > best.s) best = { dx, dy, s }
    }
  }
  const base = score(0, 0)
  console.log(`floor ${floor}: base score ${base.toFixed(3)} → best shift dx=${best.dx.toFixed(1)}% dy=${best.dy.toFixed(1)}% score=${best.s.toFixed(3)}`)
}
