import { translate } from '../i18n'

const KEY = 'tb:guest-number:v1'
let cached: number | null = null

/** A short random number that stays the same on this device, used for players without a name. */
export function guestNumber(): number {
  if (cached !== null) return cached
  let n = 0
  try {
    n = Number(localStorage.getItem(KEY))
  } catch {
    /* storage unavailable */
  }
  if (!Number.isInteger(n) || n < 1000 || n > 9999) {
    n = 1000 + Math.floor(Math.random() * 9000)
    try {
      localStorage.setItem(KEY, String(n))
    } catch {
      /* the number then lasts until the tab closes */
    }
  }
  cached = n
  return n
}

const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

/**
 * The name shown for a player. A chosen name wins. Without one, onchain players show their short
 * wallet address and everyone else shows "Player" plus a short number.
 */
export function displayName(name: string | undefined, address?: string): string {
  const trimmed = name?.trim()
  if (trimmed) return trimmed
  if (address) return short(address)
  return `${translate('sb.player')} ${guestNumber()}`
}
