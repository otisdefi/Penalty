import { useMemo, useSyncExternalStore } from 'react'
import { useAccountName } from '../chat/account'
import { isKnownColor } from './catalog'
import { safeTag } from './nameFilter'
import { DEFAULT_COSMETICS, type Cosmetics } from './types'
import { clampNumber, isBall, isPattern, isStadium, isTrail } from './validate'

const KEY = 'tb:cosmetics:v1'

/* ---------- saved choices ---------- */

/** Clean up anything read from storage so a corrupted or edited value can never break the game. */
export function sanitizeCosmetics(raw: unknown): Cosmetics {
  const d = DEFAULT_COSMETICS
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const j = (r.jersey && typeof r.jersey === 'object' ? r.jersey : {}) as Record<string, unknown>
  const color = typeof j.color === 'string' && isKnownColor(j.color) ? j.color.toLowerCase() : d.jersey.color
  const secondary = typeof j.secondary === 'string' && isKnownColor(j.secondary) ? j.secondary.toLowerCase() : d.jersey.secondary
  return {
    jersey: {
      color,
      secondary,
      number: clampNumber(j.number, d.jersey.number),
      pattern: isPattern(j.pattern) ? j.pattern : 'solid',
      tag: safeTag(j.tag),
    },
    ball: isBall(r.ball) ? r.ball : d.ball,
    trail: isTrail(r.trail) ? r.trail : d.trail,
    stadium: isStadium(r.stadium) ? r.stadium : d.stadium,
  }
}

function load(): Cosmetics {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitizeCosmetics(JSON.parse(raw)) : DEFAULT_COSMETICS
  } catch {
    return DEFAULT_COSMETICS
  }
}

let current: Cosmetics = load()
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getCosmetics = () => current

export function setCosmetics(update: Partial<Cosmetics> | ((c: Cosmetics) => Cosmetics)): void {
  const next = sanitizeCosmetics(typeof update === 'function' ? update(current) : { ...current, ...update })
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable (private mode): choices last until the tab closes */
  }
  listeners.forEach((fn) => fn())
}

/** Your saved choices. When you are signed in, your username is the public name on your shirt. */
export function useCosmetics(): Cosmetics {
  const saved = useSyncExternalStore(subscribe, getCosmetics)
  const account = useAccountName()
  return useMemo(() => (account ? { ...saved, jersey: { ...saved.jersey, tag: account } } : saved), [saved, account])
}
