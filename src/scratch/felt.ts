// The green felt counter (spec 3.3, L0). Resting table shavings are stamped straight into it (L1).
import { ctx2d, makeCanvas, rng, rr } from './util'

export function bakeFelt(w: number, h: number, dpr: number, seed: number): HTMLCanvasElement {
  const W = Math.round(w * dpr)
  const H = Math.round(h * dpr)
  const c = makeCanvas(W, H)
  const g = ctx2d(c)
  const r = rng(seed * 17 + 1)
  g.fillStyle = '#1F4D3A'
  g.fillRect(0, 0, W, H)
  const vg = g.createRadialGradient(0.45 * W, 0.4 * H, 0, 0.45 * W, 0.4 * H, 0.8 * Math.max(W, H))
  vg.addColorStop(0, 'rgba(20,53,40,0)')
  vg.addColorStop(0.45, 'rgba(20,53,40,0.15)')
  vg.addColorStop(1, 'rgba(20,53,40,1)')
  g.fillStyle = vg
  g.fillRect(0, 0, W, H)
  // fibres: 9,000 per megapixel, 2 to 5 px, random angle, half light and half dark
  const n = Math.round((9000 * W * H) / 1e6)
  g.lineCap = 'round'
  g.lineWidth = Math.max(1, dpr * 0.6)
  for (const col of ['rgba(42,106,79,0.20)', 'rgba(15,42,32,0.20)']) {
    g.strokeStyle = col
    g.beginPath()
    for (let i = 0; i < n / 2; i++) {
      const x = rr(r, 0, W)
      const y = rr(r, 0, H)
      const L = rr(r, 2, 5) * dpr
      const a = rr(r, 0, Math.PI * 2)
      g.moveTo(x, y)
      g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L)
    }
    g.stroke()
  }
  // a warm pool of light, upper left
  const lg = g.createRadialGradient(0.35 * W, 0.25 * H, 0, 0.35 * W, 0.25 * H, 0.7 * H)
  lg.addColorStop(0, 'rgba(255,236,190,0.10)')
  lg.addColorStop(1, 'rgba(255,236,190,0)')
  g.fillStyle = lg
  g.fillRect(0, 0, W, H)
  return c
}
