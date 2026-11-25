import { useEffect, useRef, useState } from 'react'
import { MoreMenu, pillClass } from './components/MoreMenu'
import { applyMeta, locale, t } from './i18n'
import { startAnalytics, track } from './analytics'
import { landing, live, openSheet, parseWords, sharePeak, stats, trackLanding } from './share'
import { MAX_GIFT, giftFromUrl, syncGiftToUrl } from './gift'
import { Hint } from './components/Hint'
import { startGame, type GameApi } from './game'

const fmt = new Intl.NumberFormat(locale)

function countLabel(n: number, k: number) {
  const vars = { n: fmt.format(n), k: fmt.format(k) }
  if (n === 1 && k === 1) return t('scratch_count_11', vars)
  if (n === 1) return t('scratch_count_n1', vars)
  if (k === 1) return t('scratch_count_k1', vars)
  return t('scratch_count', vars)
}

/** Where the card's lower edge sits (same formula as scratch/layout.ts), for the "Another one" pill. */
function nextTop() {
  const w = window.innerWidth
  const h = window.innerHeight
  const CW = Math.min(0.92 * w, (0.64 * h) / 1.38, 460)
  return Math.min(0.495 * h + 0.69 * CW + 14, h - 116)
}

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const api = useRef<GameApi | null>(null)
  const urlTimer = useRef<number | undefined>(undefined)
  const gaTimer = useRef<number | undefined>(undefined)
  const toastTimer = useRef<number | undefined>(undefined)
  const [initial] = useState(() => giftFromUrl())
  const [text, setText] = useState(() => initial.join(', '))
  // a recipient sees no prize text until it is scratched out: the box shows only the prizes revealed so far
  const [shown, setShown] = useState(() => (landing.recipient ? 0 : initial.length))
  const veiled = shown < initial.length
  // a recipient answering: the box opens empty, with its own placeholder; done typing, the sheet comes back
  const box = useRef<HTMLInputElement>(null)
  const [ph, setPh] = useState('')
  /** the box was typed in this visit (a tap in and out of the sender's revealed prize is not writing one) */
  const edited = useRef(false)
  const [touched, setTouched] = useState(false)
  const [counts, setCounts] = useState({ cards: 0, wins: 0 })
  const [toast, setToast] = useState<{ text: string; link?: string; id: number } | null>(null)
  const [done, setDone] = useState(false)
  const [pillY, setPillY] = useState(nextTop)

  useEffect(() => {
    applyMeta('scratch')
    startAnalytics('scratch')
    stats.words = initial
    trackLanding({ words: initial.length })
    const base = document.title
    if (shown < initial.length) document.title = t('scratch_title_gift')
    const g = startGame(
      ref.current!,
      {
        onFirst() {
          setTouched(true)
          track('play_start')
        },
        onCounts(cards, wins) {
          stats.n = cards
          stats.k = wins
          setCounts({ cards, wins })
        },
        onToast(msg, link) {
          setToast({ text: msg, link, id: Date.now() })
          window.clearTimeout(toastTimer.current)
          toastTimer.current = window.setTimeout(() => setToast(null), 3200)
        },
        onSettled(d) {
          setDone(d)
        },
        onReveal(r, snap) {
          if (r.gift) {
            setShown((v) => {
              if (Math.max(v, r.gift) >= initial.length) document.title = base
              return Math.max(v, r.gift)
            })
          }
          sharePeak('scratch', { snap, data: r })
        },
      },
      initial,
    )
    api.current = g
    live.ticket = () => (stats.words?.length ? g.ticket(stats.words[0]) : null)
    const onResize = () => setPillY(nextTop())
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      g.dispose()
    }
  }, [initial])

  const onText = (value: string) => {
    edited.current = true
    setText(value)
    const words = parseWords(value, MAX_GIFT)
    stats.words = words
    window.clearTimeout(urlTimer.current)
    urlTimer.current = window.setTimeout(() => syncGiftToUrl(words), 300)
    // GA gets the number of lines only, never the text
    window.clearTimeout(gaTimer.current)
    if (words.length) gaTimer.current = window.setTimeout(() => track('gift_written', { count: words.length }), 2000)
  }

  // the answer is offered only once the prize is out (before that, clearing the box would lose it)
  live.reply = veiled
    ? undefined
    : () => {
        onText('')
        setPh(t('scratch_reply_ph'))
        box.current?.focus()
      }
  /** Done writing a prize: the link carries it now, so the gift ticket is offered as the slip (the answer: the sheet). */
  const written = () => {
    const words = parseWords(text, MAX_GIFT)
    if (veiled || !words.length || !edited.current) return
    edited.current = false
    window.clearTimeout(urlTimer.current)
    syncGiftToUrl(words)
    if (ph) {
      setPh('')
      openSheet('reply')
    } else sharePeak('scratch', { snap: null, data: {} })
  }

  const pill = pillClass('scratch')

  return (
    <>
      <canvas ref={ref} />
      <input
        ref={box}
        value={veiled ? initial.slice(0, shown).join(', ') : text}
        readOnly={veiled}
        maxLength={300}
        placeholder={veiled ? t('scratch_hidden') : ph || t('scratch_placeholder')}
        onBlur={written}
        enterKeyHint="done"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="fixed left-1/2 top-3 z-20 w-80 max-w-[86vw] -translate-x-1/2 rounded-full border border-white/20 bg-black/20 px-4 py-1.5 text-center text-base text-white placeholder-white/45 outline-none backdrop-blur-md focus:border-white/40 focus:bg-black/30"
      />
      <div className="pointer-events-none fixed inset-x-0 top-[3.4rem] z-10 flex flex-col items-center gap-1.5 select-none px-4 text-center">
        {counts.cards > 0 && (
          <div className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-[13px] tabular-nums text-white/75 backdrop-blur-md">
            {countLabel(counts.cards, counts.wins)}
          </div>
        )}
      </div>
      {toast && (
        <div
          key={toast.id}
          className="knock-toast fixed inset-x-0 top-[5.6rem] z-10 px-6 text-center text-base font-medium"
          style={{ color: 'rgba(255,244,214,0.95)', pointerEvents: toast.link ? 'auto' : 'none' }}
        >
          {toast.link ? (
            <a href={toast.link} className="underline decoration-white/40 underline-offset-4">
              {toast.text}
            </a>
          ) : (
            toast.text
          )}
        </div>
      )}
      <Hint text={t('hint_scratch')} hidden={touched} />
      {done && (
        <div className="fixed inset-x-0 z-20 flex justify-center" style={{ top: pillY }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => api.current?.next()} className={`${pill} border-white/30 bg-white/15 px-5 text-white/90`}>
            {t('scratch_next')}
          </button>
        </div>
      )}
      <MoreMenu current="scratch" />
    </>
  )
}
