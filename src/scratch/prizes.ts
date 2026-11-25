// The prize pool (prize expansion, 2026-11-26): 32 prizes in three tiers, each with one of the six symbols.
// The order is append-only: the share card carries a 1-based index into it (data.prize). Never reorder or delete.
// The draw itself is in draw.ts (loaded with the pool's text); no DOM, canvas or i18n in either, so the draw can
// be tested in node.
import type { SymbolId } from './symbols'

export type Tier = 'c' | 'u' | 'r'
/** timed prizes: Monday morning, Friday afternoon, late at night, the weekend */
export type When = 'mon_am' | 'fri_pm' | 'late' | 'weekend'
export type Fx = 'jackpot' | 'free_card' | 'void_pass'

export interface Prize {
  id: string
  sym: SymbolId
  tier: Tier
  /** toy host the toast opens */
  link?: string
  when?: When
  /** may be the first win on a new device */
  first?: boolean
  fx?: Fx
}

// id sym tier [flags]: L link host, W when, F first-win, X fx
const RAW =
  'slack fish c|coffee cup c|nap bed c|cat cat c Lpurr|merit muyu c Lknock|dayoff sun c Wweekend|' +
  'paid_break fish c F|skip_meeting fish c|last_snack cup c|early_night bed c Wlate|cat_cover cat c F|' +
  'not_your_fault muyu c|lunch_hour sun c|no_overtime sun c|left_on_read fish u|bubble_wrap fish u Lpop|' +
  'monday_fuel cup u Wmon_am|boss_lunch cup u F|squishy bed u Lsquish|free_card bed u Xfree_card|cat_email cat u|' +
  'void_pass cat u Xvoid_pass|empty_promise muyu u|glass muyu u Lsmash|friday_mode sun u Wfri_pm|' +
  'long_weekend sun u|raise fish r|coffee_for_life cup r|early_retirement bed r|cat_promotion cat r|' +
  'annual_leave sun r|million_merit muyu r Xjackpot'

export const POOL: Prize[] = RAW.split('|').map((row) => {
  const [id, sym, tier, ...flags] = row.split(' ')
  const p: Prize = { id, sym: sym as SymbolId, tier: tier as Tier }
  for (const f of flags) {
    const v = f.slice(1)
    if (f[0] === 'L') p.link = v
    else if (f[0] === 'W') p.when = v as When
    else if (f[0] === 'F') p.first = true
    else p.fx = v as Fx
  }
  return p
})
export const IDS = POOL.map((p) => p.id)
export const byId = (id: string) => POOL.find((p) => p.id === id)

/** GA's rarity enum */
export const rarity = (p: Prize) => (p.fx === 'jackpot' ? 'jackpot' : { c: 'common', u: 'uncommon', r: 'rare' }[p.tier])
/** the share card's number: 1 common or uncommon, 2 rare, 3 jackpot */
export const rarityN = (p: Prize) => (p.fx === 'jackpot' ? 3 : p.tier === 'r' ? 2 : 1)

export const RECENT = 8

export interface Draw {
  prize: Prize
  /** 1: the timed line */
  v: 0 | 1
}

/** Push a revealed win onto the recent list (the last 8 kept). */
export const pushRecent = (recent: string[], id: string) => [...recent.filter((x) => x !== id), id].slice(-RECENT)
