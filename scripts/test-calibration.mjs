// Decide the coordinate frame the code's grid was calibrated against:
// (a) each image's own padded canvas, or (b) the shared 650x435 sheet.
// Method: score code-grid hit rate on green hallway ink for both hypotheses,
// searching a fine shift around each.
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
    return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], trns && idx < trns.length ? trns.length ? trns[idx] : 255 : 255]
  }
  if (colorType === 0) return [data[i], data[i], data[i], 255]
  if (colorType === 4) return [data[i], data[i], data[i], data[i + 1]]
  if (colorType === 2) return [data[i], data[i + 1], data[i + 2], 255]
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

const CODE_V = [11.2, 17.8, 29.3, 40.8, 46.5, 51.8, 55.4, 65.9, 73.9, 83.9, 86.5, 91.9, 98.9]
const CODE_H = [31.5, 40, 41.7, 54, 57, 60.5, 66.3, 71.5, 74.8, 81.2, 86.2]
const GRID = { x0: 11.2, x1: 98.9, y0: 31.5, y1: 86.2 }

const SHEET_ORIGIN = { 1: [47, 50], 2: [44, 32], 3: [18, 14], 4: [47, 26] }
const SW = 650, SH = 435

for (const floor of [1, 2, 3, 4]) {
  const SRC = decodePng(readFileSync(`public/blueprints/mst-floor-${floor}.png`))
  const W = SRC.width, H = SRC.height
  const [ox, oy] = SHEET_ORIGIN[floor]
  const green = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b, a] = pixelAt(SRC, x, y)
    if (a < 40) continue
    if (g > r + 18 && g > b + 18) green[y * W + x] = 1
  }
  const score = (fx, fy) => {
    // fx/fy: mapping from code-% to image px (affine, per axis).
    const X = (p) => Math.round((p / 100) * fx)
    const Y = (p) => Math.round((p / 100) * fy)
    let hit = 0, total = 0
    for (const vx of CODE_V) {
      const Xp = X(vx)
      for (let t = Y(GRID.y0); t <= Y(GRID.y1); t += 2) {
        if (t < 0 || t >= H) { total += 2; continue }
        total++; if (green[t * W + Xp]) hit++
        total++; if (green[t * W + Xp + 1]) hit++
      }
    }
    for (const hy of CODE_H) {
      const Yp = Y(hy)
      for (let t = X(GRID.x0); t <= X(GRID.x1); t += 2) {
        if (Yp < 0 || Yp >= H) { total += 2; continue }
        total++; if (green[Yp * W + t]) hit++
        total++; if (green[(Yp + 1) * W + t]) hit++
      }
    }
    return hit / total
  }
  // Hypothesis A: canvas mapping (code % over the whole padded image).
  const a = score(W - 1, H - 1)
  // Hypothesis B: sheet mapping (code % over the 650x435 sheet at offset).
  const b = score(SW - 1, SH - 1)
  // Fine search around the better hypothesis for per-floor residual shift.
  const base = a >= b ? { fx: W - 1, fy: H - 1, name: 'canvas' } : { fx: SW - 1, fy: SH - 1, name: 'sheet' }
  let best = { dx: 0, dy: 0, s: score(base.fx, base.fy) }
  for (let dx = -30; dx <= 30; dx += 2) for (let dy = -30; dy <= 30; dy += 2) {
    // shift in px applied to mapped points: emulate by mapping then offsetting.
    const X = (p) => Math.round((p / 100) * base.fx + dx)
    const Y = (p) => Math.round((p / 100) * base.fy + dy)
    let hit = 0, total = 0
    for (const vx of CODE_V) {
      const Xp = X(vx)
      for (let t = Y(GRID.y0); t <= Y(GRID.y1); t += 2) {
        if (t < 0 || t >= H) { total += 2; continue }
        total++; if (green[t * W + Xp]) hit++
        total++; if (green[t * W + Xp + 1]) hit++
      }
    }
    for (const hy of CODE_H) {
      const Yp = Y(hy)
      for (let t = X(GRID.x0); t <= X(GRID.x1); t += 2) {
        if (Yp < 0 || Yp >= H) { total += 2; continue }
        total++; if (green[Yp * W + t]) hit++
        total++; if (green[(Yp + 1) * W + t]) hit++
      }
    }
    const s = hit / total
    if (s > best.s) best = { dx, dy, s }
  }
  console.log(
    `floor ${floor} (${W}x${H}): canvas=${a.toFixed(3)} sheet=${b.toFixed(3)} → calibrated on ${base.name === 'canvas' ? 'PADDED CANVAS' : 'sheet'}; ` +
      `best residual shift dx=${best.dx}px dy=${best.dy}px score=${best.s.toFixed(3)}`,
  )
}
