// Render DARK-GRAY ink (labels, interior partitions) on the floor-1 sheet.
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

const SRC = decodePng(readFileSync('public/blueprints/mst-floor-1.png'))
const OX = 47, OY = 50, SW = 650, SH = 435
const mask = new Uint8Array(SW * SH)
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const [r, g, b, a] = pixelAt(SRC, OX + x, OY + y)
  if (a < 40) continue
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  const gray = Math.abs(r - g) < 22 && Math.abs(g - b) < 22
  if (gray && lum < 120) mask[y * SW + x] = 1
}

// Combined render: G = green ink, # = gray ink.
const gMask = new Uint8Array(SW * SH)
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const [r, g, b, a] = pixelAt(SRC, OX + x, OY + y)
  if (a >= 40 && g > r + 18 && g > b + 18) gMask[y * SW + x] = 1
}

const COLS = 156, ROWS = 52
console.log('floor 1 sheet: G=green walls, #=gray ink (text/interior)')
console.log('    ' + Array.from({ length: COLS }, (_, c) => (c % 10 === 0 ? '|' : ' ')).join(''))
for (let r = 0; r < ROWS; r++) {
  let line = ''
  for (let c = 0; c < COLS; c++) {
    const x0 = Math.floor((c / COLS) * SW), x1 = Math.max(x0 + 1, Math.floor(((c + 1) / COLS) * SW))
    const y0 = Math.floor((r / ROWS) * SH), y1 = Math.max(y0 + 1, Math.floor(((r + 1) / ROWS) * SH))
    let gHit = 0, kHit = 0, tot = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { tot++; gHit += gMask[y * SW + x]; kHit += mask[y * SW + x] }
    line += gHit / tot > 0.06 ? 'G' : kHit / tot > 0.06 ? '#' : kHit > 0 ? '.' : ' '
  }
  const pct = Math.round(((r + 0.5) / ROWS) * 100)
  console.log(String(pct).padStart(3) + '% ' + line)
}
