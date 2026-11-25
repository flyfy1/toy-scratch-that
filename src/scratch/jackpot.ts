// The jackpot's print and stamp (million_merit), loaded with the prize pool's text: the jackpot is only dealt once
// both are here, so the main bundle carries none of it.
import { tx } from '../i18n'
import { audio } from '../engine/AudioEngine'
import { haptic } from '../engine/juice'
import { DEG, FONT_SANS, ctx2d, makeCanvas, rng, roundRectPath } from './util'

/** The prize box printed on gold foil, with a fine guilloche (the silver on top looks the same as always). */
export function goldBox(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, px: number) {
  g.beginPath()
  roundRectPath(g, x0, y0, w, h, 0.25)
  g.fillStyle = '#E8C76A'
  g.fill()
  g.strokeStyle = '#B8933A'
  g.lineWidth = px * 1.5
  g.stroke()
  g.save()
  g.clip()
  g.strokeStyle = 'rgba(150,110,30,0.35)'
  g.lineWidth = px
  for (let k = 0; k < 10; k++) {
    const ph = (k / 10) * Math.PI * 2
    g.beginPath()
    for (let x = x0; x <= x0 + w + 0.05; x += 0.06) {
      const y = y0 + h / 2 + Math.sin((x - x0) * 1.9 + ph) * (h * 0.36) * (0.7 + 0.3 * Math.cos((x - x0) * 0.33 + ph))
      if (x === x0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  const sh = g.createLinearGradient(x0, y0, x0 + w, y0 + h)
  sh.addColorStop(0, 'rgba(255,248,214,0.35)')
  sh.addColorStop(0.5, 'rgba(255,248,214,0)')
  sh.addColorStop(1, 'rgba(120,84,20,0.18)')
  g.fillStyle = sh
  g.fillRect(x0, y0, w, h)
  g.restore()
}

/** One burst of about 40 gold shavings from the box, three wood knocks rising in pitch, one long buzz. */
export function burst(spawn: (ux: number, uy: number, vx: number, vy: number, small: boolean) => void, seed: number) {
  const r = rng(seed)
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2
    const v = 200 + r() * 500
    spawn(2 + r() * 16, 19.7 + r() * 2, Math.cos(a) * v, Math.sin(a) * v - 300, r() < 0.3)
  }
  audio.woodKnock(0.6, 440)
  audio.woodKnock(0.75, 554, 0.16)
  audio.woodKnock(0.9, 660, 0.32)
  haptic(400)
}

let ink: HTMLCanvasElement | null = null

/** A round red stamp landing on the prize box at a slight angle (the near miss's stamp, made round). u: 0 to 1 of the landing. */
export function drawStamp(g: CanvasRenderingContext2D, K: number, seed: number, u: number) {
  if (!ink || ink.width !== Math.ceil(3.4 * K)) ink = bake(K, seed)
  const sc = 1.3 - 0.3 * u * u
  g.save()
  g.translate(16.1, 20.5)
  g.rotate(-14 * DEG)
  g.scale(sc, sc)
  g.globalAlpha = 0.82 * Math.min(1, u * 3)
  g.drawImage(ink, -1.7, -1.7, 3.4, 3.4)
  g.restore()
}

function bake(K: number, seed: number) {
  const c = makeCanvas(3.4 * K, 3.4 * K)
  const g = ctx2d(c)
  g.scale(K, K)
  const r = rng(seed + 77)
  g.strokeStyle = '#B3261E'
  g.fillStyle = '#B3261E'
  const ring = (rad: number, lw: number) => {
    g.lineWidth = lw
    g.beginPath()
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2
      const q = rad + (r() - 0.5) * 0.05
      if (k) g.lineTo(1.7 + Math.cos(a) * q, 1.7 + Math.sin(a) * q)
      else g.moveTo(1.7 + Math.cos(a) * q, 1.7 + Math.sin(a) * q)
    }
    g.closePath()
    g.stroke()
  }
  ring(1.58, 0.13)
  ring(1.3, 0.05)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const word = tx('scratch_stamp_jackpot') || 'JACKPOT'
  const lines = word.includes(' ') ? word.split(' ') : [word]
  const fs0 = lines.length > 1 ? 0.62 : 0.9
  lines.forEach((l, i) => {
    let fs = fs0
    g.font = `900 ${fs}px ${FONT_SANS}`
    const w = g.measureText(l).width
    if (w > 2.2) {
      fs *= 2.2 / w
      g.font = `900 ${fs}px ${FONT_SANS}`
    }
    g.fillText(l, 1.7, 1.72 + (i - (lines.length - 1) / 2) * fs0 * 1.05)
  })
  // ink texture: small holes
  g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 90; i++) {
    g.beginPath()
    g.arc(r() * 3.4, r() * 3.4, (1 + r()) / K, 0, Math.PI * 2)
    g.fill()
  }
  return c
}
