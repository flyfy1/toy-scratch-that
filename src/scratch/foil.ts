// Scratch-off foil (spec 3.5): texture, mask, residue, cell grid, the coin-edge brush, per-frame composite.
import type { RegionDef } from './layout'
import { DEG, type Rng, cssAngleGradient, ctx2d, makeCanvas, rng, roundRectPath, rr, ri, FONT_SANS } from './util'

export const CELL = 0.5 // U
export const FOIL = 0
export const SCRAPED = 1
export const CLEAN = 2
const SECOND_PASS_MS = 250

// ---------- brushes ----------

export interface Brush {
  c: HTMLCanvasElement
  /** device px, along the stroke (x) and across it (y) */
  w: number
  h: number
}

/**
 * Four coin-edge stamps, 2.4 U across by 2.0 U along: a squarish blob with a wobbly outline,
 * 14 to 20 comb notches bitten into the leading and trailing edges, and a few pinholes.
 */
export function makeBrushes(K: number, dpr: number, seed: number): Brush[] {
  const out: Brush[] = []
  for (let k = 0; k < 4; k++) {
    const r = rng(seed * 31 + k * 977 + 5)
    const b = 1.0 * K // along semi-axis
    const a = 1.2 * K // across semi-axis
    const w = Math.ceil(2 * b + 6)
    const h = Math.ceil(2 * a + 6)
    const c = makeCanvas(w, h)
    const g = ctx2d(c)
    const img = g.createImageData(c.width, c.height)
    const d = img.data
    const cx = c.width / 2
    const cy = c.height / 2
    const P = 2.7
    // outline wobble: a few harmonics of the polar angle
    const harm: [number, number, number][] = []
    for (let i = 0; i < 7; i++) harm.push([ri(r, 3, 17), rr(r, 0, Math.PI * 2), rr(r, 0.006, 0.03)])
    // comb notches on the leading (+x) and trailing (-x) edges
    const notches: { side: number; y: number; hw: number; depth: number }[] = []
    const nN = ri(r, 14, 20)
    for (let i = 0; i < nN; i++) {
      notches.push({ side: r() < 0.55 ? 1 : -1, y: rr(r, -0.9, 0.9), hw: (rr(r, 1, 3) * dpr * 0.5) / a, depth: rr(r, 0.25, 0.7) })
    }
    const holes: { x: number; y: number; r: number }[] = []
    const nH = ri(r, 6, 10)
    for (let i = 0; i < nH; i++) holes.push({ x: rr(r, -0.75, 0.75) * b, y: rr(r, -0.8, 0.8) * a, r: rr(r, 0.6, 1.5) * dpr })
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const nx = (x + 0.5 - cx) / b
        const ny = (y + 0.5 - cy) / a
        const th = Math.atan2(ny, nx)
        let rad = 1
        for (const [f, ph, amp] of harm) rad += amp * Math.sin(f * th + ph)
        const dd = Math.pow(Math.pow(Math.abs(nx), P) + Math.pow(Math.abs(ny), P), 1 / P)
        // 1 device px feather
        let al = Math.max(0, Math.min(1, (rad - dd) * Math.min(a, b) + 0.5))
        if (al > 0) {
          const edgeX = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(ny), P)), 1 / P)
          for (const n of notches) {
            if (Math.abs(ny - n.y) < n.hw && Math.sign(nx) === n.side && Math.abs(nx) > edgeX - n.depth) {
              al = 0
              break
            }
          }
          if (al > 0) {
            for (const hh of holes) {
              const dx = x + 0.5 - cx - hh.x
              const dy = y + 0.5 - cy - hh.y
              if (dx * dx + dy * dy < hh.r * hh.r) {
                al = 0
                break
              }
            }
          }
        }
        const i = (y * c.width + x) * 4
        d[i + 3] = Math.round(al * 255)
      }
    }
    g.putImageData(img, 0, 0)
    out.push({ c, w: c.width, h: c.height })
  }
  return out
}

// ---------- region ----------

const NOISE_TILE = 128
let noiseTile: Int8Array | null = null
function grain(): Int8Array {
  if (noiseTile) return noiseTile
  const r = rng(424242)
  noiseTile = new Int8Array(NOISE_TILE * NOISE_TILE)
  for (let i = 0; i < noiseTile.length; i++) noiseTile[i] = Math.round((r() * 2 - 1) * 6)
  return noiseTile
}

export class Region {
  readonly def: RegionDef
  readonly K: number
  readonly wpx: number
  readonly hpx: number
  readonly tex: HTMLCanvasElement
  readonly mask: HTMLCanvasElement
  readonly resTex: HTMLCanvasElement
  readonly resMask: HTMLCanvasElement
  readonly cols: number
  readonly rows: number
  readonly state: Uint8Array
  readonly sid: Int32Array
  readonly t0: Float64Array
  marked = 0
  cleaned = 0
  get total() {
    return this.state.length
  }
  get coverage() {
    return this.marked / this.state.length
  }

  constructor(def: RegionDef, K: number, dpr: number, seed: number, word: string) {
    this.def = def
    this.K = K
    this.wpx = Math.ceil(def.w * K)
    this.hpx = Math.ceil(def.h * K)
    this.cols = Math.ceil(def.w / CELL)
    this.rows = Math.ceil(def.h / CELL)
    const n = this.cols * this.rows
    this.state = new Uint8Array(n)
    this.sid = new Int32Array(n)
    this.t0 = new Float64Array(n)
    const r = rng(seed)
    const { tex, pix } = this.bakeTex(r, dpr, word)
    this.tex = tex
    this.resTex = this.bakeResidue(r, dpr, pix)
    this.mask = makeCanvas(this.wpx, this.hpx)
    const m = ctx2d(this.mask)
    m.fillStyle = '#000'
    m.beginPath()
    roundRectPath(m, 0, 0, this.wpx, this.hpx, 0.25 * K)
    m.fill()
    this.resMask = makeCanvas(this.wpx, this.hpx)
    const rm = ctx2d(this.resMask)
    rm.fillStyle = '#000'
    rm.fillRect(0, 0, this.wpx, this.hpx)
  }

  private bakeTex(r: Rng, dpr: number, word: string) {
    const { wpx: W, hpx: H, K } = this
    const c = makeCanvas(W, H)
    const g = ctx2d(c)
    g.save()
    g.beginPath()
    roundRectPath(g, 0, 0, W, H, 0.25 * K)
    g.clip()
    const lg = cssAngleGradient(g, 0, 0, W, H, 100)
    lg.addColorStop(0, '#B9BEC7')
    lg.addColorStop(0.3, '#D9DDE3')
    lg.addColorStop(0.55, '#AEB4BE')
    lg.addColorStop(0.8, '#CDD2D9')
    lg.addColorStop(1, '#A3A9B4')
    g.fillStyle = lg
    g.fillRect(0, 0, W, H)
    // grain, +-6 in value from a 128 px tile
    const img = g.getImageData(0, 0, W, H)
    const d = img.data
    const tile = grain()
    for (let y = 0; y < H; y++) {
      const ty = (y % NOISE_TILE) * NOISE_TILE
      for (let x = 0; x < W; x++) {
        const v = tile[ty + (x % NOISE_TILE)]
        const i = (y * W + x) * 4
        d[i] += v
        d[i + 1] += v
        d[i + 2] += v
      }
    }
    g.putImageData(img, 0, 0)
    // brushed streaks
    const area = (this.def.w * this.def.h) / (17 * 11.6)
    const nS = Math.max(90, Math.round(400 * Math.sqrt(area)))
    g.lineWidth = Math.max(1, dpr * 0.6)
    for (let i = 0; i < nS; i++) {
      const L = rr(r, 20, 120) * dpr * 0.6
      const x = rr(r, -L, W)
      const y = rr(r, 0, H)
      g.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(126,133,145,0.06)'
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + L, y + rr(r, -0.6, 0.6))
      g.stroke()
    }
    // overprint
    if (this.def.id === 'void') {
      g.save()
      g.globalAlpha = 0.5
      g.fillStyle = '#8A919C'
      const p = 0.5 * K
      for (let x = -H; x < W + H; x += p) {
        g.beginPath()
        g.moveTo(x, H)
        g.lineTo(x + p * 0.5, H)
        g.lineTo(x + p * 0.5 + H, 0)
        g.lineTo(x + H, 0)
        g.closePath()
        g.fill()
      }
      g.restore()
    } else {
      g.save()
      g.translate(W / 2, H / 2)
      g.rotate(-18 * DEG)
      g.fillStyle = 'rgba(138,145,156,0.55)'
      g.strokeStyle = 'rgba(138,145,156,0.55)'
      g.lineWidth = Math.max(1, 0.07 * K)
      g.font = `700 ${0.7 * K}px ${FONT_SANS}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const ww = g.measureText(word).width
      const maxW = 2.35 * K
      const sx = ww > maxW ? maxW / ww : 1
      const bw = 3.4 * K
      const bh = 1.5 * K
      const R = Math.hypot(W, H) / 2 + bw
      for (let j = Math.floor(-R / bh); j <= R / bh; j++) {
        const off = (j & 1) * bw * 0.5
        for (let i = Math.floor(-R / bw) - 1; i <= R / bw; i++) {
          const x = i * bw + off
          const y = j * bh
          g.save()
          g.translate(x, y)
          g.scale(sx, 1)
          g.fillText(word, 0, 0)
          g.restore()
          g.beginPath()
          g.arc(x + bw / 2, y, 0.3 * K, 0, Math.PI * 2)
          g.stroke()
        }
      }
      g.restore()
    }
    g.restore()
    // rim
    g.strokeStyle = '#8A919C'
    g.lineWidth = Math.max(1, dpr * 0.5)
    g.beginPath()
    roundRectPath(g, g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth, 0.25 * K)
    g.stroke()
    return { tex: c, pix: g.getImageData(0, 0, W, H).data }
  }

  /** Leftover latex: thin horizontal-ish flecks in clusters, about 14% of the area, plus specks. */
  private bakeResidue(r: Rng, dpr: number, pix: Uint8ClampedArray) {
    const { wpx: W, hpx: H } = this
    const c = makeCanvas(W, H)
    const g = ctx2d(c)
    const area = (this.def.w * this.def.h) / (17 * 11.6)
    const nF = Math.max(140, Math.round(1200 * area))
    const nP = Math.max(70, Math.round(600 * area))
    const sample = (x: number, y: number, dark: number) => {
      const xi = Math.max(0, Math.min(W - 1, x | 0))
      const yi = Math.max(0, Math.min(H - 1, y | 0))
      const i = (yi * W + xi) * 4
      return `rgb(${pix[i] - dark},${pix[i + 1] - dark},${pix[i + 2] - dark})`
    }
    // clusters: a residue band is where the coin skipped, so flecks bunch up in rows
    const nC = Math.max(6, Math.round(70 * area))
    const clusters: { x: number; y: number; sx: number; sy: number }[] = []
    for (let i = 0; i < nC; i++) clusters.push({ x: rr(r, 0, W), y: rr(r, 0, H), sx: rr(r, 0.6, 2.2) * this.K, sy: rr(r, 0.15, 0.5) * this.K })
    for (let i = 0; i < nF; i++) {
      let x: number
      let y: number
      if (r() < 0.62) {
        const cl = clusters[Math.floor(r() * nC)]
        x = cl.x + (r() + r() + r() - 1.5) * cl.sx
        y = cl.y + (r() + r() - 1) * cl.sy
      } else {
        x = rr(r, 0, W)
        y = rr(r, 0, H)
      }
      const L = rr(r, 2, 14) * dpr * (r() < 0.2 ? 1.4 : 1)
      const wd = rr(r, 1, 2) * dpr * 0.8
      const ang = rr(r, -25, 25) * DEG * (r() < 0.7 ? 0.4 : 1)
      g.globalAlpha = rr(r, 0.5, 0.9)
      g.fillStyle = sample(x, y, ri(r, -6, 26))
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      // a sliver: pointed at both ends, fatter a bit off-centre, one ragged side
      const k = rr(r, 0.3, 0.7)
      const pts: [number, number][] = [
        [0, 0],
        [L * k * 0.5, -wd * rr(r, 0.3, 0.6)],
        [L * k, -wd * 0.5],
        [L * (k + (1 - k) * 0.5), -wd * rr(r, 0.2, 0.5)],
        [L, rr(r, -0.3, 0.3) * wd],
        [L * (k + (1 - k) * 0.4), wd * rr(r, 0.2, 0.5)],
        [L * k, wd * 0.5],
        [L * k * 0.4, wd * rr(r, 0.2, 0.5)],
      ]
      g.beginPath()
      pts.forEach(([px, py], j) => {
        const X = x + px * ca - py * sa
        const Y = y + px * sa + py * ca
        if (j) g.lineTo(X, Y)
        else g.moveTo(X, Y)
      })
      g.closePath()
      g.fill()
    }
    for (let i = 0; i < nP; i++) {
      const x = rr(r, 0, W)
      const y = rr(r, 0, H)
      g.globalAlpha = rr(r, 0.5, 0.9)
      g.fillStyle = sample(x, y, ri(r, 0, 30))
      g.fillRect(x, y, dpr, dpr)
    }
    g.globalAlpha = 1
    return c
  }

  /** Does this region's bounds (plus a margin, U) contain the point? */
  near(ux: number, uy: number, m: number) {
    const d = this.def
    return ux > d.x - m && ux < d.x + d.w + m && uy > d.y - m && uy < d.y + d.h + m
  }

  cellAt(ux: number, uy: number): number {
    const d = this.def
    const cx = Math.floor((ux - d.x) / CELL)
    const cy = Math.floor((uy - d.y) / CELL)
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1
    return cy * this.cols + cx
  }

  /** Cut one stamp (U coordinates, rotation in card space). Returns cells changed. */
  stamp(br: Brush, ux: number, uy: number, ang: number, s: number, strokeId: number, t: number, chips: Rng): { fresh: number; clean: number } {
    const d = this.def
    const K = this.K
    // cells under the footprint ellipse: 1.1 U across, 0.8 U along
    const ea = 0.8 * s
    const eb = 1.1 * s
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    const R = eb + CELL
    const c0 = Math.max(0, Math.floor((ux - R - d.x) / CELL))
    const c1 = Math.min(this.cols - 1, Math.floor((ux + R - d.x) / CELL))
    const r0 = Math.max(0, Math.floor((uy - R - d.y) / CELL))
    const r1 = Math.min(this.rows - 1, Math.floor((uy + R - d.y) / CELL))
    let fresh = 0
    let clean = 0
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const px = d.x + (col + 0.5) * CELL - ux
        const py = d.y + (row + 0.5) * CELL - uy
        const al = px * ca + py * sa
        const ac = -px * sa + py * ca
        if ((al / ea) ** 2 + (ac / eb) ** 2 > 1) continue
        const i = row * this.cols + col
        const st = this.state[i]
        if (st === FOIL) {
          this.state[i] = SCRAPED
          this.sid[i] = strokeId
          this.t0[i] = t
          this.marked++
          fresh++
        } else if (st === SCRAPED && (this.sid[i] !== strokeId || t - this.t0[i] > SECOND_PASS_MS)) {
          this.state[i] = CLEAN
          this.cleaned++
          clean++
        }
      }
    }
    const lx = (ux - d.x) * K
    const ly = (uy - d.y) * K
    const cut = (cv: HTMLCanvasElement, withChips: boolean) => {
      const g = ctx2d(cv)
      g.save()
      g.globalCompositeOperation = 'destination-out'
      g.translate(lx, ly)
      g.rotate(ang)
      g.scale(s, s)
      g.drawImage(br.c, -br.w / 2, -br.h / 2)
      if (withChips) {
        // torn bites just past the coin's sides, so the stroke edge is ragged, not ruled
        g.fillStyle = '#000'
        for (const side of [-1, 1]) {
          if (chips() < 0.45) {
            const y0 = side * rr(chips, 1.08, 1.24) * K
            const x0 = rr(chips, -0.5, 0.5) * K
            const len = rr(chips, 0.12, 0.42) * K
            const dep = rr(chips, 0.06, 0.2) * K
            g.beginPath()
            g.moveTo(x0 - len / 2, y0 - side * dep * 0.9)
            g.lineTo(x0 - len * 0.15, y0 + side * dep * rr(chips, 0.2, 0.6))
            g.lineTo(x0 + len * 0.1, y0 + side * dep * 0.35)
            g.lineTo(x0 + len / 2, y0 - side * dep * 0.9)
            g.closePath()
            g.fill()
          }
        }
      }
      g.restore()
    }
    cut(this.mask, true)
    if (clean > 0) cut(this.resMask, false)
    return { fresh, clean }
  }

  /** Clear everything (dev: shot setup). */
  wipe(resToo: boolean) {
    const m = ctx2d(this.mask)
    m.clearRect(0, 0, this.wpx, this.hpx)
    if (resToo) ctx2d(this.resMask).clearRect(0, 0, this.wpx, this.hpx)
    this.state.fill(resToo ? CLEAN : SCRAPED)
    this.marked = this.total
  }
}

// ---------- per-frame composite ----------

export interface FoilFrame {
  buf: HTMLCanvasElement
  bctx: CanvasRenderingContext2D
}

export function makeFoilFrame(regions: Region[]): FoilFrame {
  const w = Math.max(...regions.map((r) => r.wpx))
  const h = Math.max(...regions.map((r) => r.hpx))
  const buf = makeCanvas(w, h)
  return { buf, bctx: ctx2d(buf) }
}

const SHEEN_DIR = [Math.sin(100 * DEG), -Math.cos(100 * DEG)]

/**
 * Draw one region onto `g`, which is in card space with 1 unit = 1 U (css size U px).
 * sheenX: centre of the sheen band, card U.
 */
export function drawRegion(g: CanvasRenderingContext2D, ff: FoilFrame, R: Region, U: number, sheenX: number, sheenA = 0.22) {
  if (R.coverage >= 1 && R.cleaned >= R.total) return
  const { buf, bctx: b } = ff
  const d = R.def
  const W = R.wpx
  const H = R.hpx
  const X = d.x
  const Y = d.y
  const DW = d.w
  const DH = d.h
  const px = 1 / U // one css px in U
  const put = (ox: number, oy: number) => g.drawImage(buf, 0, 0, W, H, X + ox * px, Y + oy * px, DW, DH)
  b.globalCompositeOperation = 'copy'
  // 0. residue, only where something was scraped
  if (R.marked > 0) {
    b.drawImage(R.resTex, 0, 0)
    b.globalCompositeOperation = 'destination-in'
    b.drawImage(R.resMask, 0, 0)
    put(0, 0)
  }
  if (R.coverage < 1) {
    // 1. dark lip, lower right
    b.globalCompositeOperation = 'copy'
    b.drawImage(R.mask, 0, 0)
    b.globalCompositeOperation = 'source-in'
    b.fillStyle = 'rgba(40,30,20,0.38)'
    b.fillRect(0, 0, W, H)
    put(1.0, 1.5)
    // 2. light hairline, upper left (under the foil)
    b.fillStyle = 'rgba(255,255,255,0.35)'
    b.fillRect(0, 0, W, H)
    put(-0.6, -0.8)
    // 3. foil with sheen
    b.globalCompositeOperation = 'copy'
    b.drawImage(R.tex, 0, 0)
    b.globalCompositeOperation = 'destination-in'
    b.drawImage(R.mask, 0, 0)
    b.globalCompositeOperation = 'source-atop'
    const K = R.K
    const cx = (sheenX - d.x) * K
    const cy = H / 2
    const hw = 2 * K
    const sg = b.createLinearGradient(cx - SHEEN_DIR[0] * hw, cy - SHEEN_DIR[1] * hw, cx + SHEEN_DIR[0] * hw, cy + SHEEN_DIR[1] * hw)
    sg.addColorStop(0, 'rgba(255,255,255,0)')
    sg.addColorStop(0.5, `rgba(255,255,255,${sheenA})`)
    sg.addColorStop(1, 'rgba(255,255,255,0)')
    b.fillStyle = sg
    b.fillRect(0, 0, W, H)
    put(0, 0)
  }
  b.globalCompositeOperation = 'source-over'
}
