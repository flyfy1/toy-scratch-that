// The full draw (tiers, weights, the repeat and symbol rules), loaded with the pool's text: until then, and if that
// never comes, game.ts draws from the prizes in the main bundle. No DOM, canvas or i18n: tested in node.
import { type Draw, POOL, type Prize, RECENT, type Tier, type When, byId } from './prizes'

/** Does a timed prize's condition hold on the device clock at `d`? */
export function timed(w: When | undefined, d: Date): boolean {
  const day = d.getDay()
  const h = d.getHours()
  if (w === 'mon_am') return day === 1 && h < 12
  if (w === 'fri_pm') return day === 5 && h >= 14
  if (w === 'late') return h >= 22 || h < 4
  if (w === 'weekend') return day === 0 || day === 6
  return false
}

const TIER_W: [Tier, number][] = [
  ['c', 60],
  ['u', 30],
  ['r', 10],
]

export interface DrawIn {
  r: () => number
  /** the last wins on this device, newest last (built-in prizes only) */
  recent: string[]
  /** dealt but not yet revealed */
  pending: string[]
  now: Date
  /** is this string loaded (a prize is only dealt when its text is there) */
  has: (key: string) => boolean
  /** the card a free_card guaranteed: it cannot be free_card again */
  noFree?: boolean
}

/**
 * Pick a win: first win on a new device from the first-win set; otherwise the tier (60 / 30 / 10), then a prize in
 * it (weight 1, 3 for a timed prize whose line shows now), never one of the last 8 wins or a dealt card, and not the
 * previous win's symbol while another choice is left. An empty tier falls to the one below (then the ones above);
 * with nothing left at all the repeat rule gives way, oldest first.
 */
export function drawPrize(o: DrawIn): Draw {
  const text = (p: Prize) => o.has(`scratch_prize_${p.id}`)
  const alt = (p: Prize) => !!p.when && timed(p.when, o.now) && o.has(`scratch_prize_${p.id}_alt`)
  const ok = (p: Prize) => text(p) && !(o.noFree && p.fx === 'free_card')
  const fresh = o.recent.length === 0 && o.pending.length === 0
  const pickW = (list: Prize[]): Draw => {
    const w = list.map((p) => (alt(p) ? 3 : 1))
    let x = o.r() * w.reduce((a, b) => a + b, 0)
    let i = 0
    while (i < list.length - 1 && (x -= w[i]) >= 0) i++
    return { prize: list[i], v: alt(list[i]) ? 1 : 0 }
  }
  if (fresh) {
    const f = POOL.filter((p) => p.first && ok(p))
    if (f.length) return pickW(f)
  }
  const x = o.r() * 100
  let acc = 0
  let tier: Tier = 'c'
  for (const [t, w] of TIER_W) if (x < (acc += w)) {
    tier = t
    break
  }
  const block = new Set([...o.recent.slice(-RECENT), ...o.pending])
  const lastSym = o.recent.length ? byId(o.recent[o.recent.length - 1])?.sym : undefined
  // down from the tier drawn, then up
  for (const i of [2, 1, 0, 1, 2].slice(2 - TIER_W.findIndex(([t]) => t === tier))) {
    const cand = POOL.filter((p) => p.tier === TIER_W[i][0] && ok(p) && !block.has(p.id))
    if (!cand.length) continue
    const other = cand.filter((p) => p.sym !== lastSym)
    return pickW(other.length ? other : cand)
  }
  // nothing left: the oldest of the recent ones (never a dealt card if avoidable)
  const all = POOL.filter((p) => ok(p) && !o.pending.includes(p.id))
  const list = all.length ? all : POOL.filter(ok)
  const age = (p: Prize) => o.recent.lastIndexOf(p.id)
  list.sort((a, b) => age(a) - age(b))
  return { prize: list[0], v: alt(list[0]) ? 1 : 0 }
}
