// Normalize the four MST blueprint PNGs in place:
// each contains the same 650x435 drawing sheet at a different offset inside a
// differently-padded canvas. Crop to the sheet so every floor shares one
// percent coordinate system (which is what src/campus/indoor.ts assumes).
// Pure Node (zlib deflate), no dependencies. Images are git-tracked, so this
// is revertible with git.
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

// ── Minimal PNG decode (same approach as the analysis scripts) ──────────────
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
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`unsupported color type ${colorType}`)
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

// ── PNG encode (RGBA, filter 0, zlib) ───────────────────────────────────────
function encodePng(width, height, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (bytes) => {
    let c = 0xffffffff
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    data.copy(out, 8)
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
    return out
  }
  // Prefilter rows with the Paeth filter for better compression.
  const bpp = 4
  const stride = width * bpp
  const filtered = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 4
    const row = rgba.subarray(y * stride, (y + 1) * stride)
    const prevRow = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0
      const b = prevRow[x]
      const c = x >= bpp ? prevRow[x - bpp] : 0
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      filtered[y * (stride + 1) + 1 + x] = row[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Detect sheet bbox per floor and crop ────────────────────────────────────
const SHEET_SIZE = { w: 650, h: 435 }
const results = []
for (const floor of [1, 2, 3, 4]) {
  const path = `public/blueprints/mst-floor-${floor}.png`
  const img = decodePng(readFileSync(path))
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
  const SW = sx1 - sx0 + 1, SH = sy1 - sy0 + 1
  if (SW !== SHEET_SIZE.w || SH !== SHEET_SIZE.h) {
    throw new Error(`floor ${floor}: detected sheet ${SW}x${SH}, expected ${SHEET_SIZE.w}x${SHEET_SIZE.h} — aborting without writing`)
  }
  // Crop the sheet, copying pixels verbatim except that fully transparent
  // pixels (the padding that surrounded the sheet) become paper gray so the
  // drawing renders uniformly. Ink, text and semi-transparent edge pixels are
  // preserved as-is.
  const rgba = Buffer.alloc(SHEET_SIZE.w * SHEET_SIZE.h * 4)
  for (let y = 0; y < SHEET_SIZE.h; y++) {
    for (let x = 0; x < SHEET_SIZE.w; x++) {
      const [r, g, b, a] = pixelAt(img, sx0 + x, sy0 + y)
      const i = (y * SHEET_SIZE.w + x) * 4
      if (a === 0) { rgba[i] = 208; rgba[i + 1] = 208; rgba[i + 2] = 208; rgba[i + 3] = 255 }
      else { rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255 }
    }
  }
  writeFileSync(path, encodePng(SHEET_SIZE.w, SHEET_SIZE.h, rgba))
  results.push(`floor ${floor}: cropped (${sx0},${sy0}) ${W}x${H} -> ${SHEET_SIZE.w}x${SHEET_SIZE.h}`)
}
console.log(results.join('\n'))
console.log('all floors normalized to 650x435 (aspect 650/435 ≈ 1.4943)')
