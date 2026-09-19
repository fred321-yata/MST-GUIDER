// Probe raw pixels at known locations in the current normalized floor-1 PNG.
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

const img = decodePng(readFileSync('public/blueprints/mst-floor-1.png'))
const { width: W, height: H, channels: C, data } = img
console.log(`decoded ${W}x${H} channels=${C} dataBytes=${data.length} (expect ${W * H * C})`)

// Left wing hallway interior on the sheet ≈ sheet% (16, 45) → px (104, 196).
// Bottom hallway band ≈ sheet% (50, 67.5) → px (325, 294).
// Paper sample ≈ sheet% (50, 15) → px (325, 65).
for (const [label, xp, yp] of [['left-wing-hall', 16, 45], ['bottom-hall', 50, 67.5], ['paper', 50, 15], ['right-wing-hall', 87.5, 45]]) {
  const x = Math.round((xp / 100) * (W - 1)), y = Math.round((yp / 100) * (H - 1))
  const i = (y * W + x) * C
  console.log(`${label} @ (${x},${y}): rgb(${data[i]},${data[i + 1]},${data[i + 2]}) a=${C === 4 ? data[i + 3] : 255}`)
}
// Histogram quick count of greenish pixels.
let green = 0
for (let i = 0; i < W * H; i++) {
  const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2]
  if (g > r + 18 && g > b + 18) green++
}
console.log(`greenish pixels: ${green} (${(100 * green / (W * H)).toFixed(2)}%)`)
