// Detect the building's outer walls within each floor's SHEET area only.
// Outputs sheet-pixel bboxes and wall line positions in sheet-percent space,
// plus the code-percent values those sheet-percents imply.
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

const CODE = { left: 11.2, right: 98.9, top: 31.5, bottom: 86.2 }

for (const floor of [1, 2, 3, 4]) {
  const img = decodePng(readFileSync(`public/blueprints/mst-floor-${floor}.png`))
  const { width: W, height: H } = img

  // Sheet detection: bright pixels via 2% mass threshold on row/col profiles.
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
  const SW = sx1 - sx0 + 1, SH = sy1 - sy0 + 1
  const spx = (pct) => sx0 + Math.round((pct / 100) * (SW - 1)) // sheet pct -> image px
  const spy = (pct) => sy0 + Math.round((pct / 100) * (SH - 1))

  // Sample code-percent lines across the sheet, checking for wall-like ink runs.
  const inkAt = (x, y) => {
    const [r, g, b, a] = pixelAt(img, x, y)
    if (a < 40) return false
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    return !(lum > 110 || (lum >= 60 && chroma >= 30)) // dark & gray = ink
  }
  const scanRuns = (fromPct, toPct, axis) => {
    // Walk along one axis at a fixed other-coordinate; count consecutive ink.
    const runs = []
    let run = 0
    const steps = 1000
    for (let s = 0; s <= steps; s++) {
      const pct = fromPct + ((toPct - fromPct) * s) / steps
      const x = axis === 'x' ? spx(pct) : spx(fromPct + ((toPct - fromPct) * s) / steps)
      const y = axis === 'x' ? spy(50) : spy(pct)
      const px = axis === 'x' ? spx(pct) : spx(pct === fromPct ? 50 : 50) // placeholder
      let hit
      if (axis === 'x') hit = inkAt(spx(pct), spy(50))
      else hit = inkAt(spx(50), spy(pct))
      if (hit) run++
      else {
        if (run > 0) runs.push({ at: pct - (run * (toPct - fromPct)) / steps, len: (run * (toPct - fromPct)) / steps })
        run = 0
      }
    }
    if (run > 0) runs.push({ at: toPct - (run * (toPct - fromPct)) / steps, len: (run * (toPct - fromPct)) / steps })
    return runs
  }

  // Outer walls: scan from sheet edges toward center at mid height / mid width.
  const leftScan = scanRuns(0, 40, 'x').filter((r) => r.len >= 1.5)
  const rightScan = scanRuns(60, 100, 'x').filter((r) => r.len >= 1.5)
  const topScan = scanRuns(0, 45, 'y').filter((r) => r.len >= 1.5)
  const bottomScan = scanRuns(55, 100, 'y').filter((r) => r.len >= 1.5)
  const first = (arr) => (arr.length ? arr[0].at + arr[0].len / 2 : null)

  // Where the code's expected values actually land on this sheet.
  const landed = {
    left: scanRuns(CODE.left - 3, CODE.left + 3, 'x'),
    right: scanRuns(CODE.right - 3, CODE.right + 3, 'x'),
    top: scanRuns(CODE.top - 3, CODE.top + 3, 'y'),
    bottom: scanRuns(CODE.bottom - 3, CODE.bottom + 3, 'y'),
  }

  console.log(
    `floor ${floor}: sheet x${sx0}..${sx1} y${sy0}..${sy1} (${SW}x${SH})\n` +
      `  outer walls found (sheet-%): left≈${first(leftScan)?.toFixed(1) ?? '—'} right≈${first(rightScan)?.toFixed(1) ?? '—'} top≈${first(topScan)?.toFixed(1) ?? '—'} bottom≈${first(bottomScan)?.toFixed(1) ?? '—'}\n` +
      `  ink near code values: left[${landed.left.map((r) => r.at.toFixed(1)).join(',') || '—'}] right[${landed.right.map((r) => r.at.toFixed(1)).join(',') || '—'}] top[${landed.top.map((r) => r.at.toFixed(1)).join(',') || '—'}] bottom[${landed.bottom.map((r) => r.at.toFixed(1)).join(',') || '—'}]`,
  )
}
