// Scratch That / 刮一张: a paper scratch card on a felt counter, scraped with a brass token.
// Cozy rules: no shake / flash / hit-stop / additive particles. Springs, contact shadows, small sounds.
import { t } from './i18n'
import { track } from './analytics'
import { audio, type ScrapeVoice } from './engine/AudioEngine'
import { type Stage, haptic, setupCanvas } from './engine/juice'
import { type CardPose, type Layout, REGIONS, REST_ROT, computeLayout, toCard, toScreen } from './scratch/layout'
import { type Brush, FOIL, type FoilFrame, Region, drawSheen, makeBrushes, makeFoilFrame, refreshComposite } from './scratch/foil'
import { type CardSpec, type Perf, bakeCard, bakeShadow, cellCentre, makeCard, makePerf } from './scratch/print'
import { type CoinSprite, type CoinState, bakeCoin, drawCoin } from './scratch/coin'
import { CAP, Shavings } from './scratch/shavings'
import { bakeFelt } from './scratch/felt'
import { DEG, FONT_SANS, clamp, ctx2d, easeInCubic, easeOutBack, makeCanvas, rng } from './scratch/util'

const Q = new URLSearchParams(location.search)
const DEV = import.meta.env.DEV
const SEED = DEV && Q.has('seed') ? Number(Q.get('seed')) >>> 0 || 1 : (Math.random() * 1e9) >>> 0
const OG = DEV && Q.get('og') === '1'

// Dev only: ?seed=<n> also pins Math.random, so frame sheets repeat.
if (DEV && Q.has('seed')) {
  let a = SEED
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const STEP_U = 0.22
const MAX_POINTERS = 3
const ARRIVE_MS = 420
const LEAVE_MS = 300
const LS_CARDS = 'scratch.cards'
const LS_WINS = 'scratch.wins'

const lsGet = (k: string) => {
  try {
    return Number(localStorage.getItem(k)) || 0
  } catch {
    return 0
  }
}
const lsSet = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v))
  } catch {
    /* private mode */
  }
}

export interface GameApi {
  next(): void
  dispose(): void
}
export interface GameEvents {
  onFirst(): void
  /** lifetime cards finished, lifetime wins */
  onCounts(cards: number, wins: number): void
  onToast(text: string, link?: string): void
  /** the card on the table is done (prize known): show "Another one" */
  onSettled(done: boolean): void
}

interface Ptr {
  id: number
  type: string
  x: number
  y: number
  vx: number
  vy: number
  /** card-space unit direction of the last real segment */
  dx: number
  dy: number
  hasDir: boolean
  strokeId: number
  acc: number
  foilAmt: number
  resid: number
  lastT: number
  coin: CoinState
  coinDir: number
  downT: number
  up: number | null
  voice: ScrapeVoice | null
  travel: number
  lastBuzz: number
}

interface CardState {
  spec: CardSpec
  perf: Perf
  paper: HTMLCanvasElement
  /** paper + residue + lips + foil, refreshed in dirty rects */
  comp: HTMLCanvasElement
  regions: Region[]
  ff: FoilFrame
  shadowA: { c: HTMLCanvasElement; m: number }
  shadowB: { c: HTMLCanvasElement; m: number }
  arriveT0: number
  leaveT0: number | null
  circles: { cells: number[]; t0: number } | null
  stamp: number | null
  invite: number | null
  firstStamp: number | null
  mainKnown: boolean
  prizeKnown: boolean
  voidDone: boolean
  spotless: boolean
}

export function startGame(canvas: HTMLCanvasElement, ev: GameEvents, gifts: string[] = []): GameApi {
  let L: Layout
  let felt: HTMLCanvasElement
  let brushes: Brush[] = []
  let coinSp: CoinSprite
  let card: CardState
  let old: CardState | null = null
  let cardIndex = 0
  let normalOrd = 0
  let first = true
  const chipR = rng(SEED * 5 + 11)
  const shav = new Shavings(rng(SEED * 3 + 2))
  let strokeSeq = 0
  const ptrs = new Map<number, Ptr>()
  const fading: Ptr[] = []
  let tiltX = 0
  let tiltTarget = 0
  let gamma = 0
  const inputLag: number[] = []
  let pendingDown: number | null = null
  let lastInput = 0
  // the resting coin on the felt: 1 = lying there, 0 = in the hand
  let rest = 1
  let restDrop = 0
  // session + lifetime
  let lifeCards = lsGet(LS_CARDS)
  let lifeWins = lsGet(LS_WINS)
  let sessionCards = 0
  let forbiddenN = 0
  let spotlessN = 0
  let scrapeMs = 0

  let frozen: number | null = null
  const now = () => frozen ?? performance.now()
  const T0 = now()
  const word = t('scratch_foil_word')

  function layoutFor(s: Stage): Layout {
    const l = computeLayout(s.w, s.h, s.dpr)
    if (!OG) return l
    // og card (1200 x 630): a big card on the right, the name on the left
    const CW = 0.86 * s.h / 1.38
    const U = CW / 20
    return { ...l, CW, CH: 1.38 * CW, U, K: U * s.dpr, cx: 0.7 * s.w, cy: 0.5 * s.h }
  }

  function bake(index: number, arriveAt: number): CardState {
    const gift = index < gifts.length ? gifts[index] : undefined
    const ord = gift ? 0 : normalOrd
    const spec = makeCard(SEED, index, lifeCards + 1, gift, ord, forbiddenN === 2)
    const perf = makePerf(SEED + index * 7)
    const regions = REGIONS.map((d, i) => new Region(d, L.K, L.dpr, SEED * 101 + index * 7 + i, word))
    const paper = bakeCard(spec, perf, L.K)
    const comp = makeCanvas(paper.width, paper.height)
    ctx2d(comp).drawImage(paper, 0, 0)
    return {
      spec,
      perf,
      paper,
      comp,
      regions,
      ff: makeFoilFrame(regions),
      shadowA: bakeShadow(perf, L.K, 0.5, 0.45),
      shadowB: bakeShadow(perf, L.K, 0.6, 0.25),
      arriveT0: arriveAt,
      leaveT0: null,
      circles: null,
      stamp: null,
      invite: null,
      firstStamp: null,
      mainKnown: false,
      prizeKnown: false,
      voidDone: false,
      spotless: false,
    }
  }

  function relayout(s: Stage) {
    L = layoutFor(s)
    felt = bakeFelt(s.w, s.h, s.dpr, SEED)
    brushes = makeBrushes(L.K, s.dpr, SEED)
    coinSp = bakeCoin(L.K)
    // a resize rebakes the card at the new resolution (its scratches start over)
    const was = card
    card = bake(cardIndex, was ? was.arriveT0 : now() + 80)
    if (was) {
      card.mainKnown = was.mainKnown
      card.prizeKnown = was.prizeKnown
      card.voidDone = was.voidDone
      card.spotless = was.spotless
    }
    old = null
  }
  const { stage, dispose: disposeCanvas } = setupCanvas(canvas, relayout)

  // ---------- card pose ----------

  const restPose = (): CardPose => ({ x: L.cx, y: L.cy, rot: OG ? -6 * DEG : REST_ROT })

  function pose(c: CardState, tm: number): { p: CardPose; k: number } {
    const rp = restPose()
    if (c.leaveT0 != null) {
      const u = clamp((tm - c.leaveT0) / LEAVE_MS, 0, 1)
      const e = easeInCubic(u)
      return { p: { x: rp.x - 0.75 * L.w * e, y: rp.y + 0.7 * L.h * e, rot: rp.rot + (-12 * DEG - rp.rot) * e }, k: 1 - e * 0.5 }
    }
    const u = clamp((tm - c.arriveT0) / ARRIVE_MS, 0, 1)
    if (u >= 1) return { p: rp, k: 1 }
    const e = easeOutBack(u, 0.6)
    return {
      p: { x: rp.x + 0.6 * L.w * (1 - e), y: rp.y - 0.5 * L.h * (1 - e), rot: rp.rot + (14 * DEG - rp.rot) * (1 - e) },
      k: clamp(1 - Math.pow(1 - u, 3), 0, 1),
    }
  }
  const cardPose = (tm = now()) => pose(card, tm).p

  /** Where the brass token lies on the felt when nobody holds it. */
  function restCoin() {
    const x = L.cx + 0.3 * L.CW
    const y = Math.min(L.cy + L.CH / 2 + 2.3 * L.U, L.h - 64 - 1.6 * L.U)
    return { x, y }
  }

  // ---------- scraping ----------

  const regionsNear = (ux: number, uy: number) => card.regions.filter((R) => R.near(ux, uy, 1.4))

  function cellState(ux: number, uy: number): number {
    for (const R of card.regions) {
      const i = R.cellAt(ux, uy)
      if (i >= 0) return R.state[i]
    }
    return -1
  }

  function probe(ux: number, uy: number, dx: number, dy: number): number {
    let n = 0
    const ax = ux + dx * 0.9
    const ay = uy + dy * 0.9
    for (const s of [0, -0.8, 0.8]) if (cellState(ax - dy * s, ay + dx * s) === FOIL) n++
    return n / 3
  }

  const onCard = (ux: number, uy: number) => ux >= 0 && ux <= 20 && uy >= 0 && uy <= 27.6

  function stampAt(p: Ptr, ux: number, uy: number, ang: number, tm: number, pc: CardPose) {
    const sp = Math.hypot(p.vx, p.vy)
    const s = 1 + 0.15 * clamp(sp / 1500, 0, 1)
    const br = brushes[Math.floor(chipR() * brushes.length)]
    let fresh = 0
    let clean = 0
    for (const R of regionsNear(ux, uy)) {
      const res = R.stamp(br, ux, uy, ang, s, p.strokeId, tm, chipR)
      fresh += res.fresh
      clean += res.clean
    }
    if (fresh && card.firstStamp == null) card.firstStamp = tm
    if (clean) p.resid = 1
    if (fresh || clean) {
      const [sx, sy] = toScreen(L, pc, ux, uy)
      // lead review: about a third of the spec's rate
      shav.carry += 0.17 * fresh
      while (shav.carry >= 1) {
        shav.carry -= 1
        shav.spawn(sx, sy, p.vx, p.vy, tm)
      }
      shav.carryFlake += 0.05 * clean
      while (shav.carryFlake >= 1) {
        shav.carryFlake -= 1
        shav.spawn(sx, sy, p.vx, p.vy, tm, true)
      }
    }
  }

  function scrapeSegment(p: Ptr, x0: number, y0: number, x1: number, y1: number, tm: number, dtMs: number) {
    const pc = cardPose(tm)
    const [ax, ay] = toCard(L, pc, x0, y0)
    const [bx, by] = toCard(L, pc, x1, y1)
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len < 1e-4) return
    const ux = dx / len
    const uy = dy / len
    if (len > 0.12) {
      if (p.hasDir && ux * p.dx + uy * p.dy < -0.3) p.strokeId = ++strokeSeq
      p.dx = ux
      p.dy = uy
      p.hasDir = true
    }
    const dir = Math.atan2(p.dy, p.dx)
    let d = STEP_U - p.acc
    const n = Math.floor((len - d) / STEP_U) + 1
    const kSmooth = 1 - Math.exp(-dtMs / Math.max(1, n) / 30)
    while (d <= len) {
      const sx = ax + ux * d
      const sy = ay + uy * d
      p.foilAmt += (probe(sx, sy, p.dx, p.dy) - p.foilAmt) * kSmooth
      if (onCard(sx, sy)) stampAt(p, sx, sy, dir + (chipR() * 2 - 1) * 8 * DEG, tm, pc)
      d += STEP_U
    }
    p.acc = len - (d - STEP_U)
  }

  function coinTarget(p: Ptr) {
    const touch = p.type !== 'mouse'
    p.coin.px = p.x
    p.coin.py = p.y
    p.coin.x = p.x + (touch ? -0.5 * L.U : 0)
    p.coin.y = p.y + (touch ? -1.1 * L.U : 0)
  }

  function down(id: number, type: string, x: number, y: number, tm = now()) {
    if (ptrs.size >= MAX_POINTERS || card.leaveT0 != null) return
    audio.unlock()
    if (first) {
      first = false
      ev.onFirst()
    }
    lastInput = performance.now()
    strokeSeq++
    const ang = chipR() * Math.PI * 2
    const p: Ptr = {
      id,
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      dx: Math.cos(ang),
      dy: Math.sin(ang),
      hasDir: false,
      strokeId: strokeSeq,
      acc: 0,
      foilAmt: 0,
      resid: 0,
      lastT: tm,
      coin: { x, y, px: x, py: y, dir: ang + REST_ROT, scale: 0.9, alpha: 1 },
      coinDir: ang + REST_ROT,
      downT: tm,
      up: null,
      voice: null,
      travel: 0,
      lastBuzz: 0,
    }
    coinTarget(p)
    ptrs.set(id, p)
    const pc = cardPose(tm)
    const [ux, uy] = toCard(L, pc, x, y)
    const st = cellState(ux, uy)
    p.foilAmt = st === FOIL ? 1 : 0
    if (onCard(ux, uy)) {
      audio.coinTick()
      if (st === FOIL) haptic(8)
      stampAt(p, ux, uy, ang, tm, pc)
    }
    p.voice = audio.scrape()
    pendingDown = performance.now()
  }

  function move(id: number, x: number, y: number, tm = now()) {
    const p = ptrs.get(id)
    if (!p) return
    lastInput = performance.now()
    const dtMs = Math.max(1, tm - p.lastT)
    const ivx = ((x - p.x) / dtMs) * 1000
    const ivy = ((y - p.y) / dtMs) * 1000
    const k = 1 - Math.exp(-dtMs / 40)
    p.vx += (ivx - p.vx) * k
    p.vy += (ivy - p.vy) * k
    const x0 = p.x
    const y0 = p.y
    scrapeSegment(p, x0, y0, x, y, tm, dtMs)
    shav.push(x0, y0, x, y, p.vx, p.vy, 1.3 * L.U)
    // haptic: 5 ms per 45 px over foil, at most one call per 40 ms; nothing on paper or felt
    if (p.foilAmt > 0.05) {
      p.travel += Math.hypot(x - x0, y - y0)
      if (p.travel >= 45 && tm - p.lastBuzz >= 40) {
        p.travel = 0
        p.lastBuzz = tm
        haptic(5)
      }
    } else p.travel = 0
    p.x = x
    p.y = y
    p.lastT = tm
    coinTarget(p)
  }

  function up(id: number, tm = now()) {
    const p = ptrs.get(id)
    if (!p) return
    ptrs.delete(id)
    p.up = tm
    p.voice?.stop()
    p.voice = null
    scrapeMs += tm - p.downT
    fading.push(p)
  }

  // ---------- card logic (spec 5) ----------

  function checkCard(tm: number) {
    const c = card
    if (c.leaveT0 != null || tm < c.arriveT0 + ARRIVE_MS) return
    const [main, prize, vd] = c.regions
    if (!c.mainKnown) {
      let all = true
      for (let i = 0; i < 9; i++) if (main.symMarked[i] < 0.7 * main.symTotal[i]) all = false
      if (all || main.coverage >= 0.85) {
        c.mainKnown = true
        const k = c.spec.kind
        if (k === 'win' || k === 'gift') {
          c.circles = { cells: c.spec.winCells, t0: tm }
          audio.win()
          for (let i = 0; i < 3; i++) audio.squeak(0.14 * i + 0.04)
          haptic([12, 40, 12])
        } else if (k === 'near') {
          c.stamp = tm
          audio.woodKnock(0.5, 330)
          haptic(20)
        } else audio.puff()
        track('card_result', { n: sessionCards + 1, result: k, secs: Math.round((tm - (c.firstStamp ?? tm)) / 1000) })
        if (prize.coverage < 0.1) c.invite = tm + 300
      }
    }
    if (!c.prizeKnown && prize.coverage >= 0.6) {
      c.prizeKnown = true
      sessionCards++
      lifeCards++
      const won = c.spec.kind === 'win' || c.spec.kind === 'gift'
      if (won) lifeWins++
      lsSet(LS_CARDS, lifeCards)
      lsSet(LS_WINS, lifeWins)
      ev.onCounts(lifeCards, lifeWins)
      track('prize_revealed', { n: sessionCards, prize: c.spec.prizeId })
      const link = c.spec.prizeId === 'cat' ? 'https://purr.integ.life/' : c.spec.prizeId === 'merit' ? 'https://knock.integ.life/' : undefined
      const text = c.spec.prizeText
      window.setTimeout(() => {
        if (card === c) ev.onToast(text, link)
      }, 250)
      ev.onSettled(true)
    }
    if (!c.voidDone && vd.coverage >= 0.5) {
      c.voidDone = true
      forbiddenN++
      audio.woodKnock(0.6, 260)
      audio.woodKnock(0.6, 260, 0.11)
      haptic([10, 60, 10])
      track('forbidden_scratch', { n: forbiddenN })
    }
    if (!c.spotless && c.prizeKnown && c.regions.every((R) => R.coverage >= 0.98)) {
      c.spotless = true
      spotlessN++
      ev.onToast(t('scratch_spotless'))
      track('spotless', { n: spotlessN })
    }
  }

  function next() {
    if (card.leaveT0 != null) return
    const tm = now()
    for (const id of [...ptrs.keys()]) up(id, tm)
    track('next_card', { n: cardIndex + 2 })
    if (cardIndex >= gifts.length) normalOrd++
    cardIndex++
    card.leaveT0 = tm
    old = card
    // shavings still on the old card leave with it
    shav.list = shav.list.filter((s) => s.where === 0)
    card = bake(cardIndex, tm + LEAVE_MS - 120)
    ev.onSettled(false)
    audio.fwip(0.1)
    window.setTimeout(() => audio.fwip(0.12), LEAVE_MS - 120)
    window.setTimeout(() => audio.slap(), LEAVE_MS - 120 + 400)
  }

  // ---------- DOM input ----------

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as [number, number]
  }
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const [x, y] = local(e)
    canvas.setPointerCapture?.(e.pointerId)
    down(e.pointerId, e.pointerType, x, y)
  }
  const onMove = (e: PointerEvent) => {
    const [x, y] = local(e)
    const [ux] = toCard(L, cardPose(), x, y)
    tiltTarget = clamp((ux / 20) * 2 - 1, -1, 1)
    if (!ptrs.has(e.pointerId)) return
    const evs = (e.getCoalescedEvents?.() ?? []) as PointerEvent[]
    if (evs.length > 1) for (const ce of evs) move(e.pointerId, ...local(ce))
    else move(e.pointerId, x, y)
  }
  const onUp = (e: PointerEvent) => up(e.pointerId)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  // Android: device tilt nudges the sheen. Never prompt (iOS needs a permission call; we skip it).
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: unknown } | undefined
  const onOrient = (e: DeviceOrientationEvent) => (gamma = e.gamma ?? 0)
  if (DOE && typeof DOE.requestPermission !== 'function') window.addEventListener('deviceorientation', onOrient)

  // ---------- frame ----------

  function shavingWhere(x: number, y: number) {
    const [ux, uy] = toCard(L, cardPose(), x, y)
    if (!onCard(ux, uy)) return 0
    const st = cellState(ux, uy)
    return st > 0 ? 2 : 1
  }

  function update(tm: number, dt: number) {
    const pc = cardPose(tm)
    shav.update(dt, tm, shavingWhere, -Math.sin(pc.rot), Math.cos(pc.rot))
    // cap: oldest resting felt shavings are pressed into the felt
    if (shav.list.length > CAP) {
      let over = shav.list.length - CAP
      const keep = []
      for (const s of shav.list) {
        if (over > 0 && s.resting && s.where === 0) {
          const g = ctx2d(felt)
          g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0)
          shav.drawOne(g, s, s.x, s.y, 0)
          over--
        } else keep.push(s)
      }
      shav.list = keep
    }
    const kd = 1 - Math.exp(-dt / 0.04)
    for (const p of [...ptrs.values(), ...fading]) {
      const sp = Math.hypot(p.vx, p.vy)
      const target = p.hasDir ? Math.atan2(p.dy, p.dx) + pc.rot : p.coinDir
      if (sp > 30 || !p.hasDir) {
        let dd = target - p.coinDir
        dd = Math.atan2(Math.sin(dd), Math.cos(dd))
        p.coinDir += dd * kd
      }
      p.coin.dir = p.coinDir
      p.coin.scale = Math.min(1, 0.9 + (0.1 * (tm - p.downT)) / 60)
      if (p.up != null) p.coin.alpha = clamp(1 - (tm - p.up - 180) / 180, 0, 1)
      if (tm - p.lastT > 50 && p.up == null) {
        p.vx *= 0.8
        p.vy *= 0.8
      }
      p.resid = Math.max(0, p.resid - dt * 6)
      if (p.voice) {
        const [ux, uy] = toCard(L, pc, p.x, p.y)
        p.voice.set(Math.hypot(p.vx, p.vy), p.foilAmt, p.resid, !onCard(ux, uy))
      }
    }
    for (let i = fading.length - 1; i >= 0; i--) if (fading[i].coin.alpha <= 0) fading.splice(i, 1)
    // the resting coin: picked up on touch, put back down once the hand is empty
    if (ptrs.size || fading.length) rest = Math.max(0, rest - dt / 0.08)
    else {
      const was = rest
      rest = Math.min(1, rest + dt / 0.22)
      if (was < 1 && rest >= 1) restDrop = tm
    }
    tiltX += (clamp(tiltTarget + gamma / 30, -1.5, 1.5) - tiltX) * (1 - Math.exp(-dt / 0.25))
    if (old && old.leaveT0 != null && tm - old.leaveT0 > LEAVE_MS) old = null
    checkCard(tm)
  }

  function drawCard(ctx: CanvasRenderingContext2D, c: CardState, tm: number) {
    const { p: pc, k } = pose(c, tm)
    const U = L.U
    const lift = 1 - k
    const so = 1 + 1.6 * lift
    const shadow = (sh: { c: HTMLCanvasElement; m: number }, a: number) => {
      if (a <= 0.001) return
      ctx.save()
      ctx.globalAlpha = a
      ctx.translate(pc.x, pc.y)
      ctx.rotate(pc.rot)
      ctx.translate(-L.CW / 2 + 0.22 * U * so, -L.CH / 2 + 0.32 * U * so)
      ctx.drawImage(sh.c, -sh.m * U, -sh.m * U, (20 + 2 * sh.m) * U, (27.6 + 2 * sh.m) * U)
      ctx.restore()
    }
    shadow(c.shadowB, lift)
    shadow(c.shadowA, k)
    ctx.save()
    ctx.translate(pc.x, pc.y)
    ctx.rotate(pc.rot)
    ctx.translate(-L.CW / 2, -L.CH / 2)
    ctx.scale(U, U)
    refreshComposite(c.comp, c.paper, c.regions, c.ff, L.dpr)
    ctx.drawImage(c.comp, 0, 0, 20, 27.6)
    const sheenX = 1.5 + (0.5 + 0.5 * Math.sin((tm - T0) / 1000 / 3.1)) * 17 + 0.6 * tiltX
    c.regions.forEach((R, i) => {
      let sx = sheenX
      let sa = 0.35
      // prize strip invitation: the sheen runs across it twice, 500 ms each
      if (i === 1 && c.invite != null && tm >= c.invite && tm < c.invite + 1000 && R.coverage < 0.1) {
        sx = R.def.x - 2 + (((tm - c.invite) % 500) / 500) * (R.def.w + 4)
        sa = 0.5
      }
      drawSheen(ctx, c.ff, R, sx, sa)
    })
    if (c.circles) drawCircles(ctx, c, tm)
    if (c.stamp != null) drawNearStamp(ctx, c, tm)
    ctx.restore()
  }

  function draw(tm: number) {
    const { ctx, dpr, w, h } = stage
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.drawImage(felt, 0, 0, w, h)
    if (OG) drawOgTitle(ctx)
    // resting coin on the felt, under the card's shadow layer order (it is on the felt)
    if (rest > 0.001 && !OG) drawRestCoin(ctx, tm)
    if (old) drawCard(ctx, old, tm)
    drawCard(ctx, card, tm)
    shav.draw(ctx)
    for (const p of fading) drawCoin(ctx, coinSp, p.coin, L.U)
    for (const p of ptrs.values()) drawCoin(ctx, coinSp, p.coin, L.U)
    if (pendingDown != null) {
      inputLag.push(performance.now() - pendingDown)
      if (inputLag.length > 60) inputLag.shift()
      pendingDown = null
    }
  }

  function drawRestCoin(ctx: CanvasRenderingContext2D, tm: number) {
    const { x, y } = restCoin()
    const U = L.U
    const S = coinSp.face.width
    const k = U / coinSp.K
    const drop = restDrop ? clamp((tm - restDrop) / 160, 0, 1) : 1
    const lift = (1 - rest) * 0.5 + (1 - drop) * 0.06
    ctx.save()
    ctx.globalAlpha = rest
    // soft shadow, falling lower right; it grows and softens as the coin lifts
    ctx.save()
    ctx.translate(x + (0.16 + lift) * U, y + (0.26 + lift * 1.4) * U)
    ctx.scale(1.25 + lift, 3.4 + lift * 2)
    ctx.globalAlpha = rest * (0.7 - lift * 0.6)
    ctx.drawImage(coinSp.shadow, (-coinSp.shadow.width / 2) * k, (-coinSp.shadow.height / 2) * k, coinSp.shadow.width * k, coinSp.shadow.height * k)
    ctx.restore()
    const sc = 1 + lift * 0.12
    // thickness, then the face
    ctx.drawImage(coinSp.edge, x - (S / 2) * k * sc + 0.05 * U, y - (S / 2) * k * sc + 0.12 * U, S * k * sc, S * k * sc)
    ctx.drawImage(coinSp.face, x - (S / 2) * k * sc, y - (S / 2) * k * sc - lift * U, S * k * sc, S * k * sc)
    ctx.restore()
  }

  function drawOgTitle(ctx: CanvasRenderingContext2D) {
    ctx.save()
    ctx.fillStyle = '#FFF4C9'
    ctx.textBaseline = 'alphabetic'
    ctx.font = `800 92px ${FONT_SANS}`
    ctx.fillText('Scratch That', 70, 250)
    ctx.font = `800 64px ${FONT_SANS}`
    ctx.fillStyle = '#F6D98B'
    ctx.fillText('刮一张', 72, 340)
    ctx.font = `500 30px ${FONT_SANS}`
    ctx.fillStyle = 'rgba(255,244,201,0.82)'
    ctx.fillText('Scratch the silver off a card. Win a nap.', 72, 410)
    ctx.font = `600 24px ${FONT_SANS}`
    ctx.fillStyle = 'rgba(255,244,201,0.55)'
    ctx.fillText('scratch.integ.life', 72, 560)
    ctx.restore()
  }

  /** Red marker loops round the three matching cells (spec 3.8, L6). */
  function drawCircles(g: CanvasRenderingContext2D, c: CardState, tm: number) {
    const cc = c.circles!
    g.save()
    g.globalCompositeOperation = 'multiply'
    g.strokeStyle = '#D4281C'
    g.globalAlpha = 0.9
    g.lineWidth = 0.16
    g.lineCap = 'round'
    g.lineJoin = 'round'
    cc.cells.forEach((cell, i) => {
      const u = clamp((tm - cc.t0 - i * 140) / 260, 0, 1)
      if (u <= 0) return
      const e = 1 - Math.pow(1 - u, 3)
      const [cx, cy] = cellCentre(cell)
      const r = rng(c.spec.seed + cell * 31 + c.spec.index)
      const rx = 2.45
      const ry = 1.72
      const a0 = -2.2 + r() * 0.6
      const total = (720 - 20) * DEG
      const ph = r() * 6
      const ph2 = r() * 6
      g.beginPath()
      const N = 90
      for (let j = 0; j <= N * e; j++) {
        const f = j / N
        const a = a0 + f * total
        const wob = 1 + 0.04 * Math.sin(a * 1.7 + ph) + 0.025 * Math.sin(a * 3.1 + ph2)
        const grow = 1 + 0.05 * f
        const x = cx + Math.cos(a) * rx * wob * grow + 0.12 * f
        const y = cy - 0.2 + Math.sin(a) * ry * wob * grow - 0.06 * f
        if (j) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.stroke()
    })
    g.restore()
  }

  let stampInk: HTMLCanvasElement | null = null
  /** "One short." rubber stamp across the bottom-right cell (spec 3.8). */
  function drawNearStamp(g: CanvasRenderingContext2D, c: CardState, tm: number) {
    const u = clamp((tm - c.stamp!) / 110, 0, 1)
    const sc = 1.25 - 0.25 * u * u
    if (!stampInk || stampInk.width !== Math.ceil(8 * L.K)) stampInk = bakeStamp()
    const [cx, cy] = cellCentre(8)
    g.save()
    g.translate(cx - 0.3, cy + 0.1)
    g.rotate(-9 * DEG)
    g.scale(sc, sc)
    g.globalAlpha = 0.8 * Math.min(1, u * 3)
    g.drawImage(stampInk, -4, -1.4, 8, 2.8)
    g.restore()
  }
  function bakeStamp() {
    const K = L.K
    const c = makeCanvas(8 * K, 2.8 * K)
    const g = ctx2d(c)
    g.scale(K, K)
    const r = rng(SEED + 99)
    g.strokeStyle = '#B3261E'
    g.fillStyle = '#B3261E'
    const rough = (x: number, y: number, w: number, h: number, lw: number) => {
      g.lineWidth = lw
      g.beginPath()
      const pts: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      pts.forEach(([px, py], i) => {
        const [qx, qy] = pts[(i + 1) % 4]
        for (let k = 0; k <= 8; k++) {
          const f = k / 8
          const X = px + (qx - px) * f + (r() - 0.5) * 0.06
          const Y = py + (qy - py) * f + (r() - 0.5) * 0.06
          if (i === 0 && k === 0) g.moveTo(X, Y)
          else g.lineTo(X, Y)
        }
      })
      g.closePath()
      g.stroke()
    }
    rough(0.15, 0.15, 7.7, 2.5, 0.12)
    rough(0.4, 0.4, 7.2, 2.0, 0.05)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const s = t('scratch_near_stamp')
    let fs = 1.05
    g.font = `900 ${fs}px ${FONT_SANS}`
    const w = g.measureText(s).width
    if (w > 6.6) {
      fs *= 6.6 / w
      g.font = `900 ${fs}px ${FONT_SANS}`
    }
    g.fillText(s, 4, 1.45)
    // ink texture: punch 200 small holes
    g.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 200; i++) {
      g.beginPath()
      g.arc(r() * 8, r() * 2.8, (1 + r()) / K, 0, Math.PI * 2)
      g.fill()
    }
    return c
  }

  let last = performance.now()
  let lastDraw = 0
  let raf = 0
  const loop = (nowMs: number) => {
    raf = requestAnimationFrame(loop)
    if (frozen != null) return
    // idle: 20 fps after 10 s without input (the sheen still moves)
    const idle = !ptrs.size && !fading.length && nowMs - lastInput > 10000 && !old
    if (idle && nowMs - lastDraw < 49) return
    const dt = Math.min(0.033, (nowMs - last) / 1000)
    last = nowMs
    lastDraw = nowMs
    update(nowMs, dt)
    draw(nowMs)
  }
  raf = requestAnimationFrame(loop)
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback
  if (ric) ric(() => audio.prepare())
  else window.setTimeout(() => audio.prepare(), 600)
  const onVis = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf)
      for (const id of [...ptrs.keys()]) up(id)
      audio.suspend()
    } else {
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }
  }
  document.addEventListener('visibilitychange', onVis)
  const onHide = () => {
    if (sessionCards > 0) track('session_cards', { n: sessionCards, secs: Math.round(scrapeMs / 1000) })
  }
  window.addEventListener('pagehide', onHide)
  ev.onCounts(lifeCards, lifeWins)

  const api: GameApi = {
    next,
    dispose() {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onHide)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('deviceorientation', onOrient)
      for (const id of [...ptrs.keys()]) up(id)
      disposeCanvas()
    },
  }

  // ---------- dev harness: __toy and the ?shot= stroke player ----------

  if (DEV) {
    const step = (sec: number) => {
      const N = Math.max(1, Math.round(sec * 60))
      for (let i = 0; i < N; i++) {
        frozen = (frozen ?? performance.now()) + (sec * 1000) / N
        update(frozen, sec / N)
      }
      draw(frozen!)
    }
    const S = (ux: number, uy: number) => toScreen(L, cardPose(), ux, uy)
    let pid = 100
    /** Drag a pointer along a polyline (card U) at `speed` U/s, 60 Hz input. */
    const drag = (pts: [number, number][], speed: number, type: string, o: { keepDown?: boolean; stopAt?: number } = {}) => {
      const id = ++pid
      down(id, type, ...S(...pts[0]), now())
      step(1 / 60)
      let total = 0
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      const stopAt = (o.stopAt ?? 1) * total
      let tr = 0
      const dPer = speed / 60
      let seg = 1
      let segPos = 0
      while (tr < stopAt && seg < pts.length) {
        let left = Math.min(dPer, stopAt - tr)
        let cx = 0
        let cy = 0
        while (left > 1e-6 && seg < pts.length) {
          const [ax, ay] = pts[seg - 1]
          const [bx, by] = pts[seg]
          const sl = Math.hypot(bx - ax, by - ay)
          const take = Math.min(left, sl - segPos)
          segPos += take
          left -= take
          tr += take
          cx = ax + ((bx - ax) * segPos) / sl
          cy = ay + ((by - ay) * segPos) / sl
          if (segPos >= sl - 1e-6) {
            seg++
            segPos = 0
          }
        }
        frozen = (frozen ?? performance.now()) + 1000 / 60
        move(id, ...S(cx, cy), frozen)
        update(frozen, 1 / 60)
      }
      if (!o.keepDown) up(id, now())
      draw(now())
      return id
    }
    const zig = (x0: number, y0: number, x1: number, amp: number, pitch: number, slope = 0): [number, number][] => {
      const pts: [number, number][] = []
      const n = Math.max(2, Math.round((x1 - x0) / pitch))
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n
        pts.push([x, y0 + (i % 2 ? amp : -amp) + slope * (x - x0)])
      }
      return pts
    }
    const sweep = (x0: number, x1: number, y0: number, y1: number, pitch: number, speed: number, type: string) => {
      let i = 0
      for (let y = y0; y <= y1 + 1e-6; y += pitch, i++) {
        drag(i % 2 ? [[x1, y], [x0, y]] : [[x0, y], [x1, y]], speed, type)
        step(0.03)
      }
    }
    const coverage = () => Object.fromEntries(card.regions.map((R) => [R.def.id, +R.coverage.toFixed(3)]))
    const info: Record<string, unknown> = {}
    const touchType = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse'

    const shots: Record<string, () => void> = {
      fresh() {},
      first() {
        const [x, y] = S(8.6, 11.4)
        down(++pid, touchType, x, y, now())
        step(0.1)
        info.point = [x, y]
      },
      strokes3() {
        drag(zig(2.6, 8.8, 9.6, 0.65, 1.15, 0.05), 30, touchType)
        step(0.25)
        info.end1 = S(9.6, 8.8 + 0.65 + 0.35)
        drag(zig(9.2, 12.6, 17.2, 0.6, 1.2, -0.06), 34, touchType)
        step(0.25)
        drag(zig(3.0, 16.2, 12.0, 0.55, 1.1, 0.0), 30, touchType, { keepDown: true, stopAt: 0.62 })
        step(1 / 60)
      },
      twopass() {
        const yA = 10.2
        drag([[2.8, yA], [16.6, yA], [2.8, yA]], 26, touchType)
        step(0.2)
        drag([[2.8, 15.4], [16.6, 15.4]], 26, touchType)
        step(0.8)
      },
      win() {
        const rows = [7.7, 9.2, 10.7, 12.2, 13.7, 15.2, 16.7, 17.95]
        rows.forEach((y, i) => {
          const a = i % 3 === 1 ? 2.9 : 1.9
          const b = i % 4 === 2 ? 16.4 : 18.1
          drag(i % 2 ? [[b, y], [a, y]] : [[a, y], [b, y]], 32, touchType)
          step(0.05)
        })
        drag(zig(1.9, 19.9, 9.8, 0.45, 1.2), 26, touchType)
        drag(zig(1.9, 21.5, 9.6, 0.4, 1.3), 26, touchType)
        step(0.6)
        if (!card.circles) card.circles = { cells: card.spec.winCells, t0: now() }
        step(1.2)
      },
      /** the same win, 2.5 s later: what the lead asked for (nothing left over the print) */
      winlater() {
        shots.win()
        step(2.5)
      },
      done() {
        sweep(1.9, 18.1, 7.7, 18.0, 1.5, 34, touchType)
        sweep(1.9, 18.1, 19.9, 21.6, 1.5, 30, touchType)
        step(2.0)
      },
      near() {
        // card 2 of a session is a near miss
        next()
        step(0.8)
        sweep(1.9, 18.1, 7.7, 18.0, 1.5, 34, touchType)
        step(0.6)
      },
      void() {
        drag(zig(11.9, 23.6, 18.1, 0.5, 0.9), 22, touchType)
        drag(zig(18.1, 24.5, 11.9, 0.5, 0.9), 22, touchType)
        step(0.6)
      },
      pile() {
        let y = 7.9
        let dirR = true
        while (y < 18.4) {
          drag(dirR ? zig(2.0, y, 18.0, 0.3, 1.4) : zig(18.0, y, 2.0, 0.3, 1.4), 30, touchType, {})
          dirR = !dirR
          y += 1.9
          step(0.1)
        }
        drag([[9.5, 10.0], [24.5, 10.6]], 60, touchType)
        step(2.5)
        info.shavings = shav.list.length
      },
      sheen() {},
      arrive() {
        card.arriveT0 = now()
        draw(now())
      },
      og() {
        sweep(1.9, 18.1, 7.7, 13.0, 1.5, 30, 'mouse')
        drag(zig(2.2, 14.6, 12.5, 0.5, 1.2), 28, 'mouse')
        step(0.35)
        drag(zig(11.0, 16.6, 15.5, 0.5, 1.1), 26, 'mouse', { keepDown: true, stopAt: 0.7 })
        step(1 / 60)
      },
    }

    const shot = Q.get('shot') ?? (OG ? 'og' : null)
    ;(window as unknown as Record<string, unknown>).__toy = {
      seed: SEED,
      get inputToDrawMs() {
        const a = [...inputLag].sort((x, y) => x - y)
        return a.length ? a[Math.floor(a.length / 2)] : null
      },
      inputLags: () => [...inputLag],
      freeze: () => (frozen = now()),
      unfreeze: () => {
        frozen = null
        last = performance.now()
      },
      advance: (sec: number) => step(sec),
      coverage,
      info,
      shavings: () => shav.list.length,
      layout: () => ({ ...L }),
      cardRect: () => [S(0, 0), S(20, 0), S(20, 27.6), S(0, 27.6)],
      toScreen: S,
      spec: () => card.spec,
      state: () => ({ mainKnown: card.mainKnown, prizeKnown: card.prizeKnown, voidDone: card.voidDone, sessionCards, forbiddenN }),
      next,
      foilAmt: () => [...ptrs.values()].map((p) => p.foilAmt),
      memory: () => {
        const cs: HTMLCanvasElement[] = [felt, card.paper, card.comp, card.ff.buf, card.shadowA.c, card.shadowB.c, coinSp.face, coinSp.edge, coinSp.shadow, ...brushes.map((b) => b.c)]
        for (const R of card.regions) cs.push(R.tex, R.mask, R.resTex, R.resMask, R.foil)
        return +(cs.reduce((a, c) => a + c.width * c.height * 4, 0) / 1048576).toFixed(2)
      },
      shotReady: false,
    }
    if (shot && shots[shot]) {
      frozen = performance.now()
      step(0.6)
      shots[shot]()
      draw(now())
      ;(window as unknown as { __toy: { shotReady: boolean } }).__toy.shotReady = true
    }
  }
  return api
}
