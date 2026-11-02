export interface Jersey {
  color: string
  number: number
}

export interface Habits {
  shots: [number, number, number]
  dives: [number, number, number]
  trans: [[number, number, number], [number, number, number], [number, number, number]]
  lastShot: 0 | 1 | 2 | null
}

export interface PendingRanked {
  matchId: `0x${string}`
  won: boolean
  address: string
}

export const DEFAULT_JERSEY: Jersey = { color: '#e5383b', number: 10 }

export const emptyHabits = (): Habits => ({
  shots: [0, 0, 0],
  dives: [0, 0, 0],
  trans: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  lastShot: null,
})

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable (private mode): the game still works */
  }
}

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export function loadJersey(): Jersey {
  const j = read<Partial<Jersey>>('tb:jersey', {})
  return {
    color: isHexColor(j.color) ? j.color : DEFAULT_JERSEY.color,
    number: Number.isInteger(j.number) && (j.number as number) >= 0 && (j.number as number) <= 99 ? (j.number as number) : DEFAULT_JERSEY.number,
  }
}
export const saveJersey = (j: Jersey) => write('tb:jersey', j)


export function loadHabits(): Habits {
  const h = read<Habits | null>('tb:habits', null)
  if (!h || !Array.isArray(h.shots) || !Array.isArray(h.dives) || !Array.isArray(h.trans)) return emptyHabits()
  return h
}
export const saveHabits = (h: Habits) => write('tb:habits', h)

export const loadPending = () => read<PendingRanked | null>('tb:pending', null)
export const savePending = (p: PendingRanked) => write('tb:pending', p)
export function clearPending() {
  try {
    localStorage.removeItem('tb:pending')
  } catch {
    /* ignore */
  }
}
