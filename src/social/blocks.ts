import { useSyncExternalStore } from 'react'
import { muteUser } from '../chat/mute'
import { listBlocks, removeBlockRpc, setBlockRpc, type BlockedPlayer, type BlockKind, type Outcome } from './api'

/*
 * Players I muted or blocked. The database holds the truth (it hides their messages and stops their
 * challenges even if this app is closed); this keeps a copy so the screen updates the moment I tap.
 */

let blocks: BlockedPlayer[] = []
const listeners = new Set<() => void>()
const set = (next: BlockedPlayer[]) => {
  blocks = next
  listeners.forEach((fn) => fn())
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const useBlocks = (): BlockedPlayer[] => useSyncExternalStore(subscribe, () => blocks)

export async function refreshBlocks(): Promise<void> {
  const result = await listBlocks()
  if (result.ok) set(result.blocks)
}

export function clearBlocks(): void {
  set([])
}

/** Mute or block. Messages from that player disappear from chat straight away. */
export async function blockPlayer(username: string, userId: string | null, kind: BlockKind): Promise<Outcome> {
  if (userId) muteUser(userId) // hide them on this device straight away (works for guests too)
  const result = await setBlockRpc(username, kind)
  if (result.ok) await refreshBlocks()
  return result
}

export async function unblockPlayer(username: string): Promise<Outcome> {
  const result = await removeBlockRpc(username)
  if (result.ok) await refreshBlocks()
  return result
}
