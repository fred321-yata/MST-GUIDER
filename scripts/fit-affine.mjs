// Fit an affine correction (sx, tx, sy, ty) mapping the code's percent grid
// onto the drawing's green hallway ink, pooled across all four normalized
// floors: newPct = sx * oldPct + tx (per axis). Coarse-to-fine search.
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
  return { width, height, colorType, channels, palette: null, trns: null, data: out }
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

const CODE_V = [11.2, 17.8, 29.3, 40.8, 46.5, 51.8, 55.4, 65.9, 73.9, 83.9, 86.5, 91.9, 98.9]
const CODE_H = [31.5, 40, 41.7, 54, 57, 60.5, 66.3, 71.5, 74.8, 81.2, 86.2]
const GRID = { x0: 11.2, x1: 98.9, y0: 31.5, y1: 86.2 }

// Load normalized floors.
const floors = []
for (const floor of [1, 2, 3, 4]) {
  const img = decodePng(readFileSync(`public/blueprints/mst-floor-${floor}.png`))
  const W = img.width, H = img.height
  const green = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b, a] = pixelAt(img, x, y)
    if (a < 40) continue
    if (g > r + 18 && g > b + 18) green[y * W + x] = 1
  }
  floors.push({ W, H, green })
}

// Score pooled across floors. (sx, tx) affine on x, identity-ish on y, etc.
// Full affine: sample grid lines transformed by (sx, tx, sy, ty).
function score(sx, tx, sy, ty) {
  const map = (p, s, t) => s * p + t
  let hit = 0, total = 0
  for (const f of floors) {
    const { W, H, green } = f
    const X = (p) => Math.round((map(p, sx, tx) / 100) * (W - 1))
    const Y = (p) => Math.round((map(p, sy, ty) / 100) * (H - 1))
    const y0 = Math.max(0, Y(GRID.y0)), y1 = Math.min(H - 1, Y(GRID.y1))
    const x0 = Math.max(0, X(GRID.x0)), x1 = Math.min(W - 1, X(GRID.x1))
    for (const vx of CODE_V) {
      const Xp = X(vx)
      if (Xp < 0 || Xp + 1 >= W) { total += Math.ceil((y1 - y0) / 2) * 2; continue }
      for (let t = y0; t <= y1; t += 2) {
        total++; if (green[t * W + Xp]) hit++
        total++; if (green[t * W + Xp + 1]) hit++
      }
    }
    for (const hy of CODE_H) {
      const Yp = Y(hy)
      if (Yp < 0 || Yp + 1 >= H) { total += Math.ceil((x1 - x0) / 2) * 2; continue }
      for (let t = x0; t <= x1; t += 2) {
        total++; if (green[Yp * W + t]) hit++
        total++; if (green[(Yp + 1) * W + t]) hit++
      }
    }
  }
  return hit / total
}

// Stage 1: coarse scale+offset per axis (identity on the other axis).
let best = { sx: 1, tx: 0, sy: 1, ty: 0, s: score(1, 0, 1, 0) }
console.log(`identity score: ${best.s.toFixed(3)}`)
for (let sx = 0.8; sx <= 1.15; sx += 0.025) {
  for (let tx = -8; tx <= 8; tx += 1) {
    const s = score(sx, tx, 1, 0)
    if (s > best.s) best = { ...best, sx, tx, s }
  }
}
console.log(`after x pass: sx=${best.sx} tx=${best.tx} s=${best.s.toFixed(3)}`)
for (let sy = 0.8; sy <= 1.4; sy += 0.025) {
  for (let ty = -15; ty <= 15; ty += 1) {
    const s = score(best.sx, best.tx, sy, ty)
    if (s > best.s) best = { ...best, sy, ty, s }
  }
}
console.log(`after y pass: sy=${best.sy} ty=${best.ty} s=${best.s.toFixed(3)}`)
// Stage 2: refine both axes alternately at 0.005 / 0.25.
for (let iter = 0; iter < 3; iter++) {
  for (let sx = best.sx - 0.03; sx <= best.sx + 0.03; sx += 0.005) {
    for (let tx = best.tx - 1; tx <= best.tx + 1; tx += 0.25) {
      const s = score(sx, tx, best.sy, best.ty)
      if (s > best.s) best = { ...best, sx, tx, s }
    }
  }
  for (let sy = best.sy - 0.03; sy <= best.sy + 0.03; sy += 0.005) {
    for (let ty = best.ty - 1; ty <= best.ty + 1; ty += 0.25) {
      const s = score(best.sx, best.tx, sy, ty)
      if (s > best.s) best = { ...best, sy, ty, s }
    }
  }
  console.log(`refine ${iter + 1}: sx=${best.sx.toFixed(3)} tx=${best.tx.toFixed(2)} sy=${best.sy.toFixed(3)} ty=${best.ty.toFixed(2)} s=${best.s.toFixed(3)}`)
}
console.log(`\nFINAL: x' = ${best.sx.toFixed(4)}·x + ${best.tx.toFixed(2)}   y' = ${best.sy.toFixed(4)}·y + ${best.ty.toFixed(2)}  (score ${best.s.toFixed(3)}, identity ${score(1, 0, 1, 0).toFixed(3)})`)
// Sample key transformed values.
const tf = (p, s, t) => +(s * p + t).toFixed(1)
console.log(`key: HALL_X_LEFT ${tf(17.5, best.sx, best.tx)}, HALL_X_RIGHT ${tf(86.5, best.sx, best.tx)}, HALL_Y_TOP ${tf(40, best.sy, best.ty)}, HALL_Y_BOTTOM ${tf(60.5, best.sy, best.ty)}, x11.2→${tf(11.2, best.sx, best.tx)}, x98.9→${tf(98.9, best.sx, best.tx)}, y31.5→${tf(31.5, best.sy, best.ty)}, y86.2→${tf(86.2, best.sy, best.ty)}`)
