// The six printed symbols (spec 3.4): two flat inks each plus a #2B2420 line at 0.09 U, round joins.
// Drawn in symbol units: 1 unit = 1 U, the symbol is about 2.6 U tall, centred on (0, 0).
import type { Ctx } from './util'

export type SymbolId = 'fish' | 'cup' | 'bed' | 'cat' | 'muyu' | 'sun'
export const SYMBOLS: SymbolId[] = ['fish', 'cup', 'bed', 'cat', 'muyu', 'sun']
export const PRIZE_OF: Record<SymbolId, string> = { fish: 'slack', cup: 'coffee', bed: 'nap', cat: 'cat', muyu: 'merit', sun: 'dayoff' }

const LINE = '#2B2420'
const LW = 0.09

function ink(g: Ctx, fill: string, stroke = true) {
  g.fillStyle = fill
  g.fill()
  if (stroke) g.stroke()
}

/** Draw symbol `id` centred at (x, y) in the current space, scaled so 1 unit = u. */
export function drawSymbol(g: Ctx, id: SymbolId, x: number, y: number, u: number) {
  g.save()
  g.translate(x, y)
  g.scale(u, u)
  g.lineWidth = LW
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.strokeStyle = LINE
  DRAW[id](g)
  g.restore()
}

const DRAW: Record<SymbolId, (g: Ctx) => void> = {
  fish(g) {
    const M = '#2F6FB0'
    const L2 = '#A9CBEB'
    // tail
    g.beginPath()
    g.moveTo(0.62, 0.02)
    g.quadraticCurveTo(1.0, -0.2, 1.32, -0.66)
    g.quadraticCurveTo(1.18, 0.02, 1.32, 0.7)
    g.quadraticCurveTo(1.0, 0.24, 0.62, 0.02)
    ink(g, M)
    // dorsal fin
    g.beginPath()
    g.moveTo(-0.32, -0.5)
    g.quadraticCurveTo(0.0, -0.98, 0.42, -0.42)
    ink(g, M)
    // body
    g.beginPath()
    g.moveTo(-1.28, 0.02)
    g.bezierCurveTo(-1.0, -0.72, 0.3, -0.78, 0.76, 0.02)
    g.bezierCurveTo(0.3, 0.72, -1.0, 0.68, -1.28, 0.02)
    ink(g, M)
    // belly (second ink)
    g.save()
    g.clip()
    g.beginPath()
    g.moveTo(-1.4, 0.12)
    g.bezierCurveTo(-0.7, 0.3, 0.1, 0.26, 0.9, 0.05)
    g.lineTo(0.9, 1)
    g.lineTo(-1.4, 1)
    g.closePath()
    g.fillStyle = L2
    g.fill()
    g.restore()
    g.beginPath()
    g.moveTo(-1.28, 0.02)
    g.bezierCurveTo(-1.0, -0.72, 0.3, -0.78, 0.76, 0.02)
    g.bezierCurveTo(0.3, 0.72, -1.0, 0.68, -1.28, 0.02)
    g.stroke()
    // gill
    g.beginPath()
    g.arc(-0.78, 0.0, 0.42, -0.95, 0.95)
    g.stroke()
    // scale ticks
    g.beginPath()
    for (const [sx, sy] of [[-0.05, -0.18], [0.25, -0.12], [0.1, 0.12]]) {
      g.moveTo(sx, sy - 0.12)
      g.quadraticCurveTo(sx + 0.14, sy, sx, sy + 0.12)
    }
    g.stroke()
    // eye
    g.beginPath()
    g.arc(-0.92, -0.16, 0.15, 0, Math.PI * 2)
    ink(g, '#FFFFFF')
    g.beginPath()
    g.arc(-0.94, -0.16, 0.07, 0, Math.PI * 2)
    g.fillStyle = LINE
    g.fill()
    // bubbles
    g.beginPath()
    g.arc(-1.32, -0.82, 0.2, 0, Math.PI * 2)
    ink(g, L2)
    g.beginPath()
    g.arc(-1.0, -1.18, 0.11, 0, Math.PI * 2)
    ink(g, L2)
  },

  cup(g) {
    const M = '#8A5A2B'
    const L2 = '#F1DDB8'
    // saucer
    g.beginPath()
    g.ellipse(-0.1, 0.92, 1.3, 0.3, 0, 0, Math.PI * 2)
    ink(g, L2)
    // handle
    g.beginPath()
    g.ellipse(0.78, 0.18, 0.4, 0.34, 0, 0, Math.PI * 2)
    g.lineWidth = 0.28
    g.strokeStyle = LINE
    g.stroke()
    g.lineWidth = 0.13
    g.strokeStyle = M
    g.stroke()
    g.lineWidth = LW
    g.strokeStyle = LINE
    // body
    g.beginPath()
    g.moveTo(-1.0, -0.36)
    g.lineTo(0.8, -0.36)
    g.bezierCurveTo(0.8, 0.4, 0.55, 0.86, -0.1, 0.86)
    g.bezierCurveTo(-0.75, 0.86, -1.0, 0.4, -1.0, -0.36)
    g.closePath()
    ink(g, M)
    // band
    g.beginPath()
    g.moveTo(-0.97, 0.05)
    g.lineTo(0.77, 0.05)
    g.strokeStyle = L2
    g.lineWidth = 0.12
    g.stroke()
    g.lineWidth = LW
    g.strokeStyle = LINE
    // rim + coffee
    g.beginPath()
    g.ellipse(-0.1, -0.36, 0.9, 0.2, 0, 0, Math.PI * 2)
    ink(g, '#4E2E14')
    g.beginPath()
    g.ellipse(-0.2, -0.38, 0.34, 0.07, 0, 0, Math.PI * 2)
    g.fillStyle = L2
    g.fill()
    // steam
    g.lineWidth = 0.11
    g.strokeStyle = M
    for (const sx of [-0.5, -0.05, 0.4]) {
      g.beginPath()
      g.moveTo(sx, -0.66)
      g.bezierCurveTo(sx - 0.25, -0.86, sx + 0.25, -1.02, sx, -1.22)
      g.bezierCurveTo(sx - 0.18, -1.36, sx + 0.1, -1.46, sx + 0.02, -1.52)
      g.stroke()
    }
  },

  bed(g) {
    const M = '#6B4FA0'
    const L2 = '#CDBEEA'
    // pillow: puffy, pinched corners
    const pillow = () => {
      g.beginPath()
      g.moveTo(-1.3, -0.25)
      g.quadraticCurveTo(-0.1, -0.55, 1.15, -0.32)
      g.quadraticCurveTo(1.0, 0.25, 1.22, 0.85)
      g.quadraticCurveTo(0.0, 0.6, -1.25, 0.9)
      g.quadraticCurveTo(-1.05, 0.32, -1.3, -0.25)
      g.closePath()
    }
    pillow()
    ink(g, M)
    // top face highlight (second ink)
    g.save()
    pillow()
    g.clip()
    g.beginPath()
    g.ellipse(-0.05, 0.02, 1.0, 0.34, -0.05, 0, Math.PI * 2)
    g.fillStyle = L2
    g.fill()
    g.restore()
    pillow()
    g.stroke()
    // dent where the head was
    g.beginPath()
    g.moveTo(-0.55, 0.12)
    g.quadraticCurveTo(-0.05, 0.36, 0.45, 0.1)
    g.stroke()
    // corner pinches
    g.beginPath()
    g.moveTo(-1.18, -0.16)
    g.lineTo(-1.0, -0.06)
    g.moveTo(1.06, -0.24)
    g.lineTo(0.9, -0.12)
    g.moveTo(1.1, 0.76)
    g.lineTo(0.94, 0.62)
    g.moveTo(-1.12, 0.8)
    g.lineTo(-0.96, 0.66)
    g.stroke()
    // Zz
    g.save()
    g.lineWidth = 0.13
    g.strokeStyle = M
    g.beginPath()
    g.moveTo(0.15, -1.32)
    g.lineTo(0.62, -1.32)
    g.lineTo(0.15, -0.86)
    g.lineTo(0.66, -0.86)
    g.moveTo(0.82, -1.14)
    g.lineTo(1.1, -1.14)
    g.lineTo(0.82, -0.86)
    g.lineTo(1.12, -0.86)
    g.stroke()
    g.restore()
  },

  cat(g) {
    const M = '#E08A3C'
    const L2 = '#FBE6C8'
    const head = () => {
      g.beginPath()
      g.moveTo(-1.08, -0.2)
      g.lineTo(-1.02, -1.12)
      g.lineTo(-0.38, -0.66)
      g.quadraticCurveTo(0, -0.76, 0.38, -0.66)
      g.lineTo(1.02, -1.12)
      g.lineTo(1.08, -0.2)
      g.bezierCurveTo(1.22, 0.55, 0.7, 0.98, 0, 0.98)
      g.bezierCurveTo(-0.7, 0.98, -1.22, 0.55, -1.08, -0.2)
      g.closePath()
    }
    head()
    ink(g, M)
    // inner ears
    g.beginPath()
    g.moveTo(-0.9, -0.48)
    g.lineTo(-0.88, -0.9)
    g.lineTo(-0.56, -0.66)
    g.closePath()
    g.moveTo(0.9, -0.48)
    g.lineTo(0.88, -0.9)
    g.lineTo(0.56, -0.66)
    g.closePath()
    g.fillStyle = L2
    g.fill()
    // muzzle
    g.save()
    head()
    g.clip()
    g.beginPath()
    g.ellipse(-0.24, 0.48, 0.36, 0.3, 0, 0, Math.PI * 2)
    g.ellipse(0.24, 0.48, 0.36, 0.3, 0, 0, Math.PI * 2)
    g.ellipse(0, 0.86, 0.5, 0.26, 0, 0, Math.PI * 2)
    g.fillStyle = L2
    g.fill()
    g.restore()
    head()
    g.stroke()
    // forehead stripes
    g.beginPath()
    g.moveTo(0, -0.66)
    g.lineTo(0, -0.38)
    g.moveTo(-0.24, -0.64)
    g.lineTo(-0.2, -0.44)
    g.moveTo(0.24, -0.64)
    g.lineTo(0.2, -0.44)
    g.lineWidth = 0.08
    g.strokeStyle = '#A85A1C'
    g.stroke()
    g.lineWidth = LW
    g.strokeStyle = LINE
    // eyes: content, closed
    g.lineWidth = 0.12
    g.beginPath()
    g.moveTo(-0.66, -0.02)
    g.quadraticCurveTo(-0.45, -0.24, -0.24, -0.02)
    g.moveTo(0.24, -0.02)
    g.quadraticCurveTo(0.45, -0.24, 0.66, -0.02)
    g.stroke()
    g.lineWidth = LW
    // nose + mouth
    g.beginPath()
    g.moveTo(-0.13, 0.26)
    g.lineTo(0.13, 0.26)
    g.lineTo(0, 0.4)
    g.closePath()
    g.fillStyle = '#D9677A'
    g.fill()
    g.stroke()
    g.beginPath()
    g.moveTo(0, 0.4)
    g.quadraticCurveTo(-0.04, 0.58, -0.24, 0.56)
    g.moveTo(0, 0.4)
    g.quadraticCurveTo(0.04, 0.58, 0.24, 0.56)
    g.stroke()
    // whiskers
    g.lineWidth = 0.06
    g.beginPath()
    g.moveTo(-0.62, 0.42)
    g.lineTo(-1.32, 0.3)
    g.moveTo(-0.62, 0.54)
    g.lineTo(-1.3, 0.6)
    g.moveTo(0.62, 0.42)
    g.lineTo(1.32, 0.3)
    g.moveTo(0.62, 0.54)
    g.lineTo(1.3, 0.6)
    g.stroke()
  },

  muyu(g) {
    const M = '#C0562A'
    const L2 = '#EDB54E'
    // cushion
    g.beginPath()
    g.roundRect(-1.2, 0.66, 2.4, 0.46, 0.22)
    ink(g, L2)
    g.beginPath()
    g.moveTo(-0.9, 0.89)
    g.lineTo(0.9, 0.89)
    g.lineWidth = 0.05
    g.stroke()
    g.lineWidth = LW
    // body: a round, slightly squat wooden fish
    const body = () => {
      g.beginPath()
      g.ellipse(0, -0.02, 1.14, 0.84, 0, 0, Math.PI * 2)
    }
    body()
    ink(g, M)
    // lacquer highlight, upper left (bare paper)
    g.save()
    body()
    g.clip()
    g.beginPath()
    g.ellipse(-0.5, -0.46, 0.38, 0.14, -0.45, 0, Math.PI * 2)
    g.fillStyle = 'rgba(251,246,234,0.85)'
    g.fill()
    g.restore()
    // carved scales across the top
    g.lineWidth = 0.06
    g.beginPath()
    for (const [x, y] of [[-0.42, -0.28], [-0.05, -0.36], [0.32, -0.3], [-0.22, -0.02], [0.14, -0.06]]) {
      g.moveTo(x - 0.17, y)
      g.quadraticCurveTo(x, y + 0.2, x + 0.17, y)
    }
    g.stroke()
    g.lineWidth = LW
    // the long mouth slit, dark inside
    g.beginPath()
    g.moveTo(-0.62, 0.3)
    g.quadraticCurveTo(0.25, 0.36, 1.08, 0.1)
    g.quadraticCurveTo(0.3, 0.66, -0.62, 0.3)
    g.closePath()
    g.fillStyle = '#3A1206'
    g.fill()
    g.stroke()
    // eye
    g.beginPath()
    g.arc(-0.74, -0.02, 0.09, 0, Math.PI * 2)
    g.fillStyle = LINE
    g.fill()
    // mallet resting on top: gold ball head, stick to the upper right
    g.beginPath()
    g.moveTo(0.62, -0.84)
    g.lineTo(1.36, -1.34)
    g.lineWidth = 0.22
    g.stroke()
    g.lineWidth = 0.1
    g.strokeStyle = '#E9C99A'
    g.stroke()
    g.lineWidth = LW
    g.strokeStyle = LINE
    g.beginPath()
    g.ellipse(0.5, -0.78, 0.3, 0.24, -0.6, 0, Math.PI * 2)
    ink(g, L2)
  },

  sun(g) {
    const M = '#E8452C'
    const L2 = '#FFD23F'
    // sun behind, upper right, with rays
    g.save()
    g.translate(0.62, -0.74)
    g.lineWidth = 0.11
    g.strokeStyle = '#E8A21E'
    g.beginPath()
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 1.05 + (i / 8) * Math.PI * 1.6
      g.moveTo(Math.cos(a) * 0.54, Math.sin(a) * 0.54)
      g.lineTo(Math.cos(a) * 0.76, Math.sin(a) * 0.76)
    }
    g.stroke()
    g.lineWidth = LW
    g.strokeStyle = LINE
    g.beginPath()
    g.arc(0, 0, 0.42, 0, Math.PI * 2)
    ink(g, L2)
    g.restore()
    // sand
    g.beginPath()
    g.moveTo(-1.35, 0.96)
    g.quadraticCurveTo(-0.4, 0.66, 0.4, 0.82)
    g.quadraticCurveTo(1.0, 0.92, 1.35, 0.84)
    g.lineTo(1.35, 1.12)
    g.lineTo(-1.35, 1.12)
    g.closePath()
    ink(g, L2)
    // pole
    g.beginPath()
    g.moveTo(-0.32, -0.62)
    g.lineTo(0.08, 0.86)
    g.lineWidth = 0.2
    g.stroke()
    g.lineWidth = 0.09
    g.strokeStyle = '#F6EBD8'
    g.stroke()
    g.lineWidth = LW
    g.strokeStyle = LINE
    // canopy, tilted, striped red / paper
    g.save()
    g.translate(-0.3, -0.42)
    g.rotate(-0.26)
    const N = 6
    const R = 1.12
    const AY = -R * 0.86
    const dome = () => {
      g.beginPath()
      g.moveTo(-R, 0.02)
      g.bezierCurveTo(-R * 0.98, AY * 1.02, R * 0.98, AY * 1.02, R, 0.02)
      for (let i = N; i > 0; i--) {
        const x0 = -R + (2 * R * i) / N
        const x1 = -R + (2 * R * (i - 1)) / N
        g.quadraticCurveTo((x0 + x1) / 2, -0.2, x1, 0.02)
      }
      g.closePath()
    }
    dome()
    g.fillStyle = M
    g.fill()
    g.save()
    dome()
    g.clip()
    g.fillStyle = '#FBF6EA'
    for (let i = 1; i < N; i += 2) {
      const x0 = -R + (2 * R * i) / N
      const x1 = -R + (2 * R * (i + 1)) / N
      g.beginPath()
      g.moveTo(0, AY * 0.75)
      g.lineTo(x0 * 1.04, 0.1)
      g.lineTo(x1 * 1.04, 0.1)
      g.closePath()
      g.fill()
    }
    g.restore()
    dome()
    g.stroke()
    g.beginPath()
    g.moveTo(0, AY * 0.75)
    g.lineTo(0, AY * 0.75 - 0.14)
    g.stroke()
    g.restore()
  },
}
