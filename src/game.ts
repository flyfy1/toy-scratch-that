// Scratch That / 刮一张: a paper scratch card on a felt counter, scraped with a brass token.
// Phase 1 (render gate): felt, card print, foil with mask and sheen, the brush, shavings, the coin, a scripted stroke player.
// Cozy rules: no shake / flash / hit-stop / additive particles.
import { t } from './i18n'
import { type Stage, setupCanvas } from './engine/juice'
import { type CardPose, type Layout, REGIONS, REST_ROT, computeLayout, toCard, toScreen } from './scratch/layout'
import { type Brush, FOIL, type FoilFrame, Region, drawRegion, makeBrushes, makeFoilFrame } from './scratch/foil'
import { type CardSpec, type Perf, bakeCard, bakeShadow, cardPath, cellCentre, makeCard, makePerf } from './scratch/print'
import { type CoinSprite, type CoinState, bakeCoin, drawCoin } from './scratch/coin'
import { CAP, Shavings } from './scratch/shavings'
import { bakeFelt } from './scratch/felt'
import { DEG, clamp, ctx2d, easeInCubic, easeOutBack, makeCanvas, rng } from './scratch/util'

const Q = new URLSearchParams(location.search)
const DEV = import.meta.env.DEV
const SEED = DEV && Q.has('seed') ? Number(Q.get('seed')) >>> 0 || 1 : (Math.random() * 1e9) >>> 0

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

export interface GameApi {
  dispose(): void
}
export interface GameEvents {
  onFirst(): void
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
  /** distance (U) since the last stamp */
  acc: number
  foilAmt: number
  lastT: number
  coin: CoinState
  coinDir: number
  downT: number
  up: number | null
}

interface CardState {
  spec: CardSpec
  perf: Perf
  paper: HTMLCanvasElement
  crumbs: HTMLCanvasElement
  regions: Region[]
  ff: FoilFrame
  shadowA: { c: HTMLCanvasElement; m: number }
  shadowB: { c: HTMLCanvasElement; m: number }
  arriveT0: number
  circles: { cells: number[]; t0: number } | null
}

export function startGame(canvas: HTMLCanvasElement, ev: GameEvents): GameApi {
  let L: Layout = computeLayout(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2))
  let felt: HTMLCanvasElement
  let brushes: Brush[] = []
  let coinSp: CoinSprite
  let card: CardState
  let cardIndex = 0
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

  // time: real clock, or frozen for stills (dev)
  let frozen: number | null = null
  const now = () => frozen ?? performance.now()
  const T0 = now()

  const word = t('scratch_foil_word')

  function buildCard(index: number, arriveAt: number) {
    const spec = makeCard(SEED, index, 417 + index)
    const perf = makePerf(SEED + index * 7)
    const paper = bakeCard(spec, perf, L.K)
    const regions = REGIONS.map((d, i) => new Region(d, L.K, L.dpr, SEED * 101 + index * 7 + i, word))
    card = {
      spec,
      perf,
      paper,
      crumbs: makeCanvas(paper.width, paper.height),
      regions,
      ff: makeFoilFrame(regions),
      shadowA: bakeShadow(perf, L.K, 0.5, 0.45),
      shadowB: bakeShadow(perf, L.K, 0.6, 0.25),
      arriveT0: arriveAt,
      circles: null,
    }
  }

  function relayout(s: Stage) {
    L = computeLayout(s.w, s.h, s.dpr)
    felt = bakeFelt(s.w, s.h, s.dpr, SEED)
    brushes = makeBrushes(L.K, s.dpr, SEED)
    coinSp = bakeCoin(L.K)
    // a resize rebakes the card at the new resolution (scratches restart; phase 2 keeps them)
    buildCard(cardIndex, card ? card.arriveT0 : now() + 60)
  }
  const { stage, dispose: disposeCanvas } = setupCanvas(canvas, relayout)

  // ---------- card pose ----------

  function pose(tm: number): { p: CardPose; k: number } {
    const rest = { x: L.cx, y: L.cy, rot: REST_ROT }
    const u = clamp((tm - card.arriveT0) / ARRIVE_MS, 0, 1)
    if (u >= 1) return { p: rest, k: 1 }
    const e = easeOutBack(u, 0.6)
    const ec = clamp(1 - Math.pow(1 - u, 3), 0, 1)
    return {
      p: {
        x: rest.x + 0.6 * L.w * (1 - e),
        y: rest.y - 0.5 * L.h * (1 - e),
        rot: REST_ROT + (14 * DEG - REST_ROT) * (1 - e),
      },
      k: ec,
    }
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
    if (fresh || clean) {
      const [sx, sy] = toScreen(L, pc, ux, uy)
      shav.carry += 0.5 * fresh
      while (shav.carry >= 1) {
        shav.carry -= 1
        shav.spawn(sx, sy, p.vx, p.vy, tm)
      }
      shav.carryFlake += 0.15 * clean
      while (shav.carryFlake >= 1) {
        shav.carryFlake -= 1
        shav.spawn(sx, sy, p.vx, p.vy, tm, true)
      }
    }
  }

  function scrapeSegment(p: Ptr, x0: number, y0: number, x1: number, y1: number, tm: number, dtMs: number) {
    const { p: pc } = pose(tm)
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
      stampAt(p, sx, sy, dir + (chipR() * 2 - 1) * 8 * DEG, tm, pc)
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
    if (ptrs.size >= MAX_POINTERS) return
    if (first) {
      first = false
      ev.onFirst()
    }
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
      lastT: tm,
      coin: { x, y, px: x, py: y, dir: ang + REST_ROT, scale: 0.9, alpha: 1 },
      coinDir: ang + REST_ROT,
      downT: tm,
      up: null,
    }
    coinTarget(p)
    ptrs.set(id, p)
    const { p: pc } = pose(tm)
    const [ux, uy] = toCard(L, pc, x, y)
    p.foilAmt = cellState(ux, uy) === FOIL ? 1 : 0
    stampAt(p, ux, uy, ang, tm, pc)
    pendingDown = performance.now()
  }

  function move(id: number, x: number, y: number, tm = now()) {
    const p = ptrs.get(id)
    if (!p) return
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
    fading.push(p)
  }

  // ---------- DOM input ----------

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const [x, y] = local(e)
    canvas.setPointerCapture?.(e.pointerId)
    down(e.pointerId, e.pointerType, x, y)
  }
  const onMove = (e: PointerEvent) => {
    const [x, y] = local(e)
    const { p: pc } = pose(now())
    const [ux] = toCard(L, pc, x, y)
    tiltTarget = clamp((ux / 20) * 2 - 1, -1, 1)
    if (!ptrs.has(e.pointerId)) return
    const evs = (e.getCoalescedEvents?.() ?? []) as PointerEvent[]
    if (evs.length > 1) for (const ce of evs) move(e.pointerId, ...(local(ce) as [number, number]))
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

  function update(tm: number, dt: number) {
    shav.update(dt)
    // cap: oldest resting shavings are pressed into the felt or onto the card
    if (shav.list.length > CAP) {
      const { p: pc } = pose(tm)
      let over = shav.list.length - CAP
      const keep = []
      for (const s of shav.list) {
        if (over > 0 && s.resting) {
          bakeShaving(s, pc)
          over--
        } else keep.push(s)
      }
      shav.list = keep
    }
    const kd = 1 - Math.exp(-dt / 0.04)
    for (const p of [...ptrs.values(), ...fading]) {
      const sp = Math.hypot(p.vx, p.vy)
      const target = p.hasDir ? Math.atan2(p.dy, p.dx) + REST_ROT : p.coinDir
      if (sp > 30 || !p.hasDir) {
        let dd = target - p.coinDir
        dd = Math.atan2(Math.sin(dd), Math.cos(dd))
        p.coinDir += dd * kd
      }
      p.coin.dir = p.coinDir
      p.coin.scale = Math.min(1, 0.9 + (0.1 * (tm - p.downT)) / 60)
      if (p.up != null) p.coin.alpha = clamp(1 - (tm - p.up) / 180, 0, 1)
      // velocity decays when the finger holds still
      if (tm - p.lastT > 50 && p.up == null) {
        p.vx *= 0.8
        p.vy *= 0.8
      }
    }
    for (let i = fading.length - 1; i >= 0; i--) if (fading[i].coin.alpha <= 0) fading.splice(i, 1)
    tiltTarget = clamp(tiltTarget, -1, 1)
    tiltX += (clamp(tiltTarget + gamma / 30, -1.5, 1.5) - tiltX) * (1 - Math.exp(-dt / 0.25))
  }

  function bakeShaving(s: (typeof shav.list)[number], pc: CardPose) {
    const [ux, uy] = toCard(L, pc, s.x, s.y)
    if (ux > 0.2 && ux < 19.8 && uy > 0.3 && uy < 27.3) {
      const g = ctx2d(card.crumbs)
      g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0)
      shav.drawOne(g, s, ux * L.U, uy * L.U, -pc.rot)
    } else {
      const g = ctx2d(felt)
      g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0)
      shav.drawOne(g, s, s.x, s.y, 0)
    }
  }

  function draw(tm: number) {
    const { ctx, dpr, w, h } = stage
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.drawImage(felt, 0, 0, w, h)
    const { p: pc, k } = pose(tm)
    const U = L.U
    // L2 contact shadow: softer and fainter while in the air, tightening as it lands
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
    shadow(card.shadowB, lift)
    shadow(card.shadowA, k)
    // card space
    ctx.save()
    ctx.translate(pc.x, pc.y)
    ctx.rotate(pc.rot)
    ctx.translate(-L.CW / 2, -L.CH / 2)
    ctx.scale(U, U)
    ctx.drawImage(card.paper, 0, 0, 20, 27.6)
    const sheenX = 1.5 + (0.5 + 0.5 * Math.sin((tm - T0) / 1000 / 3.1)) * 17 + 0.6 * tiltX
    for (const R of card.regions) drawRegion(ctx, card.ff, R, U, sheenX)
    ctx.drawImage(card.crumbs, 0, 0, 20, 27.6)
    if (card.circles) drawCircles(ctx, tm)
    ctx.restore()
    // L7 shavings, L8 coins
    shav.draw(ctx)
    for (const p of fading) drawCoin(ctx, coinSp, p.coin, U)
    for (const p of ptrs.values()) drawCoin(ctx, coinSp, p.coin, U)
    if (pendingDown != null) {
      inputLag.push(performance.now() - pendingDown)
      if (inputLag.length > 60) inputLag.shift()
      pendingDown = null
    }
  }

  /** Red marker loops round the three matching cells (spec 3.8, L6). */
  function drawCircles(g: CanvasRenderingContext2D, tm: number) {
    const c = card.circles!
    g.save()
    g.globalCompositeOperation = 'multiply'
    g.strokeStyle = '#D4281C'
    g.globalAlpha = 0.9
    g.lineWidth = 0.16
    g.lineCap = 'round'
    g.lineJoin = 'round'
    c.cells.forEach((cell, i) => {
      const u = clamp((tm - c.t0 - i * 140) / 260, 0, 1)
      if (u <= 0) return
      const e = 1 - Math.pow(1 - u, 3)
      const [cx, cy] = cellCentre(cell)
      const r = rng(card.spec.seed + cell * 31)
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

  let last = performance.now()
  let raf = 0
  const loop = (nowMs: number) => {
    raf = requestAnimationFrame(loop)
    if (frozen != null) return
    const dt = Math.min(0.033, (nowMs - last) / 1000)
    last = nowMs
    update(nowMs, dt)
    draw(nowMs)
  }

  raf = requestAnimationFrame(loop)
  const onVis = () => {
    if (document.hidden) cancelAnimationFrame(raf)
    else {
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }
  }
  document.addEventListener('visibilitychange', onVis)

  const api: GameApi = {
    dispose() {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('deviceorientation', onOrient)
      disposeCanvas()
    },
  }

  // ---------- dev harness: __toy and the ?shot= stroke player ----------

  if (DEV) {
    const step = (sec: number) => {
      const N = Math.max(1, Math.round(sec * 60))
      for (let i = 0; i < N; i++) {
        frozen = (frozen ?? performance.now()) + sec * 1000 / N
        update(frozen, sec / N)
      }
      draw(frozen!)
    }
    /** card U -> screen */
    const S = (ux: number, uy: number) => toScreen(L, pose(now()).p, ux, uy)
    let pid = 100
    /** Drag a pointer along a polyline (card U) at `speed` U/s, 60 Hz input. */
    const drag = (pts: [number, number][], speed: number, type: string, o: { keepDown?: boolean; stopAt?: number } = {}) => {
      const id = ++pid
      const [x0, y0] = S(...pts[0])
      down(id, type, x0, y0, now())
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
        // boustrophedon sweep, leaving a few ragged patches (about 5%)
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
        const cells = card.spec.winCells
        card.circles = { cells, t0: now() }
        step(1.2)
      },
      void() {
        drag(zig(11.9, 23.6, 18.1, 0.5, 0.9), 22, touchType)
        drag(zig(18.1, 24.5, 11.9, 0.5, 0.9), 22, touchType)
        step(0.6)
      },
      pile() {
        // scrape until there are 300 shavings, then plough some off the right edge with a fingertip
        let y = 7.9
        let dirR = true
        while (shav.list.length < 300 && y < 18.4) {
          drag(dirR ? zig(2.0, y, 18.0, 0.3, 1.4) : zig(18.0, y, 2.0, 0.3, 1.4), 30, touchType, {})
          dirR = !dirR
          y += 1.9
          step(0.1)
        }
        while (shav.list.length > 300) shav.list.shift()
        step(0.4)
        // plough: start on scraped paper, push right, off the card onto the felt
        drag([[9.5, 10.0], [24.5, 10.6]], 60, touchType)
        drag([[9.0, 13.2], [25.0, 14.2]], 60, touchType)
        drag([[10.0, 8.6], [10.0, 4.0], [-3.0, 2.5]], 55, touchType)
        // the plough grazes a little foil; keep the still at 300 (drop the newest)
        if (shav.list.length > 300) shav.list.length = 300
        step(1.0)
        info.shavings = shav.list.length
      },
      sheen() {},
      /** dev only: all six symbols printed, panel wiped (for the S7 naming check) */
      symbols() {
        card.spec.grid = ['fish', 'cup', 'bed', 'cat', 'muyu', 'sun', 'sun', 'cat', 'fish']
        card.paper = bakeCard(card.spec, card.perf, L.K)
        card.regions[0].wipe(true)
      },
      arrive() {
        card.arriveT0 = now()
        draw(now())
      },
    }

    const shot = Q.get('shot')
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
      memory: () => {
        const cs: HTMLCanvasElement[] = [felt, card.paper, card.crumbs, card.ff.buf, card.shadowA.c, card.shadowB.c, coinSp.face, coinSp.edge, coinSp.shadow, ...brushes.map((b) => b.c)]
        for (const R of card.regions) cs.push(R.tex, R.mask, R.resTex, R.resMask)
        return +(cs.reduce((a, c) => a + c.width * c.height * 4, 0) / 1048576).toFixed(2)
      },
      shotReady: false,
    }
    if (shot && shots[shot]) {
      frozen = performance.now()
      // let the card land first
      step(0.6)
      shots[shot]()
      draw(now())
      ;(window as unknown as { __toy: { shotReady: boolean } }).__toy.shotReady = true
    }
  }
  return api
}

void cardPath
void easeInCubic
