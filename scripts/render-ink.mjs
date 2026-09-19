// Fine ASCII render of dark ink only (the drawing), to compare with the room grid in code.
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

const FLOOR = Number(process.argv[2] ?? 1)
const COLS = 100, ROWS = 46
const img = decodePng(readFileSync(`public/blueprints/mst-floor-${FLOOR}.png`))
const { width: W, height: H } = img

// Ink density grid: fraction of dark-ink pixels per cell.
const grid = []
for (let r = 0; r < ROWS; r++) {
  const row = []
  for (let c = 0; c < COLS; c++) {
    const x0 = Math.floor((c / COLS) * W), x1 = Math.floor(((c + 1) / COLS) * W)
    const y0 = Math.floor((r / ROWS) * H), y1 = Math.floor(((r + 1) / ROWS) * H)
    let ink = 0, total = 0
    for (let y = y0; y < Math.max(y1, y0 + 1); y += 2) {
      for (let x = x0; x < Math.max(x1, x0 + 1); x += 2) {
        const [rr, gg, bb, aa] = pixelAt(img, x, y)
        total++
        if (aa >= 40) {
          const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb
          const chroma = Math.max(rr, gg, bb) - Math.min(rr, gg, bb)
          if (lum > 110 || (lum >= 60 && chroma >= 30)) ink++ // bright sheet or colored ink
        }
      }
    }
    row.push(total ? ink / total : 0)
  }
  grid.push(row)
}

console.log(`floor ${FLOOR} — sheet density (space=paper, #=dense ink, x-axis ticks at 10% steps)`)
const ruler = '    ' + Array.from({ length: COLS }, (_, c) => (c % 10 === 0 ? '|' : c % 5 === 0 ? '+' : ' ')).join('')
console.log(ruler)
for (let r = 0; r < ROWS; r++) {
  let line = ''
  for (let c = 0; c < COLS; c++) {
    const d = grid[r][c]
    line += d > 0.55 ? ' ' : d > 0.28 ? '.' : d > 0.12 ? '+' : '#'
  }
  const pct = Math.round(((r + 0.5) / ROWS) * 100)
  console.log(String(pct).padStart(3) + '% ' + line)
}
