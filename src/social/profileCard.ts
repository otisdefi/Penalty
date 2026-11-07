import { useSyncExternalStore } from 'react'

export interface CardTarget {
  username: string
  /** The author's user id when it is known (from a chat message), used to hide their messages at once. */
  userId: string | null
}

let target: CardTarget | null = null
const listeners = new Set<() => void>()
const set = (next: CardTarget | null) => {
  target = next
  listeners.forEach((fn) => fn())
}

export const openProfileCard = (username: string, userId: string | null = null) => set({ username, userId })
export const closeProfileCard = () => set(null)
export const useProfileCardTarget = (): CardTarget | null =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => target,
  )
