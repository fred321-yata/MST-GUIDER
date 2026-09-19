// Definitive test: crop each image's 650x435 sheet, compare content, and
// measure wall lines within the sheet consistently across floors.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

const SHEETS = {}
for (const floor of [1, 2, 3, 4]) {
  const img = decodePng(readFileSync(`public/blueprints/mst-floor-${floor}.png`))
  const { width: W, height: H } = img
  const colBright = new Float64Array(W), rowBright = new Float64Array(H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b, a] = pixelAt(img, x, y)
    if (a < 40) continue
    if (0.299 * r + 0.587 * g + 0.114 * b > 110) { colBright[x]++; rowBright[y]++ }
  }
  const span = (arr, total) => {
    const t = total * 0.02
    let a = 0, b = arr.length - 1
    while (a < arr.length && arr[a] < t) a++
    while (b >= 0 && arr[b] < t) b--
    return [a, b]
  }
  const [sx0, sx1] = span(colBright, H)
  const [sy0, sy1] = span(rowBright, W)
  // Crop the sheet into an RGB byte buffer.
  const SW = sx1 - sx0 + 1, SH = sy1 - sy0 + 1
  const rgb = Buffer.alloc(SW * SH * 3)
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const [r, g, b] = pixelAt(img, sx0 + x, sy0 + y)
    const i = (y * SW + x) * 3
    rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b
  }
  SHEETS[floor] = { sx0, sy0, SW, SH, rgb }
  console.log(`floor ${floor}: sheet origin (${sx0},${sy0}) size ${SW}x${SH} sha256=${createHash('sha256').update(rgb).digest('hex').slice(0, 16)}`)
}

// Pairwise difference between sheets (fraction of pixels differing by >24).
const ref = SHEETS[1]
for (const floor of [2, 3, 4]) {
  const s = SHEETS[floor]
  if (s.SW !== ref.SW || s.SH !== ref.SH) { console.log(`floor ${floor}: different size — skip`); continue }
  let diff = 0
  for (let i = 0; i < ref.rgb.length; i += 3) {
    if (Math.abs(ref.rgb[i] - s.rgb[i]) + Math.abs(ref.rgb[i + 1] - s.rgb[i + 1]) + Math.abs(ref.rgb[i + 2] - s.rgb[i + 2]) > 72) diff++
  }
  console.log(`sheet 1 vs sheet ${floor}: ${(100 * diff / (ref.rgb.length / 3)).toFixed(2)}% pixels differ`)
}

// Wall lines inside sheet 1 (as reference): full-height dark columns / full-width dark rows.
const isDark = (img, sheet, x, y) => {
  const i = (y * sheet.SW + x) * 3
  const r = sheet.rgb[i], g = sheet.rgb[i + 1], b = sheet.rgb[i + 2]
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  return lum <= 110 && chroma < 30
}
const colDark = new Float64Array(ref.SW), rowDark = new Float64Array(ref.SH)
for (let y = 0; y < ref.SH; y++) for (let x = 0; x < ref.SW; x++) if (isDark(null, ref, x, y)) { colDark[x]++; rowDark[y]++ }
const vPeaks = [], hPeaks = []
for (let x = 0; x < ref.SW; x++) if (colDark[x] > ref.SH * 0.55) vPeaks.push(x)
for (let y = 0; y < ref.SH; y++) if (rowDark[y] > ref.SW * 0.55) hPeaks.push(y)
const cluster = (arr) => {
  const out = []
  for (const v of arr) {
    const last = out[out.length - 1]
    if (last && v - last[last.length - 1] <= 2) last.push(v)
    else out.push([v])
  }
  return out.map((c) => c[Math.floor(c.length / 2)])
}
const pct = (v, t) => ((v / (t - 1)) * 100).toFixed(1)
console.log(`sheet 1 full-height wall columns (sheet-%): ${cluster(vPeaks).map((v) => pct(v, ref.SW)).join(', ')}`)
console.log(`sheet 1 full-width wall rows (sheet-%): ${cluster(hPeaks).map((v) => pct(v, ref.SH)).join(', ')}`)
