// High-quality wall-line detection on the cropped floor-1 sheet.
// Compares detected long lines (sheet-%) with the code's coordinate lines.
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

// ── Crop sheet 1 ──
const SRC = decodePng(readFileSync('public/blueprints/mst-floor-1.png'))
const W = SRC.width, H = SRC.height
const OX = 47, OY = 50, SW = 650, SH = 435
const isDarkAt = (x, y) => {
  const [r, g, b, a] = pixelAt(SRC, OX + x, OY + y)
  if (a < 40) return false
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  return lum <= 120 && chroma < 34
}

// Building bbox: ink pixels with generous mass (any dark pixel).
let minX = SW, minY = SH, maxX = -1, maxY = -1
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (isDarkAt(x, y)) {
  if (x < minX) minX = x; if (x > maxX) maxX = x
  if (y < minY) minY = y; if (y > maxY) maxY = y
}
console.log(`building bbox on sheet: x ${(minX / (SW - 1) * 100).toFixed(1)}..${(maxX / (SW - 1) * 100).toFixed(1)}% y ${(minY / (SH - 1) * 100).toFixed(1)}..${(maxY / (SH - 1) * 100).toFixed(1)}%`)

// Long-line detection INSIDE the building bbox.
const BX0 = minX + 4, BX1 = maxX - 4, BY0 = minY + 4, BY1 = maxY - 4
const colCount = new Float64Array(SW), rowCount = new Float64Array(SH)
for (let y = BY0; y <= BY1; y++) for (let x = BX0; x <= BX1; x++) if (isDarkAt(x, y)) { colCount[x]++; rowCount[y]++ }
const colSpan = BY1 - BY0 + 1, rowSpan = BX1 - BX0 + 1
const clusterize = (hits) => {
  const out = []
  for (const v of hits) {
    const last = out[out.length - 1]
    if (last && v - last[last.length - 1] <= 2) last.push(v)
    else out.push([v])
  }
  return out.map((c) => ({ pos: c[Math.floor(c.length / 2)], w: c[c.length - 1] - c[0] + 1 }))
}
const vHits = [], hHits = []
for (let x = BX0; x <= BX1; x++) if (colCount[x] > colSpan * 0.55) vHits.push(x)
for (let y = BY0; y <= BY1; y++) if (rowCount[y] > rowSpan * 0.55) hHits.push(y)
const fmt = (arr, t) => clusterize(arr).map((c) => `${(c.pos / (t - 1) * 100).toFixed(1)}%`).join('  ')

const CODE_V = [11.2, 17.8, 29.3, 40.8, 46.5, 51.8, 55.4, 65.9, 73.9, 83.9, 86.5, 91.9, 98.9]
const CODE_H = [31.5, 40, 41.7, 54, 57, 60.5, 66.3, 71.5, 74.8, 81.2, 86.2]
console.log(`\ncode vertical lines:   ${CODE_V.join('  ')}`)
console.log(`detected on sheet:    ${fmt(vHits, SW)}`)
console.log(`\ncode horizontal lines: ${CODE_H.join('  ')}`)
console.log(`detected on sheet:     ${fmt(hHits, SH)}`)
