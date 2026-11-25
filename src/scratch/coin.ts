// The brass token (spec 3.7, L8): baked once, drawn squashed on edge along the stroke.
import { ctx2d, makeCanvas } from './util'

export interface CoinSprite {
  face: HTMLCanvasElement
  edge: HTMLCanvasElement
  shadow: HTMLCanvasElement
  /** device px per U used for the bake */
  K: number
  /** sprite half size, U */
  half: number
}

const R = 1.45

export function bakeCoin(K: number): CoinSprite {
  const half = R + 0.12
  const S = Math.ceil(2 * half * K)
  const face = makeCanvas(S, S)
  const g = ctx2d(face)
  g.translate(S / 2, S / 2)
  g.scale(K, K)
  const px = 1 / K
  // face
  const fg = g.createRadialGradient(-0.5, -0.55, 0.1, 0, 0, R)
  fg.addColorStop(0, '#F4D98A')
  fg.addColorStop(0.6, '#D8B24A')
  fg.addColorStop(1, '#9C7A28')
  g.fillStyle = fg
  g.beginPath()
  g.arc(0, 0, R, 0, Math.PI * 2)
  g.fill()
  // edge reeds, 60 short radial ticks
  g.lineWidth = Math.max(px, 0.035)
  g.strokeStyle = 'rgba(92,66,16,0.55)'
  g.beginPath()
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    g.moveTo(Math.cos(a) * (R - 0.02), Math.sin(a) * (R - 0.02))
    g.lineTo(Math.cos(a) * (R - 0.13), Math.sin(a) * (R - 0.13))
  }
  g.stroke()
  // raised rim: light upper left, dark lower right
  const rim = R - 0.2
  g.lineWidth = 0.14
  const arc = (a0: number, a1: number, col: string, off: number) => {
    g.strokeStyle = col
    g.beginPath()
    g.arc(off, off, rim, a0, a1)
    g.stroke()
  }
  g.lineCap = 'round'
  arc(Math.PI * 0.95, Math.PI * 1.75, '#FFF0BF', 0)
  arc(-0.05 * Math.PI, 0.7 * Math.PI, '#7A5C18', 0)
  // inner field slightly recessed
  const ig = g.createRadialGradient(-0.3, -0.3, 0.1, 0, 0, rim - 0.08)
  ig.addColorStop(0, 'rgba(255,236,170,0.18)')
  ig.addColorStop(1, 'rgba(120,88,20,0.18)')
  g.fillStyle = ig
  g.beginPath()
  g.arc(0, 0, rim - 0.08, 0, Math.PI * 2)
  g.fill()
  // embossed fish: dark line, light twin offset up-left
  const fish = (dx: number, dy: number, col: string) => {
    g.save()
    g.translate(dx, dy)
    g.strokeStyle = col
    g.lineWidth = 0.08
    g.lineJoin = 'round'
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(-0.62, 0)
    g.bezierCurveTo(-0.4, -0.38, 0.18, -0.4, 0.38, 0)
    g.bezierCurveTo(0.18, 0.4, -0.4, 0.38, -0.62, 0)
    g.moveTo(0.36, 0)
    g.lineTo(0.68, -0.28)
    g.lineTo(0.62, 0)
    g.lineTo(0.68, 0.28)
    g.closePath()
    g.moveTo(-0.38, -0.06)
    g.arc(-0.4, -0.06, 0.02, 0, Math.PI * 2)
    g.stroke()
    g.restore()
  }
  fish(-1.2 * px, -1.2 * px, 'rgba(255,244,205,0.85)')
  fish(0, 0, 'rgba(110,78,18,0.85)')
  // tiny dots round the field: "token", not legal tender
  g.fillStyle = 'rgba(110,78,18,0.55)'
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    g.beginPath()
    g.arc(Math.cos(a) * (rim - 0.22), Math.sin(a) * (rim - 0.22), 0.035, 0, Math.PI * 2)
    g.fill()
  }

  // edge band (the coin's thickness)
  const edge = makeCanvas(S, S)
  const e = ctx2d(edge)
  e.translate(S / 2, S / 2)
  e.scale(K, K)
  const eg = e.createLinearGradient(-R, -R, R, R)
  eg.addColorStop(0, '#C9A13E')
  eg.addColorStop(0.5, '#8E6C22')
  eg.addColorStop(1, '#5E4612')
  e.fillStyle = eg
  e.beginPath()
  e.arc(0, 0, R, 0, Math.PI * 2)
  e.fill()
  e.strokeStyle = 'rgba(40,28,6,0.35)'
  e.lineWidth = 0.03
  e.beginPath()
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2
    e.moveTo(Math.cos(a) * (R - 0.3), Math.sin(a) * (R - 0.3))
    e.lineTo(Math.cos(a) * R, Math.sin(a) * R)
  }
  e.stroke()

  // soft contact shadow, 1.5 U x 0.5 U
  const sw = Math.ceil(2.4 * K)
  const sh = Math.ceil(1.2 * K)
  const shadow = makeCanvas(sw, sh)
  const s = ctx2d(shadow)
  s.filter = `blur(${0.12 * K}px)`
  s.fillStyle = 'rgba(0,0,0,0.3)'
  s.beginPath()
  s.ellipse(sw / 2, sh / 2, 0.75 * K, 0.25 * K, 0, 0, Math.PI * 2)
  s.fill()
  return { face, edge, shadow, K, half }
}

export interface CoinState {
  /** css px: centre of the token */
  x: number
  y: number
  /** contact point, css px */
  px: number
  py: number
  /** stroke direction, screen radians (lagged) */
  dir: number
  scale: number
  alpha: number
}

/** Draw in screen space (ctx at 1 unit = 1 css px). U = css px per U. */
export function drawCoin(g: CanvasRenderingContext2D, sp: CoinSprite, st: CoinState, U: number) {
  if (st.alpha <= 0.001) return
  const k = U / sp.K // css px per sprite device px
  const S = sp.face.width
  g.save()
  g.globalAlpha = st.alpha
  // contact shadow under the leading edge, long axis across the stroke
  g.save()
  g.translate(st.px + Math.cos(st.dir) * 0.25 * U + 0.1 * U, st.py + Math.sin(st.dir) * 0.25 * U + 0.16 * U)
  g.rotate(st.dir + Math.PI / 2)
  g.drawImage(sp.shadow, (-sp.shadow.width / 2) * k, (-sp.shadow.height / 2) * k, sp.shadow.width * k, sp.shadow.height * k)
  g.restore()
  // held on edge: squash 0.78 along the stroke; the thickness shows on the trailing side
  const sc = st.scale
  const tilt = (ox: number, oy: number) => {
    g.translate(st.x + ox, st.y + oy)
    g.rotate(st.dir)
    g.scale(0.78 * sc, sc)
    g.rotate(-st.dir)
  }
  const th = 0.3 * U
  const tx = -Math.cos(st.dir) * th
  const ty = -Math.sin(st.dir) * th
  for (let i = 6; i >= 1; i--) {
    g.save()
    tilt(tx * (i / 6), ty * (i / 6) + 0.05 * U * (i / 6))
    g.drawImage(sp.edge, (-S / 2) * k, (-S / 2) * k, S * k, S * k)
    g.restore()
  }
  g.save()
  tilt(0, 0)
  g.drawImage(sp.face, (-S / 2) * k, (-S / 2) * k, S * k, S * k)
  g.restore()
  g.restore()
}
