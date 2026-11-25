// Small shared helpers for the scratch toy: seeded RNG, canvases, shapes, easing.

export type Ctx = CanvasRenderingContext2D
export const TAU = Math.PI * 2
export const DEG = Math.PI / 180

/** mulberry32: every baked detail and every card comes from a seed, so stills repeat. */
export function rng(seed: number) {
  let a = seed >>> 0 || 1
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return r
}
export type Rng = ReturnType<typeof rng>
export const rr = (r: Rng, a: number, b: number) => a + r() * (b - a)
export const ri = (r: Rng, a: number, b: number) => Math.floor(a + r() * (b - a + 1))

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}
export const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d')!

export function roundRectPath(c: Ctx | Path2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2)
  c.moveTo(x + r, y)
  c.lineTo(x + w - r, y)
  c.arcTo(x + w, y, x + w, y + r, r)
  c.lineTo(x + w, y + h - r)
  c.arcTo(x + w, y + h, x + w - r, y + h, r)
  c.lineTo(x + r, y + h)
  c.arcTo(x, y + h, x, y + h - r, r)
  c.lineTo(x, y + r)
  c.arcTo(x, y, x + r, y, r)
  c.closePath()
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInCubic = (t: number) => t * t * t
/** ease-out-back with a tunable overshoot (1.70158 is the classic 10%). */
export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)

/** Linear gradient across a w x h box at a CSS angle (deg): 90 = left to right. */
export function cssAngleGradient(c: Ctx, x: number, y: number, w: number, h: number, deg: number) {
  const a = deg * DEG
  const dx = Math.sin(a)
  const dy = -Math.cos(a)
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const cx = x + w / 2
  const cy = y + h / 2
  return c.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
}

export const FONT_SANS = 'system-ui, -apple-system, "Helvetica Neue", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", sans-serif'
export const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
