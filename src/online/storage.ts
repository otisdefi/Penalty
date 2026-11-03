import type { Hex } from 'viem'

/** Everything this browser must remember to keep playing (or resume) an online match. */
export interface StoredMatch {
  id: string
  wallet: string
  /** Throwaway helper key that signs commits and reveals so the wallet is not asked every move. */
  sessionKey?: Hex
  /** Room code for a friend room created here (kept so the creator can re-copy the link). */
  roomCode?: Hex
  /** Commitments by kick index, kept so a reload never loses a reveal. */
  moves: Record<string, { dir: number; salt: Hex }>
}

const KEY = 'tb:online:'
const LAST = 'tb:online:last'

export function loadStored(id: bigint | string): StoredMatch | null {
  try {
    const raw = localStorage.getItem(KEY + id.toString())
    return raw ? (JSON.parse(raw) as StoredMatch) : null
  } catch {
    return null
  }
}

export function saveStored(s: StoredMatch): void {
  try {
    localStorage.setItem(KEY + s.id, JSON.stringify(s))
    localStorage.setItem(LAST, s.id)
  } catch {
    /* storage unavailable: the session still works until the tab closes */
  }
}

export function loadLastId(): string | null {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}

export function clearStored(id: bigint | string): void {
  try {
    localStorage.removeItem(KEY + id.toString())
    if (localStorage.getItem(LAST) === id.toString()) localStorage.removeItem(LAST)
  } catch {
    /* ignore */
  }
}

/** A freshly generated helper key waiting to be attached to a match id. */
const PENDING = 'tb:online:pending-key'
export function loadPendingKey(wallet: string): Hex | null {
  try {
    const raw = localStorage.getItem(PENDING)
    if (!raw) return null
    const v = JSON.parse(raw) as { wallet: string; key: Hex }
    return v.wallet.toLowerCase() === wallet.toLowerCase() ? v.key : null
  } catch {
    return null
  }
}
export function savePendingKey(wallet: string, key: Hex): void {
  try {
    localStorage.setItem(PENDING, JSON.stringify({ wallet, key }))
  } catch {
    /* ignore */
  }
}
export function clearPendingKey(): void {
  try {
    localStorage.removeItem(PENDING)
  } catch {
    /* ignore */
  }
}
