// Latex shavings (spec 3.6, L7 / L1): curled ribbons and flat flakes, top-down, pushed by the finger.
import { type Rng, rr } from './util'

export interface Shaving {
  x: number
  y: number
  vx: number
  vy: number
  a: number
  va: number
  /** outline in local px, (x, y) pairs */
  poly: number[]
  flat: boolean
  born: number
  resting: boolean
}

export const CAP = 420

const COL_BODY = '#8E949D'
const COL_LIGHT = '#DADEE4'
const COL_SHADOW = 'rgba(0,0,0,0.25)'

/**
 * A curl is a tapered spiral ribbon (radius 3 to 7 px, sweep 120 to 300 degrees, 1.6 to 2.6 px at its
 * thickest): thin at both ends and tightening towards the inner end, so it reads as a rolled shaving.
 */
function curlPoly(r: Rng): number[] {
  // most curls are small and tight; a few big open ones
  const u = r()
  const rad = 3 + 4 * u * u
  const sweep = rr(r, 120, 300 - 90 * u) * (Math.PI / 180)
  const lw = rr(r, 1.6, 2.6)
  const N = 7
  const outer: number[] = []
  const inner: number[] = []
  const tight = rr(r, 0.2, 0.5)
  for (let i = 0; i <= N; i++) {
    const f = i / N
    const a = -sweep / 2 + f * sweep + rr(r, -0.06, 0.06)
    // crumpled, not calligraphic: the radius and the width wander from vertex to vertex
    const rf = rad * (1 - tight * f) * rr(r, 0.9, 1.08)
    const w = (lw * (0.35 + 0.75 * Math.pow(Math.sin(Math.PI * f), 0.5)) * rr(r, 0.8, 1.2)) / 2
    outer.push(Math.cos(a) * (rf + w), Math.sin(a) * (rf + w))
    inner.push(Math.cos(a) * (rf - w), Math.sin(a) * (rf - w))
  }
  const pts = outer.slice()
  for (let i = inner.length - 2; i >= 0; i -= 2) pts.push(inner[i], inner[i + 1])
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i += 2) {
    cx += pts[i]
    cy += pts[i + 1]
  }
  cx /= pts.length / 2
  cy /= pts.length / 2
  for (let i = 0; i < pts.length; i += 2) {
    pts[i] -= cx
    pts[i + 1] -= cy
  }
  return pts
}

/** A flat flake: an irregular quad, 3 to 6 px (half that for second-pass flecks). */
function flakePoly(r: Rng, k: number): number[] {
  const sz = rr(r, 3, 6) * k
  const pts: number[] = []
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rr(r, -0.45, 0.45)
    const rad = sz * rr(r, 0.35, 0.65)
    pts.push(Math.cos(a) * rad, Math.sin(a) * rad)
  }
  return pts
}

export class Shavings {
  list: Shaving[] = []
  /** spawn budget carried between stamps */
  carry = 0
  carryFlake = 0

  constructor(private r: Rng) {}

  spawn(x: number, y: number, pvx: number, pvy: number, t: number, small = false) {
    const r = this.r
    const sp = Math.hypot(pvx, pvy)
    const nx = sp > 1 ? -pvy / sp : Math.cos(r() * 6.28)
    const ny = sp > 1 ? pvx / sp : Math.sin(r() * 6.28)
    const spread = rr(r, -120, 120)
    const flat = small || r() < 0.2
    const s: Shaving = {
      x: x + rr(r, -3, 3),
      y: y + rr(r, -3, 3),
      vx: 0.35 * pvx + nx * spread,
      vy: 0.35 * pvy + ny * spread,
      a: rr(r, 0, Math.PI * 2),
      va: rr(r, 4, 12) * (r() < 0.5 ? -1 : 1),
      poly: flat ? flakePoly(r, small ? 0.5 : 1) : curlPoly(r),
      flat,
      born: t,
      resting: false,
    }
    this.list.push(s)
    return s
  }

  /** Friction 0.86 per 60 fps frame, spin decays the same; under 4 px/s it stops. */
  update(dt: number) {
    const f = Math.pow(0.86, dt * 60)
    for (const s of this.list) {
      if (s.resting) continue
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.a += s.va * dt
      s.vx *= f
      s.vy *= f
      s.va *= f
      if (s.vx * s.vx + s.vy * s.vy < 16) {
        s.vx = s.vy = 0
        s.va = 0
        s.resting = true
      }
    }
  }

  /** A moving fingertip ploughs them: pointer velocity * 0.5 added, away from its path. */
  push(x0: number, y0: number, x1: number, y1: number, pvx: number, pvy: number, reach: number) {
    const sp = Math.hypot(pvx, pvy)
    if (sp < 20) return
    const dx = x1 - x0
    const dy = y1 - y0
    const L2 = dx * dx + dy * dy || 1
    const reach2 = reach * reach
    for (const s of this.list) {
      let u = ((s.x - x0) * dx + (s.y - y0) * dy) / L2
      u = u < 0 ? 0 : u > 1 ? 1 : u
      const cx = x0 + dx * u
      const cy = y0 + dy * u
      const ox = s.x - cx
      const oy = s.y - cy
      const d2 = ox * ox + oy * oy
      if (d2 > reach2) continue
      const d = Math.sqrt(d2) || 1
      const fall = 1 - d / reach
      s.vx += (pvx * 0.5 + (ox / d) * sp * 0.3) * (0.4 + 0.6 * fall)
      s.vy += (pvy * 0.5 + (oy / d) * sp * 0.3) * (0.4 + 0.6 * fall)
      s.va += (Math.random() - 0.5) * 8
      const v = Math.hypot(s.vx, s.vy)
      const cap = sp * 1.1
      if (v > cap) {
        s.vx *= cap / v
        s.vy *= cap / v
      }
      s.resting = false
    }
  }

  private path(g: CanvasRenderingContext2D, s: Shaving, x: number, y: number, rot: number) {
    const p = s.poly
    const c = Math.cos(s.a + rot)
    const sn = Math.sin(s.a + rot)
    g.moveTo(x + p[0] * c - p[1] * sn, y + p[0] * sn + p[1] * c)
    for (let i = 2; i < p.length; i += 2) g.lineTo(x + p[i] * c - p[i + 1] * sn, y + p[i] * sn + p[i + 1] * c)
    g.closePath()
  }

  /** Batched: shadow (+1, +1.5), a light rim (the body offset up-left, under), the body. Three fills. */
  draw(g: CanvasRenderingContext2D) {
    if (!this.list.length) return
    const pass = (ox: number, oy: number, col: string) => {
      g.fillStyle = col
      g.beginPath()
      for (const s of this.list) this.path(g, s, s.x + ox, s.y + oy, 0)
      g.fill()
    }
    pass(1, 1.5, COL_SHADOW)
    pass(-0.6, -0.7, COL_LIGHT)
    pass(0, 0, COL_BODY)
  }

  /** Draw one shaving into a bake canvas (the felt or a card's crumb layer); g already transformed. */
  drawOne(g: CanvasRenderingContext2D, s: Shaving, x: number, y: number, rot: number) {
    for (const [ox, oy, col] of [
      [1, 1.5, COL_SHADOW],
      [-0.6, -0.7, COL_LIGHT],
      [0, 0, COL_BODY],
    ] as const) {
      g.fillStyle = col
      g.beginPath()
      this.path(g, s, x + ox, y + oy, rot)
      g.fill()
    }
  }
}
