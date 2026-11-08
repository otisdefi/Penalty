import { useEffect, useSyncExternalStore } from 'react'
import { fetchAvatarInfo, fetchSignedUrls, maybePurgeAvatars, SIGNED_URL_SECONDS, type AvatarInfo } from './api'

/*
 * A small shared cache of "who has which picture", so a chat full of messages from the same players asks the
 * database once (names are batched, up to 100 at a time) and signs links once. Pictures are only ever fetched for
 * signed-in players; guests simply see the generated default avatar.
 */

export interface AvatarEntry {
  info: AvatarInfo | null
  /** A short-lived signed link, or null (default avatar). */
  url: string | null
  /** When the link should be renewed. */
  expiresAt: number
  fetchedAt: number
}

const EMPTY: AvatarEntry = { info: null, url: null, expiresAt: 0, fetchedAt: 0 }
const STALE_MS = 5 * 60 * 1000
const RETRY_AFTER_ERROR_MS = 60 * 1000

let signedIn = false
const entries = new Map<string, AvatarEntry>()
const listeners = new Set<() => void>()
const wanted = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

export const avatarKey = (username: string) => username.trim().toLowerCase()

function emit() {
  for (const l of listeners) l()
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function isFresh(entry: AvatarEntry | undefined, now: number): boolean {
  if (!entry || now - entry.fetchedAt > STALE_MS) return false
  return !entry.url || entry.expiresAt > now
}

export function requestAvatar(username: string) {
  const k = avatarKey(username)
  if (!signedIn || k === '' || isFresh(entries.get(k), Date.now())) return
  wanted.add(k)
  if (!timer) timer = setTimeout(() => void flush(), 60)
}

async function flush() {
  timer = null
  const names = [...wanted].slice(0, 100)
  for (const n of names) wanted.delete(n)
  if (names.length === 0 || !signedIn) return
  const res = await fetchAvatarInfo(names)
  if (!signedIn) return
  const now = Date.now()
  if (!res.ok) {
    // Try again in about a minute rather than hammering a failing server.
    for (const n of names) entries.set(n, { info: entries.get(n)?.info ?? null, url: null, expiresAt: 0, fetchedAt: now - STALE_MS + RETRY_AFTER_ERROR_MS })
  } else {
    const byName = new Map(res.infos.map((i) => [avatarKey(i.username), i]))
    const paths = [...new Set(res.infos.map((i) => i.path).filter((p): p is string => p !== null))]
    const urls = await fetchSignedUrls(paths)
    if (!signedIn) return
    for (const n of names) {
      const info = byName.get(n) ?? null
      const url = info?.path ? (urls.get(info.path) ?? null) : null
      entries.set(n, { info, url, expiresAt: now + SIGNED_URL_SECONDS * 1000 - 120_000, fetchedAt: now })
    }
  }
  emit()
  if (wanted.size > 0 && !timer) timer = setTimeout(() => void flush(), 60)
}

/** Ask again soon (after an upload or removal) without blanking the current picture meanwhile. */
export function refreshAvatar(username: string) {
  const k = avatarKey(username)
  const cur = entries.get(k)
  if (cur) entries.set(k, { ...cur, fetchedAt: 0 })
  requestAvatar(k)
}

/** The link stopped working (expired): drop it and fetch a fresh one. */
export function avatarImageFailed(username: string) {
  const k = avatarKey(username)
  const cur = entries.get(k)
  if (!cur || cur.url === null) return
  entries.set(k, { ...cur, url: null, expiresAt: 0, fetchedAt: 0 })
  emit()
  requestAvatar(k)
}

export function startAvatarEngine() {
  if (signedIn) return
  signedIn = true
  emit()
  void maybePurgeAvatars()
}

export function stopAvatarEngine() {
  signedIn = false
  entries.clear()
  wanted.clear()
  if (timer) clearTimeout(timer)
  timer = null
  emit()
}

/** The current cached entry, without subscribing (used by non-React code and tests). */
export const peekAvatar = (username: string): AvatarEntry => entries.get(avatarKey(username)) ?? EMPTY

export function useAvatarEntry(username: string | null | undefined): AvatarEntry {
  const k = username ? avatarKey(username) : ''
  const entry = useSyncExternalStore(subscribe, () => (k ? (entries.get(k) ?? EMPTY) : EMPTY))
  const active = useSyncExternalStore(subscribe, () => signedIn)
  useEffect(() => {
    if (k && active) requestAvatar(k)
  }, [k, active, entry.fetchedAt])
  return entry
}
