// Overlay the code's room-grid lines on the normalized floor-1 sheet as ASCII
// to see how the code's room dots will land after normalization.
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
        const p = a + b + -c
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

const img = decodePng(readFileSync('public/blueprints/mst-floor-1.png'))
const W = img.width, H = img.height
console.log(`normalized image: ${W}x${H} (AR ${(W / H).toFixed(4)}, code expects ${(713 / 470).toFixed(4)})`)

const green = new Uint8Array(W * H)
const gray = new Uint8Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const [r, g, b, a] = pixelAt(img, x, y)
  if (a < 40) continue
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  if (g > r + 18 && g > b + 18) green[y * W + x] = 1
  else if (Math.abs(r - g) < 22 && Math.abs(g - b) < 22 && lum < 120) gray[y * W + x] = 1
}

// Code grid lines (verticals and horizontals).
const CODE_V = [11.2, 17.8, 29.3, 40.8, 46.5, 51.8, 55.4, 65.9, 73.9, 83.9, 86.5, 91.9, 98.9]
const CODE_H = [31.5, 40, 41.7, 54, 57, 60.5, 66.3, 71.5, 74.8, 81.2, 86.2]
const px = (p) => Math.round((p / 100) * (W - 1))
const py = (p) => Math.round((p / 100) * (H - 1))

const COLS = 150, ROWS = 50
const rows = []
for (let r = 0; r < ROWS; r++) rows.push(Array(COLS).fill(' '))
// Draw ink first.
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const x0 = Math.floor((c / COLS) * W), x1 = Math.max(x0 + 1, Math.floor(((c + 1) / COLS) * W))
  const y0 = Math.floor((r / ROWS) * H), y1 = Math.max(y0 + 1, Math.floor(((r + 1) / ROWS) * H))
  let gHit = 0, kHit = 0, tot = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { tot++; gHit += green[y * W + x]; kHit += gray[y * W + x] }
  if (gHit / tot > 0.05) rows[r][c] = 'G'
  else if (kHit / tot > 0.05) rows[r][c] = '#'
  else if (kHit > 0) rows[r][c] = '.'
}
// Draw code grid on top.
for (const vx of CODE_V) {
  const c = Math.round((px(vx) / W) * COLS)
  for (let r = Math.floor((py(31.5) / H) * ROWS); r <= Math.ceil((py(86.2) / H) * ROWS); r++) if (rows[r]?.[c] === ' ') rows[r][c] = '|'
}
for (const hy of CODE_H) {
  const r = Math.round((py(hy) / H) * ROWS)
  for (let c = Math.floor((px(11.2) / W) * COLS); c <= Math.ceil((px(98.9) / W) * COLS); c++) if (rows[r]?.[c] === ' ') rows[r][c] = '-'
}
console.log('G=green walls  #=gray ink  |/-=code grid')
console.log('    ' + Array.from({ length: COLS }, (_, c) => (c % 10 === 0 ? '|' : ' ')).join(''))
rows.forEach((row, r) => {
  const pct = Math.round(((r + 0.5) / ROWS) * 100)
  console.log(String(pct).padStart(3) + '% ' + row.join(''))
})
