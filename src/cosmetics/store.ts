import { useSyncExternalStore } from 'react'
import { BALLS, PATTERNS, STADIUMS, TRAILS, colorReq, isKnownColor, isUnlocked, reqOf, type UnlockStats } from './catalog'
import { safeTag } from './nameFilter'
import { DEFAULT_COSMETICS, type Cosmetics } from './types'
import { clampNumber, isBall, isPattern, isStadium, isTrail } from './validate'

const KEY = 'tb:cosmetics:v1'
const STATS_KEY = 'tb:ranked-stats:v1'

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

/** Replace any locked choice with its free default. Only the unlock stats decide what is allowed. */
export function applyUnlocks(c: Cosmetics, stats: UnlockStats): Cosmetics {
  const d = DEFAULT_COSMETICS
  const ok = (req: Parameters<typeof isUnlocked>[0]) => isUnlocked(req, stats)
  return {
    jersey: {
      ...c.jersey,
      color: ok(colorReq(c.jersey.color)) ? c.jersey.color : d.jersey.color,
      secondary: ok(colorReq(c.jersey.secondary ?? d.jersey.secondary!)) ? c.jersey.secondary : d.jersey.secondary,
      pattern: ok(reqOf(PATTERNS, c.jersey.pattern ?? 'solid')) ? c.jersey.pattern : 'solid',
    },
    ball: ok(reqOf(BALLS, c.ball)) ? c.ball : d.ball,
    trail: ok(reqOf(TRAILS, c.trail)) ? c.trail : d.trail,
    stadium: ok(reqOf(STADIUMS, c.stadium)) ? c.stadium : d.stadium,
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

export const useCosmetics = (): Cosmetics => useSyncExternalStore(subscribe, getCosmetics)

/* ---------- ranked results counted in this browser ---------- */

interface LocalStats {
  wins: number
  streak: number
  best: number
  counted: string[]
}

function loadStats(): LocalStats {
  const empty: LocalStats = { wins: 0, streak: 0, best: 0, counted: [] }
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (!raw) return empty
    const s = JSON.parse(raw) as Partial<LocalStats>
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
    return { wins: n(s.wins), streak: n(s.streak), best: n(s.best), counted: Array.isArray(s.counted) ? s.counted.filter((x) => typeof x === 'string').slice(-20) : [] }
  } catch {
    return empty
  }
}

let stats: LocalStats = loadStats()
const statListeners = new Set<() => void>()

/** Count a finished ranked match once (the key stops a re-render from counting it twice). */
export function recordRankedResult(won: boolean, key: string): void {
  if (stats.counted.includes(key)) return
  const streak = won ? stats.streak + 1 : 0
  stats = {
    wins: stats.wins + (won ? 1 : 0),
    streak,
    best: Math.max(stats.best, streak),
    counted: [...stats.counted, key].slice(-20),
  }
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats))
  } catch {
    /* ignore */
  }
  statListeners.forEach((fn) => fn())
}

const subscribeStats = (fn: () => void) => {
  statListeners.add(fn)
  return () => statListeners.delete(fn)
}

export const useLocalStats = (): LocalStats => useSyncExternalStore(subscribeStats, () => stats)
