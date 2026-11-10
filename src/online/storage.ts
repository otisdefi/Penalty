import type { Hex } from 'viem'
import type { NetworkId } from '../networks'

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

/**
 * Match numbers repeat on every network, so what is remembered is kept per network. Arc Testnet keeps the original
 * key names so a match started before Base Sepolia was added can still be resumed.
 */
const keyFor = (net: NetworkId, id: bigint | string) => (net === 'arc' ? 'tb:online:' : `tb:online:${net}:`) + id.toString()
const lastFor = (net: NetworkId) => (net === 'arc' ? 'tb:online:last' : `tb:online:last:${net}`)

export function loadStored(net: NetworkId, id: bigint | string): StoredMatch | null {
  try {
    const raw = localStorage.getItem(keyFor(net, id))
    return raw ? (JSON.parse(raw) as StoredMatch) : null
  } catch {
    return null
  }
}

export function saveStored(net: NetworkId, s: StoredMatch): void {
  try {
    localStorage.setItem(keyFor(net, s.id), JSON.stringify(s))
    localStorage.setItem(lastFor(net), s.id)
  } catch {
    /* storage unavailable: the session still works until the tab closes */
  }
}

export function loadLastId(net: NetworkId): string | null {
  try {
    return localStorage.getItem(lastFor(net))
  } catch {
    return null
  }
}

export function clearStored(net: NetworkId, id: bigint | string): void {
  try {
    localStorage.removeItem(keyFor(net, id))
    if (localStorage.getItem(lastFor(net)) === id.toString()) localStorage.removeItem(lastFor(net))
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
