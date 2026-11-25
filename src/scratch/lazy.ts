// What comes after boot, in one chunk: the full draw, the jackpot's print and stamp, and (one file per language,
// fetched from here) the prize pool's text.
import { locale, type Locale } from '../i18n'

export { drawPrize, timed } from './draw'
export { burst, drawStamp, goldBox } from './jackpot'

const FILES: Record<Locale, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('../prizes/en'),
  'zh-CN': () => import('../prizes/zh-CN'),
  es: () => import('../prizes/es'),
  fr: () => import('../prizes/fr'),
  ja: () => import('../prizes/ja'),
}
export const text = () => FILES[locale]().then((m) => m.default)
