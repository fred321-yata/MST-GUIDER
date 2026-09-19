// One-off: inspect blueprint PNGs (size + content bounding box + background).
// Pure Node (zlib), no dependencies.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  let palette = null, trns = null
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
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
    const rgb = [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]]
    const alpha = trns && idx < trns.length ? trns[idx] : 255
    return [...rgb, alpha]
  }
  if (colorType === 0) return [data[i], data[i], data[i], trns ? trns[0] : 255]
  if (colorType === 4) return [data[i], data[i], data[i], data[i + 1]]
  if (colorType === 2) return [data[i], data[i + 1], data[i + 2], trns ? 255 : 255]
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

for (const floor of [1, 2, 3, 4]) {
  const path = `public/blueprints/mst-floor-${floor}.png`
  const img = decodePng(readFileSync(path))
  const { width, height } = img
  // Sample background color: assume top-left 1% region.
  const samples = new Map()
  for (let y = 0; y < Math.max(1, Math.floor(height * 0.01)); y++)
    for (let x = 0; x < Math.max(1, Math.floor(width * 0.01)); x++) {
      const [r, g, b, a] = pixelAt(img, x, y)
      const key = `${r >> 4},${g >> 4},${b >> 4},${a >> 4}`
      samples.set(key, (samples.get(key) ?? 0) + 1)
    }
  const bgKey = [...samples.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const [br, bg2, bb, ba] = bgKey.split(',').map((v) => Number(v) << 4)
  // Bounding box of pixels clearly different from the sampled background.
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(img, x, y)
      const diff = Math.abs(r - br) + Math.abs(g - bg2) + Math.abs(b - bb)
      if (a > 24 && diff > 40) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const cw = maxX - minX + 1, ch = maxY - minY + 1
  console.log(
    `floor ${floor}: ${width}x${height} AR=${(width / height).toFixed(4)} | ` +
      `bg≈rgb(${br},${bg2},${bb},a${ba}) | content bbox x:${minX}..${maxX} y:${minY}..${maxY} ` +
      `(${cw}x${ch} AR=${(cw / ch).toFixed(4)}) | content starts at (${((minX / width) * 100).toFixed(1)}%, ${((minY / height) * 100).toFixed(1)}%)`,
  )
}
