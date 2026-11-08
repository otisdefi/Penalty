import type { MessageKey } from '../i18n/types'
import { getSupabase } from '../chat/client'
import { CHAT_CONFIGURED } from '../chat/config'
import type { PatternId } from '../cosmetics/types'

/*
 * Thin, defensive wrappers around the picture functions in supabase/avatars/. Every rule (who may upload,
 * the daily limit, who may see a picture, what is public) is enforced by the database and the storage
 * policies; the app only explains the outcome. Everything that comes back is checked before it is used.
 */

export const BUCKET = 'avatars'
export const SIGNED_URL_SECONDS = 1800

export type AvatarStatus = 'none' | 'pending' | 'approved' | 'rejected'
export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: MessageKey }

export interface AvatarInfo {
  username: string
  jerseyColor: string
  jerseySecondary: string
  jerseyPattern: PatternId
  jerseyNumber: number
  status: AvatarStatus
  /** The storage path (the player's id) when this reader may see the picture, else null. */
  path: string | null
  version: number | null
}

const PATTERNS: PatternId[] = ['solid', 'stripes', 'hoops', 'half', 'sash']
const STATUSES: AvatarStatus[] = ['none', 'pending', 'approved', 'rejected']

/** Maps a database or storage failure to a plain-language message. */
export function avatarErrorKey(err: unknown): MessageKey {
  const raw = (err as { message?: unknown } | null)?.message
  const message = typeof raw === 'string' ? raw : ''
  if (/not_signed_in/.test(message)) return 'social.err.signin'
  if (/avatar_banned/.test(message)) return 'avatar.err.banned'
  if (/avatar_limit_day/.test(message)) return 'avatar.err.limitDay'
  if (/avatar_rate\b/.test(message)) return 'avatar.err.rate'
  if (/avatar_report_rate/.test(message)) return 'social.err.reportRate'
  if (/avatar_report_unavailable|avatar_unknown_player/.test(message)) return 'avatar.err.reportUnavailable'
  if (/avatar_report_self/.test(message)) return 'avatar.err.reportSelf'
  if (/avatar_no_ticket|avatar_not_found|row-level security|violates|mime|size|exceeded|Payload too large/i.test(message)) return 'avatar.err.uploadFailed'
  if (/fetch|network|Failed to|timeout/i.test(message)) return 'social.err.network'
  return 'social.err.generic'
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
const str = (x: unknown, fallback = ''): string => (typeof x === 'string' ? x : fallback)

function parseInfo(row: unknown): AvatarInfo | null {
  if (!isRecord(row) || typeof row.username !== 'string') return null
  const status = STATUSES.find((s) => s === row.avatar_status) ?? 'none'
  const path = typeof row.avatar_path === 'string' && /^[0-9a-f-]{36}$/.test(row.avatar_path) ? row.avatar_path : null
  const version = typeof row.avatar_version === 'number' ? row.avatar_version : typeof row.avatar_version === 'string' ? Number(row.avatar_version) : null
  const number = Number(row.jersey_number)
  return {
    username: row.username,
    jerseyColor: /^#[0-9a-f]{6}$/i.test(str(row.jersey_color)) ? str(row.jersey_color) : '#e5383b',
    jerseySecondary: /^#[0-9a-f]{6}$/i.test(str(row.jersey_secondary)) ? str(row.jersey_secondary) : '#f1f5f9',
    jerseyPattern: PATTERNS.find((p) => p === row.jersey_pattern) ?? 'solid',
    jerseyNumber: Number.isInteger(number) && number >= 1 && number <= 99 ? number : 10,
    status: path ? status : status === 'rejected' ? 'rejected' : 'none',
    path,
    version: version !== null && Number.isFinite(version) ? version : null,
  }
}

async function rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
  const sb = await getSupabase()
  return (await sb.rpc(fn, args)) as { data: unknown; error: unknown }
}

/** Picture details (and jersey colours for the default avatar) for up to 100 usernames. Signed-in players only. */
export async function fetchAvatarInfo(usernames: string[]): Promise<Outcome<{ infos: AvatarInfo[] }>> {
  if (!CHAT_CONFIGURED) return { ok: false, error: 'social.err.generic' }
  try {
    const { data, error } = await rpc('get_avatar_info', { p_usernames: usernames.slice(0, 100) })
    if (error) return { ok: false, error: avatarErrorKey(error) }
    const rows: unknown[] = Array.isArray(data) ? (data as unknown[]) : []
    return { ok: true, infos: rows.map(parseInfo).filter((i): i is AvatarInfo => i !== null) }
  } catch (e) {
    return { ok: false, error: avatarErrorKey(e) }
  }
}

/** Short-lived links for pictures this reader is allowed to see. Paths that are refused are simply left out. */
export async function fetchSignedUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (paths.length === 0) return urls
  try {
    const sb = await getSupabase()
    const { data } = (await sb.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)) as { data: unknown }
    for (const item of Array.isArray(data) ? (data as unknown[]) : []) {
      if (isRecord(item) && typeof item.path === 'string' && typeof item.signedUrl === 'string' && !item.error && item.signedUrl.startsWith('https://')) {
        urls.set(item.path, item.signedUrl)
      }
    }
  } catch {
    /* no links: the default avatar is shown */
  }
  return urls
}

/**
 * Three steps, each checked by the database or storage policies:
 * 1. ask for an upload ticket (signed in, not banned, at most 3 a day; the old picture goes back to "pending"),
 * 2. upload the file under the player's own id,
 * 3. confirm, so the picture is marked "pending" until the owner of the app approves it.
 */
export async function uploadAvatar(userId: string, blob: Blob, contentType: 'image/webp' | 'image/jpeg'): Promise<Outcome> {
  if (!CHAT_CONFIGURED) return { ok: false, error: 'social.err.generic' }
  try {
    const sb = await getSupabase()
    const ticket = await rpc('request_avatar_upload')
    if (ticket.error) return { ok: false, error: avatarErrorKey(ticket.error) }
    const put = await sb.storage.from(BUCKET).upload(userId, blob, { upsert: true, contentType, cacheControl: '3600' })
    if (put.error) return { ok: false, error: avatarErrorKey(put.error) }
    const done = await rpc('confirm_avatar_uploaded')
    if (done.error) return { ok: false, error: avatarErrorKey(done.error) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: avatarErrorKey(e) }
  }
}

/** Delete the file first (the policy needs the picture to be readable), then tell the database. */
export async function removeMyAvatar(userId: string): Promise<Outcome> {
  if (!CHAT_CONFIGURED) return { ok: false, error: 'social.err.generic' }
  try {
    const sb = await getSupabase()
    await sb.storage.from(BUCKET).remove([userId]) // best effort: the database queues the file for deletion either way
    const { error } = await rpc('remove_my_avatar')
    return error ? { ok: false, error: avatarErrorKey(error) } : { ok: true }
  } catch (e) {
    return { ok: false, error: avatarErrorKey(e) }
  }
}

export async function reportAvatar(username: string): Promise<Outcome> {
  if (!CHAT_CONFIGURED) return { ok: false, error: 'social.err.generic' }
  try {
    const { error } = await rpc('report_avatar', { p_username: username })
    return error ? { ok: false, error: avatarErrorKey(error) } : { ok: true }
  } catch (e) {
    return { ok: false, error: avatarErrorKey(e) }
  }
}

const PURGE_KEY = 'tb:avatar-purge-at'
const PURGE_EVERY_MS = 30 * 60 * 1000

/**
 * Quietly asks the purge-avatars function to delete pictures that were rejected or removed. At most once every
 * 30 minutes per device; if the function is not deployed or fails, nothing is shown and nothing breaks.
 */
export async function maybePurgeAvatars(): Promise<void> {
  if (!CHAT_CONFIGURED) return
  try {
    const last = Number(localStorage.getItem(PURGE_KEY) ?? '0')
    if (Number.isFinite(last) && Date.now() - last < PURGE_EVERY_MS) return
    localStorage.setItem(PURGE_KEY, String(Date.now()))
  } catch {
    return // no storage: skip, rather than calling on every page
  }
  try {
    const sb = await getSupabase()
    await sb.functions.invoke('purge-avatars', { method: 'POST' })
  } catch {
    /* optional function */
  }
}
