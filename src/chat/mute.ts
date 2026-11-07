import { useSyncExternalStore } from 'react'

const KEY = 'tb:chat-muted:v1'

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 200) : []
  } catch {
    return []
  }
}

let muted = load()
const listeners = new Set<() => void>()

function save(next: string[]): void {
  muted = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: the mute lasts until the tab closes */
  }
  listeners.forEach((fn) => fn())
}

export const muteUser = (id: string): void => {
  if (!muted.includes(id)) save([...muted, id].slice(-200))
}
export const unmuteAll = (): void => save([])
export const useMuted = (): string[] =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => muted,
  )
