// Sanity check: count green/gray/paper pixels in the current normalized PNGs.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function decodePng(buf) {
  let pos = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
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
  return { width, height, colorType, channels, data: out }
}

for (const floor of [1, 2]) {
  const img = decodePng(readFileSync(`public/blueprints/mst-floor-${floor}.png`))
  const W = img.width, H = img.height, C = img.channels
  let green = 0, gray = 0, paper = 0, other = 0
  for (let i = 0; i < W * H; i++) {
    const r = img.data[i * C], g = img.data[i * C + 1], b = img.data[i * C + 2]
    if (g > r + 18 && g > b + 18) green++
    else if (Math.abs(r - g) < 22 && Math.abs(g - b) < 22) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (lum > 160) paper++
      else if (lum < 120) gray++
      else other++
    } else other++
  }
  const total = W * H
  console.log(`floor ${floor} (${W}x${H}, channels=${C}): green ${(100 * green / total).toFixed(1)}% | gray ${((gray) * 100 / total).toFixed(1)}% | paper ${(100 * paper / total).toFixed(1)}% | other ${(100 * other / total).toFixed(1)}%`)
}
