// The prize pool's text: the first-win prizes and the six old ones are in strings.ts (card 1 never waits);
// the rest, and every new claim line, comes in one small file per language, fetched at boot and merged into the
// i18n table, so `t`, `tx` and the share documents read it like any other line. With it come the full draw and
// the jackpot's print. Until both are here (or if they never come), a win is drawn only from the prizes whose
// text is in the main bundle: a card never shows an empty prize.
import { addStrings, tx } from './i18n'

/** the full draw and the jackpot's print, once loaded */
export const fx: { pool?: typeof import('./scratch/lazy') } = {}

let ready: Promise<boolean> | null = null
export function loadPrizeText(): Promise<boolean> {
  ready ??= import('./scratch/lazy')
    .then(async (pool) => {
      addStrings(await pool.text())
      fx.pool = pool
      return true
    })
    .catch(() => false)
  return ready
}

/** Is this line loaded? */
export const hasText = (key: string) => tx(key) !== ''
