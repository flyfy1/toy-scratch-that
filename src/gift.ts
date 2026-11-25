// Scratch That's gift link: the prize travels as `g` (base64url), so the address does not give it away.
// Old `?w=` links keep working; a recipient's address is rewritten to `g` at once.
import { landing, parseWords, setSearch, wordsFromUrl } from './share'

export const MAX_GIFT = 24

const b64u = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

function unb64u(s: string): string {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))
  } catch {
    return ''
  }
}

const query = (words: string[]) => (words.length ? `?g=${b64u(words.join(','))}` : '')

export function giftFromUrl(): string[] {
  const g = new URLSearchParams(location.search).get('g')
  if (g) return parseWords(unb64u(g), MAX_GIFT)
  const words = wordsFromUrl(MAX_GIFT)
  // an old ?w= link opened by somebody else: hide the prize from the address bar too
  if (words.length && landing.recipient) {
    const url = new URL(location.href)
    url.search = query(words)
    history.replaceState(null, '', url.toString())
  }
  return words
}

/** Keep ?g= in the address bar in sync, noted as written on this device. */
export const syncGiftToUrl = (words: string[]) => setSearch(query(words))
