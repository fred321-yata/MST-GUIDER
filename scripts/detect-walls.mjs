// Detect the building's outer walls within each floor's sheet to test whether
// the code's percent coordinates match the sheet framing (and per-floor offsets).
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

// Expected building outline in code-percent space (from room rects in indoor.ts):
// left rooms start x=11.2, right rooms end x=98.9, top rooms start y=31.5, bottom rooms end y=86.2.
const CODE = { left: 11.2, right: 98.9, top: 31.5, bottom: 86.2 }

for (const floor of [1, 2, 3, 4]) {
  const img = decodePng(readFileSync(`public/blueprints/mst-floor-${floor}.png`))
  const { width: W, height: H } = img
  // 1) Sheet bbox (bright paper) via 2% mass threshold.
  const colBright = new Float64Array(W), rowBright = new Float64Array(H)
  const dark = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b, a] = pixelAt(img, x, y)
    const i = y * W + x
    if (a < 40) continue
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    if (lum > 110) { colBright[x]++; rowBright[y]++ } else dark[i] = 1
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
  const sheetW = sx1 - sx0 + 1, sheetH = sy1 - sy0 + 1
  // 2) Wall detection within sheet interior (3% inset to skip sheet edges).
  const ix0 = sx0 + Math.round(sheetW * 0.03), ix1 = sx1 - Math.round(sheetW * 0.03)
  const iy0 = sy0 + Math.round(sheetH * 0.03), iy1 = sy1 - Math.round(sheetH * 0.03)
  const colDark = new Float64Array(W), rowDark = new Float64Array(H)
  for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) if (dark[y * W + x]) { colDark[x]++; rowDark[y]++ }
  const peaks = (prof, lo, hi, spanCount, frac) => {
    // Rows/cols whose dark fraction exceeds frac -> cluster consecutive ones -> centers.
    const marks = []
    for (let i = lo; i <= hi; i++) if (prof[i] > spanCount * frac) marks.push(i)
    const clusters = []
    for (const m of marks) {
      const last = clusters[clusters.length - 1]
      if (last && m - last[last.length - 1] <= 3) last.push(m)
      else clusters.push([m])
    }
    return clusters.map((c) => c[Math.floor(c.length / 2)])
  }
  const vWalls = peaks(colDark, ix0, ix1, iy1 - iy0 + 1, 0.30) // vertical walls: tall dark columns
  const hWalls = peaks(rowDark, iy0, iy1, ix1 - ix0 + 1, 0.30) // horizontal walls: wide dark rows
  const sheetPct = (v, t) => (((v - (t === W ? sx0 : sy0)) / (t === W ? sheetW : sheetH)) * 100)
  const vx = vWalls.map((w) => +sheetPct(w, W).toFixed(1))
  const hy = hWalls.map((w) => +sheetPct(w, H).toFixed(1))
  console.log(
    `floor ${floor}: sheet px x${sx0}..${sx1} y${sy0}..${sy1} (${sheetW}x${sheetH})\n` +
      `  vertical walls at sheet-x%: [${vx.join(', ')}]  (code expects ~${CODE.left} and ~${CODE.right})\n` +
      `  horizontal walls at sheet-y%: [${hy.join(', ')}]  (code expects ~${CODE.top} and ~${CODE.bottom})`,
  )
}
