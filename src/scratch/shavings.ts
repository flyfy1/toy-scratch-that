// Latex shavings (spec 3.6, revised by the lead 2026-11-25): about a third as many, smaller,
// mostly flat crumbs and short flakes with a few curls. On the card they slide towards its lower
// edge and fade; anything over uncovered print is gone within about a second. Off the card they
// settle on the felt as a small heap and are pressed into the felt canvas.
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
  born: number
  resting: boolean
  alpha: number
  /** 0 felt, 1 card over foil, 2 card over uncovered print */
  where: number
  overT: number
  dead: boolean
}

export const CAP = 260

const COL_BODY = '#8E949D'
const COL_LIGHT = '#DADEE4'
const COL_SHADOW = 'rgba(0,0,0,0.25)'

/** A small curl: a tapered, crumpled ribbon (radius 2 to 3.5 px). */
function curlPoly(r: Rng): number[] {
  const rad = rr(r, 2, 3.5)
  const sweep = rr(r, 140, 260) * (Math.PI / 180)
  const lw = rr(r, 1.3, 1.9)
  const N = 6
  const outer: number[] = []
  const inner: number[] = []
  const tight = rr(r, 0.2, 0.45)
  for (let i = 0; i <= N; i++) {
    const f = i / N
    const a = -sweep / 2 + f * sweep + rr(r, -0.06, 0.06)
    const rf = rad * (1 - tight * f) * rr(r, 0.9, 1.08)
    const w = (lw * (0.35 + 0.75 * Math.pow(Math.sin(Math.PI * f), 0.5)) * rr(r, 0.8, 1.2)) / 2
    outer.push(Math.cos(a) * (rf + w), Math.sin(a) * (rf + w))
    inner.push(Math.cos(a) * (rf - w), Math.sin(a) * (rf - w))
  }
  const pts = outer.slice()
  for (let i = inner.length - 2; i >= 0; i -= 2) pts.push(inner[i], inner[i + 1])
  return centre(pts)
}

/** A crumb or short flake: an irregular 4 to 6 sided bit, 1.5 to 3.5 px; flakes are longer. */
function crumbPoly(r: Rng, k: number): number[] {
  const flake = r() < 0.4
  const n = 4 + Math.floor(r() * 3)
  const sz = rr(r, 1.5, 3.5) * k
  const sx = flake ? rr(r, 1.4, 2.0) : 1
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rr(r, -0.3, 0.3)
    const rad = sz * rr(r, 0.35, 0.6)
    pts.push(Math.cos(a) * rad * sx, Math.sin(a) * rad)
  }
  return centre(pts)
}

function centre(pts: number[]) {
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
    const spread = rr(r, -90, 90)
    const curl = !small && r() < 0.22
    const s: Shaving = {
      x: x + rr(r, -2, 2),
      y: y + rr(r, -2, 2),
      vx: 0.3 * pvx + nx * spread,
      // flicked towards you, off the lower edge
      vy: 0.3 * pvy + ny * spread + rr(r, 120, 260),
      a: rr(r, 0, Math.PI * 2),
      va: rr(r, 4, 12) * (r() < 0.5 ? -1 : 1),
      poly: curl ? curlPoly(r) : crumbPoly(r, small ? 0.6 : 1),
      born: t,
      resting: false,
      alpha: 1,
      where: 1,
      overT: 0,
      dead: false,
    }
    this.list.push(s)
    return s
  }

  /**
   * where(x, y): 0 felt, 1 card over foil, 2 card over uncovered print.
   * down: unit vector of the card's "down" in screen space.
   */
  update(dt: number, t: number, where: (x: number, y: number) => number, dx: number, dy: number) {
    const fCard = Math.pow(0.95, dt * 60)
    const fFelt = Math.pow(0.8, dt * 60)
    let anyDead = false
    for (const s of this.list) {
      const w = where(s.x, s.y)
      s.where = w
      if (w > 0) {
        // the card is a slope: everything on it slides towards its lower edge
        s.vx += dx * 520 * dt
        s.vy += dy * 520 * dt
        s.resting = false
      }
      if (!s.resting) {
        const f = w > 0 ? fCard : fFelt
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.a += s.va * dt
        s.vx *= f
        s.vy *= f
        s.va *= f
        if (w === 0 && s.vx * s.vx + s.vy * s.vy < 16) {
          s.vx = s.vy = 0
          s.va = 0
          s.resting = true
        }
      }
      const age = (t - s.born) / 1000
      if (w > 0) {
        // fade to 40% over two seconds; over uncovered print, gone within about a second
        s.overT = w === 2 ? s.overT + dt : Math.max(0, s.overT - dt * 0.5)
        let a = 1 - 0.6 * Math.min(1, Math.max(0, age - 0.3) / 1.7)
        if (s.overT > 0.35) a = Math.min(a, Math.max(0, 1 - (s.overT - 0.35) / 0.55))
        s.alpha = a
        if (a <= 0.01) {
          s.dead = true
          anyDead = true
        }
      } else {
        s.alpha = Math.min(1, s.alpha + dt * 3)
        s.overT = 0
      }
    }
    if (anyDead) this.list = this.list.filter((s) => !s.dead)
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
      const ox = s.x - (x0 + dx * u)
      const oy = s.y - (y0 + dy * u)
      const d2 = ox * ox + oy * oy
      if (d2 > reach2) continue
      const d = Math.sqrt(d2) || 1
      const fall = 1 - d / reach
      s.vx += (pvx * 0.5 + (ox / d) * sp * 0.3) * (0.4 + 0.6 * fall)
      s.vy += (pvy * 0.5 + (oy / d) * sp * 0.3) * (0.4 + 0.6 * fall)
      s.va += (this.r() - 0.5) * 8
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

  /** Batched by alpha band: shadow (+1, +1.5), light rim (offset up-left, under), body. */
  draw(g: CanvasRenderingContext2D) {
    if (!this.list.length) return
    const bands = [0.25, 0.5, 0.75, 1]
    g.save()
    for (let b = 0; b < bands.length; b++) {
      const lo = b ? bands[b - 1] : 0.01
      const hi = bands[b]
      const sel = this.list.filter((s) => s.alpha > lo && s.alpha <= hi + 1e-6)
      if (!sel.length) continue
      g.globalAlpha = hi
      for (const [ox, oy, col] of [
        [1, 1.5, COL_SHADOW],
        [-0.6, -0.7, COL_LIGHT],
        [0, 0, COL_BODY],
      ] as const) {
        g.fillStyle = col
        g.beginPath()
        for (const s of sel) this.path(g, s, s.x + ox, s.y + oy, 0)
        g.fill()
      }
    }
    g.restore()
  }

  /** Draw one shaving into a bake canvas (the felt); g already transformed. */
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
