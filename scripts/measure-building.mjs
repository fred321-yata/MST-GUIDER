// Measure, per blueprint: sheet bbox (bright paper) and building bbox (dark ink inside the sheet).
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

for (const floor of [1, 2, 3, 4]) {
  const img = decodePng(readFileSync(`public/blueprints/mst-floor-${floor}.png`))
  const { width: W, height: H } = img
  // Classify each pixel: sheet (bright) vs dark ink vs background.
  const isSheet = new Uint8Array(W * H)
  const isInk = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = pixelAt(img, x, y)
      const i = y * W + x
      if (a < 40) continue
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (lum > 110) isSheet[i] = 1
      else isInk[i] = 1
    }
  }
  const bbox = (mask) => {
    let minX = W, minY = H, maxX = -1, maxY = -1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    return maxX < 0 ? null : { minX, minY, maxX, maxY }
  }
  // Sheet bbox via row/column mass (ignore stray pixels: need >0.5% of dimension).
  const colSheet = new Float64Array(W), rowSheet = new Float64Array(H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isSheet[y * W + x]) { colSheet[x]++; rowSheet[y]++ }
  const span = (arr, total, frac) => {
    const t = total * frac
    let a = 0, b = arr.length - 1
    while (a < arr.length && arr[a] < t) a++
    while (b >= 0 && arr[b] < t) b--
    return [a, b]
  }
  const [sx0, sx1] = span(colSheet, H, 0.02)
  const [sy0, sy1] = span(rowSheet, W, 0.02)
  // Ink strictly inside the sheet (2% inset) = the building drawing.
  const inkInside = new Uint8Array(W * H)
  const mx = Math.round(W * 0.02), my = Math.round(H * 0.02)
  for (let y = sy0 + my; y <= sy1 - my; y++) for (let x = sx0 + mx; x <= sx1 - mx; x++) inkInside[y * W + x] = isInk[y * W + x]
  const bb = bbox(inkInside)
  const pct = (v, t) => ((v / t) * 100).toFixed(1)
  const sheetW = sx1 - sx0 + 1, sheetH = sy1 - sy0 + 1
  const bw = bb.maxX - bb.minX + 1, bh = bb.maxY - bb.minY + 1
  console.log(
    `floor ${floor}: img ${W}x${H} | sheet x ${pct(sx0, W)}..${pct(sx1, W)}% y ${pct(sy0, H)}..${pct(sy1, H)}% (${sheetW}x${sheetH}) | ` +
      `building x ${pct(bb.minX, W)}..${pct(bb.maxX, W)}% y ${pct(bb.minY, H)}..${pct(bb.maxY, H)}% (${bw}x${bh} AR=${(bw / bh).toFixed(3)})`,
  )
}
