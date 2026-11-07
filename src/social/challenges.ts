import { useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { MessageKey } from '../i18n/types'
import { getSupabase } from '../chat/client'
import { appBridge } from './nav'
import {
  listChallenges,
  respondChallengeRpc,
  sendChallengeRpc,
  touchPresence,
  type Challenge,
  type ChallengeMode,
  type ChallengeStatus,
  type Outcome,
} from './api'

/*
 * The challenge engine: follows my challenges live (Supabase Realtime) and falls back to polling every
 * few seconds if realtime is not connected. It never stores anything on the device.
 */

export interface EngineState {
  list: Challenge[]
  /** True while the realtime connection is up. */
  live: boolean
  /** The last problem sending a challenge, shown once. */
  sendError: MessageKey | null
}

let state: EngineState = { list: [], live: false, sendError: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<EngineState>) => {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const useChallenges = (): EngineState => useSyncExternalStore(subscribe, () => state)

const POLL_OFFLINE_MS = 4000
const POLL_ONLINE_MS = 30000
const PRESENCE_MS = 60000

let userId: string | null = null
let channel: RealtimeChannel | null = null
let pollTimer: ReturnType<typeof setTimeout> | undefined
let presenceTimer: ReturnType<typeof setInterval> | undefined
let visibilityHandler: (() => void) | null = null
let refreshing = false
const answeredBusy = new Set<string>()

async function refresh(): Promise<void> {
  if (!userId || refreshing) return
  refreshing = true
  try {
    const result = await listChallenges()
    if (!result.ok || !userId) return
    set({ list: result.challenges })
    // Anyone who challenges me while I am in a match hears "busy" at once.
    if (appBridge.busy) {
      for (const c of result.challenges) {
        if (c.direction === 'in' && c.status === 'pending' && c.expiresAt > Date.now() && !answeredBusy.has(c.id)) {
          answeredBusy.add(c.id)
          void respondChallengeRpc(c.id, 'busy').then(() => void refresh())
        }
      }
    }
  } finally {
    refreshing = false
  }
}

function schedulePoll(): void {
  clearTimeout(pollTimer)
  if (!userId) return
  pollTimer = setTimeout(() => {
    void refresh().finally(schedulePoll)
  }, state.live ? POLL_ONLINE_MS : POLL_OFFLINE_MS)
}

export async function startEngine(id: string): Promise<void> {
  if (userId === id) return
  stopEngine()
  userId = id
  void touchPresence()
  presenceTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void touchPresence()
  }, PRESENCE_MS)
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      void touchPresence()
      void refresh()
    }
  }
  document.addEventListener('visibilitychange', visibilityHandler)
  window.addEventListener('online', visibilityHandler)
  void refresh()
  schedulePoll()
  try {
    const sb = await getSupabase()
    if (userId !== id) return
    // Any change to a challenge I am part of tells me to reload my list. Row Level Security means I only
    // ever receive events for my own challenges.
    channel = sb
      .channel(`challenges:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges', filter: `receiver_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges', filter: `sender_id=eq.${id}` }, () => void refresh())
      .subscribe((status) => {
        if (userId !== id) return
        const live = (status as string) === 'SUBSCRIBED'
        if (live !== state.live) {
          set({ live })
          if (live) void refresh() // catch up on anything missed while disconnected
          schedulePoll()
        }
      })
  } catch {
    set({ live: false }) // polling keeps working
  }
}

export function stopEngine(): void {
  const old = channel
  channel = null
  userId = null
  clearTimeout(pollTimer)
  clearInterval(presenceTimer)
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    window.removeEventListener('online', visibilityHandler)
    visibilityHandler = null
  }
  answeredBusy.clear()
  state = { list: [], live: false, sendError: null }
  listeners.forEach((fn) => fn())
  if (old) void getSupabase().then((sb) => sb.removeChannel(old)).catch(() => undefined)
}

/** Send a challenge. The database applies every rule (limits, cooldown, blocks, availability). */
export async function sendChallenge(to: string, mode: ChallengeMode, room: string, matchId: bigint | null = null): Promise<Outcome> {
  set({ sendError: null })
  const result = await sendChallengeRpc(to, mode, room, matchId)
  if (!result.ok) {
    set({ sendError: result.error })
    return result
  }
  await refresh()
  return { ok: true }
}

export async function respondToChallenge(id: string, action: 'accept' | 'decline' | 'cancel'): Promise<Outcome<{ status: ChallengeStatus }>> {
  const result = await respondChallengeRpc(id, action)
  await refresh()
  return result
}

/** Cancel my own waiting challenge, for example when I leave the room I made for it. */
export async function cancelOutgoing(): Promise<void> {
  const pending = state.list.find((c) => c.direction === 'out' && c.status === 'pending')
  if (pending) await respondToChallenge(pending.id, 'cancel')
}

export const clearSendError = () => set({ sendError: null })
