// The card: what is printed on it (spec 3.4), its paper, its perforated top edge, its shadow.
import { locale, t, tx } from '../i18n'
import { CARD_H_U, CARD_W_U } from './layout'
import type { Prize } from './prizes'
import { fx } from '../prizeText'
import { SYMBOLS, type SymbolId, drawSymbol } from './symbols'
import { DEG, FONT_MONO, FONT_SANS, type Rng, ctx2d, makeCanvas, rng, roundRectPath, rr, ri } from './util'

export type CardKind = 'win' | 'near' | 'thanks' | 'gift'

export interface CardSpec {
  index: number
  seed: number
  kind: CardKind
  grid: SymbolId[]
  /** cells of the matching three (win / gift) */
  winCells: number[]
  prizeId: string
  prizeText: string
  /** a built-in win's prize (from the pool) and whether its timed line is printed */
  prize?: Prize
  v: 0 | 1
  serial: number
  gift: boolean
  /** the forbidden strip's hidden line (the third time in a session it changes) */
  voidText: string
}

const CAPTION: Record<SymbolId, Parameters<typeof t>[0]> = {
  fish: 'scratch_cap_fish',
  cup: 'scratch_cap_cup',
  bed: 'scratch_cap_bed',
  cat: 'scratch_cap_cat',
  muyu: 'scratch_cap_muyu',
  sun: 'scratch_cap_sun',
}

function shuffle<T>(r: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** A built-in win, drawn by the game (once per card: a rebuilt card keeps it). */
export interface Won {
  prize: Prize
  v: 0 | 1
  text: string
}

/**
 * Spec 5: card 1 wins, card 2 is a near miss, then 35 / 40 / 25. `win.force`: the card a free_card guaranteed.
 * On a win the prize is drawn first (`win.pick`) and the matching symbol follows it.
 */
export function makeCard(seed: number, index: number, serial: number, giftText?: string, ord = index, voidAgain = false, win?: { force: boolean; pick: () => Won }): CardSpec {
  const r = rng(seed * 7919 + index * 104729 + 13)
  let kind: CardKind
  if (giftText) kind = 'gift'
  else if (ord === 0 || win?.force) kind = 'win'
  else if (ord === 1) kind = 'near'
  else {
    const x = r()
    kind = x < 0.35 ? 'win' : x < 0.75 ? 'near' : 'thanks'
  }
  const grid: SymbolId[] = new Array(9)
  const order = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7, 8])
  let syms = shuffle(r, SYMBOLS.slice())
  const won = kind === 'win' ? win?.pick() : undefined
  if (won) syms = [won.prize.sym, ...syms.filter((s) => s !== won.prize.sym)]
  let winCells: number[] = []
  if (kind === 'win' || kind === 'gift') {
    const w = syms[0]
    winCells = order.slice(0, 3).sort((a, b) => a - b)
    for (const c of winCells) grid[c] = w
    // remaining six: other five symbols, none more than twice
    const rest = shuffle(r, [syms[1], syms[1], syms[2], syms[2], syms[3], syms[4], syms[5]]).slice(0, 6)
    order.slice(3).forEach((c, i) => (grid[c] = rest[i]))
  } else if (kind === 'near') {
    // the pair is placed early; the cell the layout places last would have been the third copy, and is not
    const p = syms[0]
    grid[order[0]] = p
    grid[order[1]] = p
    const rest = shuffle(r, [syms[1], syms[1], syms[2], syms[2], syms[3], syms[4]]).slice(0, 6)
    order.slice(2, 8).forEach((c, i) => (grid[c] = rest[i]))
    grid[order[8]] = syms[5]
  } else {
    // thanks: no symbol three times, never two alike in a row
    for (let tries = 0; tries < 200; tries++) {
      const pool = shuffle(r, [...SYMBOLS, ...SYMBOLS].slice()).slice(0, 9)
      let ok = true
      for (let row = 0; row < 3 && ok; row++) {
        const a = pool.slice(row * 3, row * 3 + 3)
        if (new Set(a).size < 3) ok = false
      }
      if (ok) {
        pool.forEach((s, i) => (grid[i] = s))
        break
      }
    }
  }
  // a win without a drawn prize (the gift ticket's preview never is one) falls back to the symbol's first prize
  const prizeId = kind === 'win' ? (won?.prize.id ?? 'slack') : kind === 'gift' ? 'gift' : kind
  const prizeText =
    kind === 'gift' ? giftText! : kind === 'win' ? (won?.text ?? t('scratch_prize_slack')) : kind === 'near' ? t('scratch_near') : t('scratch_thanks')
  // void_pass: on this card the forbidden strip gives in
  const voidText = (won?.prize.fx === 'void_pass' && tx('scratch_void_pass')) || t(voidAgain ? 'scratch_void_again' : 'scratch_void_reveal')
  return { index, seed, kind, grid, winCells, prizeId, prizeText, prize: won?.prize, v: won?.v ?? 0, serial, gift: kind === 'gift', voidText }
}

// ---------- shape ----------

export interface Perf {
  bites: { x: number; r: number }[]
}

export function makePerf(seed: number): Perf {
  const r = rng(seed * 13 + 3)
  const bites: { x: number; r: number }[] = []
  const pitch = 0.62
  const n = Math.floor((CARD_W_U - 1.0) / pitch)
  const x0 = (CARD_W_U - (n - 1) * pitch) / 2
  const deep = new Set<number>()
  const nd = ri(r, 2, 3)
  while (deep.size < nd) deep.add(ri(r, 1, n - 2))
  for (let i = 0; i < n; i++) bites.push({ x: x0 + i * pitch, r: deep.has(i) ? 0.22 : 0.16 })
  return { bites }
}

/** The card outline in U: rounded corners, the top edge bitten by the perforation. */
export function cardPath(g: CanvasRenderingContext2D | Path2D, perf: Perf, inset = 0) {
  const W = CARD_W_U
  const H = CARD_H_U
  const R = 0.5
  const i = inset
  g.moveTo(i, R)
  g.arcTo(i, i, R, i, R - i)
  for (const b of perf.bites) {
    g.lineTo(b.x - b.r - i, i)
    g.arc(b.x, 0, b.r + i, Math.PI, 0, true)
  }
  g.lineTo(W - R, i)
  g.arcTo(W - i, i, W - i, R, R - i)
  g.lineTo(W - i, H - R)
  g.arcTo(W - i, H - i, W - R, H - i, R - i)
  g.lineTo(R, H - i)
  g.arcTo(i, H - i, i, H - R, R - i)
  g.closePath()
}

// ---------- paper and print ----------

function fitFont(g: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number, family = FONT_SANS) {
  g.font = `${weight} ${size}px ${family}`
  const w = g.measureText(text).width
  if (w > maxW) {
    size *= maxW / w
    g.font = `${weight} ${size}px ${family}`
  }
  return size
}

/** Break into at most `maxLines` lines that fit `maxW`, shrinking the font until they do. */
function wrapFit(g: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number, maxLines: number, family = FONT_SANS) {
  const cjk = /[　-鿿＀-￯]/.test(text)
  const tokens = cjk ? Array.from(text) : text.split(/(\s+)/)
  for (let s = size; s > size * 0.35; s *= 0.95) {
    g.font = `${weight} ${s}px ${family}`
    const lines: string[] = []
    let cur = ''
    for (const tk of tokens) {
      const next = cur + tk
      if (g.measureText(next.trim()).width <= maxW || !cur.trim()) cur = next
      else {
        lines.push(cur.trim())
        cur = tk.trimStart()
      }
    }
    if (cur.trim()) lines.push(cur.trim())
    if (lines.length <= maxLines && lines.every((l) => g.measureText(l).width <= maxW)) return { lines, size: s }
  }
  const s = size * 0.35
  g.font = `${weight} ${s}px ${family}`
  return { lines: [text], size: s }
}

const CELL_W = 17 / 3
const CELL_H = 11.6 / 3
export const cellCentre = (i: number): [number, number] => [1.5 + (i % 3 + 0.5) * CELL_W, 7.0 + (Math.floor(i / 3) + 0.5) * CELL_H]

/** Bake the paper with everything printed on it, at K device px per U. */
export function bakeCard(card: CardSpec, perf: Perf, K: number): HTMLCanvasElement {
  const c = makeCanvas(CARD_W_U * K, CARD_H_U * K)
  const g = ctx2d(c)
  const r = rng(card.seed * 3 + card.index * 101 + 7)
  const px = 1 / K // one device px in U
  g.scale(K, K)
  g.save()
  g.beginPath()
  cardPath(g, perf)
  g.clip()
  // paper
  g.fillStyle = '#FBF6EA'
  g.fillRect(0, 0, CARD_W_U, CARD_H_U)
  const lit = g.createLinearGradient(0, 0, CARD_W_U, CARD_H_U)
  lit.addColorStop(0, 'rgba(255,255,255,0.10)')
  lit.addColorStop(0.6, 'rgba(255,255,255,0)')
  lit.addColorStop(1, 'rgba(90,70,40,0.06)')
  g.fillStyle = lit
  g.fillRect(0, 0, CARD_W_U, CARD_H_U)
  g.fillStyle = 'rgba(233,223,200,0.5)'
  for (let i = 0; i < 1500; i++) {
    const s = rr(r, 1, 3) * px * 1.2
    g.save()
    g.translate(rr(r, 0, CARD_W_U), rr(r, 0, CARD_H_U))
    g.rotate(rr(r, 0, Math.PI))
    g.fillRect(-s / 2, -px * 0.6, s, px * 1.2)
    g.restore()
  }

  printHeader(g, card, r, px)

  // rule line
  g.fillStyle = '#5A5045'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  fitFont(g, t('scratch_rule'), 600, 0.62, 17)
  g.fillText(t('scratch_rule'), 10, 6.32)

  printPanel(g, card, r, px)

  // prize strip
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillStyle = '#5A5045'
  fitFont(g, t('scratch_prize_label'), 800, 0.5, 8)
  letterSpaced(g, t('scratch_prize_label'), 1.55, 19.2, 0.12)
  underPrize(g, card, px)

  // forbidden strip
  g.fillStyle = '#B3261E'
  g.textAlign = 'left'
  g.textBaseline = 'middle'
  fitFont(g, t('scratch_void_label'), 700, 0.55, 9.6)
  g.fillText(t('scratch_void_label'), 1.5, 24.12)
  g.fillStyle = '#B3261E'
  g.beginPath()
  roundRectPath(g, 11.5, 23.3, 7, 1.6, 0.25)
  g.fill()
  g.fillStyle = '#FFFFFF'
  g.textAlign = 'center'
  fitFont(g, card.voidText, 800, 0.66, 6.4)
  g.fillText(card.voidText, 15, 24.14)

  printFooter(g, card, r, px)

  g.restore()
  // inner edge
  g.strokeStyle = 'rgba(120,100,70,0.25)'
  g.lineWidth = px
  g.beginPath()
  cardPath(g, perf, px * 0.5)
  g.stroke()
  return c
}

function letterSpaced(g: CanvasRenderingContext2D, s: string, x: number, y: number, sp: number) {
  for (const ch of Array.from(s)) {
    g.fillText(ch, x, y)
    x += g.measureText(ch).width + sp
  }
}

function printHeader(g: CanvasRenderingContext2D, card: CardSpec, r: Rng, px: number) {
  const x0 = 0.8
  const y0 = 0.9
  const w = 18.4
  const h = 4.7
  g.save()
  g.beginPath()
  roundRectPath(g, x0, y0, w, h, 0.3)
  g.clip()
  const lg = g.createLinearGradient(0, y0, 0, y0 + h)
  lg.addColorStop(0, '#E8452C')
  lg.addColorStop(1, '#F28A1E')
  g.fillStyle = lg
  g.fillRect(x0, y0, w, h)
  // sunburst: 18 rays from the header centre
  const cx = x0 + w * 0.5
  const cy = y0 + h * 0.5
  g.fillStyle = 'rgba(255,255,255,0.12)'
  g.beginPath()
  for (let i = 0; i < 18; i++) {
    const a0 = (i / 18) * Math.PI * 2
    const a1 = a0 + (Math.PI * 2) / 36
    g.moveTo(cx, cy)
    g.lineTo(cx + Math.cos(a0) * 20, cy + Math.sin(a0) * 20)
    g.lineTo(cx + Math.cos(a1) * 20, cy + Math.sin(a1) * 20)
    g.closePath()
  }
  g.fill()
  // halftone: 0.14 U pitch at 45 degrees, fading left to right
  g.fillStyle = 'rgba(255,255,255,0.10)'
  g.beginPath()
  const p = 0.14
  for (let j = -2; j * p < h + 1; j++) {
    for (let i = -2; i * p < w + 1; i++) {
      const x = x0 + i * p + (j & 1) * p * 0.5
      const y = y0 + j * p
      const f = 1 - (x - x0) / (w * 0.85)
      if (f <= 0.02) continue
      const rad = p * 0.46 * Math.sqrt(f)
      g.moveTo(x + rad, y)
      g.arc(x, y, rad, 0, Math.PI * 2)
    }
  }
  g.fill()
  g.restore()
  // second ink keyline, 1 device px off register
  g.strokeStyle = '#2F6FB0'
  g.lineWidth = 0.07
  g.beginPath()
  roundRectPath(g, x0 + 0.12 + px, y0 + 0.12, w - 0.24, h - 0.24, 0.22)
  g.stroke()

  // title
  const name = t('name_scratch')
  const maxW = 12.6
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  const target = 1.9 // cap height in U
  g.font = `800 ${target / 0.72}px ${FONT_SANS}`
  const m = g.measureText(name)
  const capH = m.actualBoundingBoxAscent || target
  let size = (target / capH) * (target / 0.72)
  g.font = `800 ${size}px ${FONT_SANS}`
  let tw = g.measureText(name).width
  let sx = 1
  if (tw > maxW) {
    // squeeze a little first (condensed display type), then shrink
    sx = Math.max(0.82, maxW / tw)
    if (tw * sx > maxW) {
      size *= maxW / (tw * sx)
      g.font = `800 ${size}px ${FONT_SANS}`
      tw = g.measureText(name).width
    }
  }
  const tx = 1.55
  const ty = 3.62
  g.save()
  g.translate(tx, ty)
  g.scale(sx, 1)
  g.lineJoin = 'round'
  g.lineWidth = 0.24
  g.fillStyle = '#8A2A12'
  g.strokeStyle = '#8A2A12'
  g.strokeText(name, 0.1, 0.1)
  g.fillText(name, 0.1, 0.1)
  g.lineWidth = 0.24
  g.strokeText(name, 0, 0)
  g.fillStyle = '#FFF4C9'
  g.fillText(name, 0, 0)
  g.restore()
  // line 2
  g.fillStyle = 'rgba(255,244,201,0.92)'
  const ed = t('scratch_edition')
  fitFont(g, ed, 700, 0.56, maxW)
  letterSpaced(g, ed, tx + 0.04, 4.86, locale === 'zh-CN' || locale === 'ja' ? 0.16 : 0.1)

  // burst badge
  const bx = 17.25
  const by = 3.22
  g.save()
  g.translate(bx, by)
  g.rotate(12 * DEG)
  g.beginPath()
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2
    const rad = i % 2 ? 1.24 : 1.5
    const x = Math.cos(a) * rad
    const y = Math.sin(a) * rad
    if (i) g.lineTo(x, y)
    else g.moveTo(x, y)
  }
  g.closePath()
  g.fillStyle = 'rgba(138,42,18,0.5)'
  g.save()
  g.translate(0.08, 0.08)
  g.fill()
  g.restore()
  g.fillStyle = '#FFD23F'
  g.fill()
  g.strokeStyle = '#8A2A12'
  g.lineWidth = 0.05
  g.stroke()
  g.beginPath()
  g.arc(0, 0, 1.02, 0, Math.PI * 2)
  g.lineWidth = 0.04
  g.setLineDash([0.1, 0.08])
  g.stroke()
  g.setLineDash([])
  g.fillStyle = '#8A2A12'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const badge = t(card.gift ? 'scratch_gift_badge' : 'scratch_badge')
  const parts = splitBadge(g, badge)
  const fs = parts.length > 1 ? 0.56 : 0.62
  parts.forEach((l, i) => {
    fitFont(g, l, 900, fs, 1.86)
    g.fillText(l, 0, (i - (parts.length - 1) / 2) * fs * 1.08 + 0.03)
  })
  g.restore()
  void r
}

function splitBadge(g: CanvasRenderingContext2D, s: string): string[] {
  g.font = `900 0.62px ${FONT_SANS}`
  if (g.measureText(s).width <= 1.86) return [s]
  if (/\s/.test(s)) {
    const w = s.split(/\s+/)
    if (w.length === 3 && w[1] === '=') return [`${w[0]} ${w[1]}`, w[2]]
    const mid = Math.ceil(w.length / 2)
    return [w.slice(0, mid).join(' '), w.slice(mid).join(' ')]
  }
  const a = Array.from(s)
  const mid = Math.ceil(a.length / 2)
  return [a.slice(0, mid).join(''), a.slice(mid).join('')]
}

function printPanel(g: CanvasRenderingContext2D, card: CardSpec, r: Rng, px: number) {
  const x0 = 1.5
  const y0 = 7.0
  const w = 17
  const h = 11.6
  g.save()
  g.beginPath()
  roundRectPath(g, x0, y0, w, h, 0.25)
  g.clip()
  g.fillStyle = '#F4EBD6'
  g.fillRect(x0, y0, w, h)
  // guilloche: 12 interleaved sine curves
  g.strokeStyle = '#E3D6B8'
  g.lineWidth = px * 1.2
  for (let k = 0; k < 12; k++) {
    const ph = (k / 12) * Math.PI * 2
    const amp = 0.9 + 0.35 * Math.sin(k * 1.7)
    g.beginPath()
    for (let x = x0; x <= x0 + w + 0.05; x += 0.08) {
      const y = y0 + h / 2 + Math.sin((x - x0) * 0.74 + ph) * amp * (h / 4.2) * (0.75 + 0.25 * Math.cos((x - x0) * 0.21 + ph * 0.5))
      if (x === x0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  // dividers
  g.strokeStyle = '#D8CDB6'
  g.lineWidth = px * 1.5
  g.beginPath()
  for (let i = 1; i < 3; i++) {
    g.moveTo(x0 + i * CELL_W, y0 + 0.35)
    g.lineTo(x0 + i * CELL_W, y0 + h - 0.35)
    g.moveTo(x0 + 0.35, y0 + i * CELL_H)
    g.lineTo(x0 + w - 0.35, y0 + i * CELL_H)
  }
  g.stroke()
  g.restore()
  // symbols and captions
  for (let i = 0; i < 9; i++) {
    const [cx, cy] = cellCentre(i)
    const id = card.grid[i]
    if (!id) continue
    drawSymbol(g, id, cx + rr(r, -0.04, 0.04), cy - 0.24, 0.94)
    g.fillStyle = '#5A5045'
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    fitFont(g, t(CAPTION[id]), 600, 0.6, CELL_W - 0.5)
    g.fillText(t(CAPTION[id]), cx, cy + 1.62)
  }
}

function underPrize(g: CanvasRenderingContext2D, card: CardSpec, px: number) {
  const x0 = 1.5
  const y0 = 19.4
  const w = 17
  const h = 2.6
  // the jackpot is printed on gold (its code comes with the prize pool's text)
  const gold = card.prize?.fx === 'jackpot' ? fx.pool : undefined
  g.save()
  if (gold) gold.goldBox(g, x0, y0, w, h, px)
  else {
    g.beginPath()
    roundRectPath(g, x0, y0, w, h, 0.25)
    g.fillStyle = '#F4EBD6'
    g.fill()
    g.strokeStyle = '#D8CDB6'
    g.lineWidth = px * 1.5
    g.stroke()
  }
  g.fillStyle = card.kind === 'win' || card.kind === 'gift' ? '#2B2420' : '#5A5045'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const { lines, size } = wrapFit(g, card.prizeText, 700, 0.95, w - 1.2, 2)
  const lh = size * 1.22
  lines.forEach((l, i) => g.fillText(l, x0 + w / 2, y0 + h / 2 + (i - (lines.length - 1) / 2) * lh + size * 0.04))
  g.restore()
}

function printFooter(g: CanvasRenderingContext2D, card: CardSpec, r: Rng, px: number) {
  g.fillStyle = '#6B6258'
  g.textAlign = 'left'
  g.textBaseline = 'middle'
  g.font = `500 0.6px ${FONT_MONO}`
  g.fillText(`No. ${String(card.serial).padStart(7, '0')}`, 1.5, 26.15)
  // fine print
  g.fillStyle = '#8A7F70'
  g.textAlign = 'right'
  const fp = wrapFit(g, t('scratch_fineprint'), 500, 0.48, 8.6, 2)
  const lh = fp.size * 1.25
  fp.lines.forEach((l, i) => g.fillText(l, 15.1, 26.15 + (i - (fp.lines.length - 1) / 2) * lh))
  // barcode
  g.fillStyle = '#3A332C'
  const bx = 15.6
  const bw = 3.0
  const widths: number[] = []
  for (let i = 0; i < 34; i++) widths.push(ri(r, 1, 3))
  const gaps = 34
  const unit = bw / (widths.reduce((a, b) => a + b, 0) + gaps * 1.2)
  let x = bx
  for (const wd of widths) {
    g.fillRect(x, 25.7, wd * unit, 0.9)
    x += wd * unit + unit * 1.2
  }
  void px
}

// ---------- shadow ----------

/** The card's contact shadow as a soft sprite (spec 3.4, L2), baked small. */
export function bakeShadow(perf: Perf, K: number, blurU: number, alpha: number) {
  const f = Math.min(K, 10) // shadow sprites can be coarse
  const m = blurU * 3
  const c = makeCanvas((CARD_W_U + 2 * m) * f, (CARD_H_U + 2 * m) * f)
  const g = ctx2d(c)
  g.filter = `blur(${blurU * f}px)`
  g.scale(f, f)
  g.translate(m, m)
  g.fillStyle = `rgba(8,20,14,${alpha})`
  g.beginPath()
  cardPath(g, perf)
  g.fill()
  return { c, m }
}
