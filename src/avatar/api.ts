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
/** A failure carries a plain-language message key and, when there is one, the technical details of the real error. */
export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: MessageKey; detail?: string }

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
const MAX_UPLOAD_BYTES = 512 * 1024 // the same limit as the bucket
const UPLOAD_TYPES = ['image/webp', 'image/jpeg']
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** One short line with the real error: the step, the message, the HTTP status and the error code. No tokens, no secrets. */
export function describeError(step: string, err: unknown, context = ''): string {
  const e = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>
  const message = typeof e.message === 'string' && e.message ? e.message : typeof err === 'string' ? err : 'unknown error'
  const meta: string[] = []
  const text = (x: unknown): string => (typeof x === 'string' || typeof x === 'number' ? String(x) : '')
  const status = text(e.status)
  if (status) meta.push(`HTTP ${status}`)
  const code = text(e.statusCode) || text(e.code)
  if (code && code !== status) meta.push(`code ${code}`)
  if (typeof e.hint === 'string' && e.hint) meta.push(`hint: ${e.hint}`)
  return `${step}: ${message}${meta.length ? ` (${meta.join(', ')})` : ''}${context ? ` [${context}]` : ''}`
}

/**
 * The upload, in the three steps the database expects: ticket, file, confirm. Before anything is sent it checks what the
 * storage rules check: the type is exactly image/webp or image/jpeg, the size is under the bucket limit, the object path is
 * exactly the player's id (no folder, no extension) and the request belongs to the signed-in player.
 *
 * The file is sent as raw bytes with an explicit Content-Type header. (With a Blob, the storage client ignores the
 * contentType option and sends a multipart form whose type comes from the Blob.)
 */
export async function uploadAvatar(userId: string, blob: Blob, contentType: 'image/webp' | 'image/jpeg'): Promise<Outcome> {
  if (!CHAT_CONFIGURED) return { ok: false, error: 'social.err.generic' }
  const context = `type=${contentType} size=${blob.size}B path=${userId.length === 36 ? 'user-id' : 'invalid'}`
  const fail = (step: string, error: MessageKey, err: unknown): Outcome => {
    const detail = describeError(step, err, context)
    console.error('[avatar upload]', {
      step,
      message: (err as { message?: unknown } | null)?.message ?? String(err),
      status: (err as { status?: unknown } | null)?.status,
      statusCode: (err as { statusCode?: unknown } | null)?.statusCode,
      code: (err as { code?: unknown } | null)?.code,
      type: contentType,
      bytes: blob.size,
      blobType: blob.type,
    })
    return { ok: false, error, detail }
  }

  if (!UPLOAD_TYPES.includes(contentType)) return fail('check', 'avatar.img.unsupported', new Error('the picture type must be image/webp or image/jpeg'))
  if (blob.size <= 0 || blob.size > MAX_UPLOAD_BYTES) return fail('check', 'avatar.img.tooLarge', new Error(`the picture must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes`))
  if (!USER_ID.test(userId)) return fail('check', 'avatar.err.uploadFailed', new Error('the object path must be exactly the user id'))

  try {
    const sb = await getSupabase()
    const session = await sb.auth.getSession()
    const token = (session as { data?: { session?: { access_token?: string; user?: { id?: string } } | null } }).data?.session
    if (!token?.access_token) return fail('session', 'social.err.signin', new Error('no signed-in session'))
    if (token.user?.id && token.user.id !== userId) return fail('session', 'avatar.err.uploadFailed', new Error('the session belongs to another user'))

    const ticket = await rpc('request_avatar_upload')
    if (ticket.error) return fail('ticket', avatarErrorKey(ticket.error), ticket.error)

    const bytes = await blob.arrayBuffer()
    const put = await sb.storage.from(BUCKET).upload(userId, bytes, { upsert: true, contentType, cacheControl: '3600' })
    if (put.error) return fail('upload', avatarErrorKey(put.error), put.error)

    const done = await rpc('confirm_avatar_uploaded')
    if (done.error) return fail('confirm', avatarErrorKey(done.error), done.error)
    return { ok: true }
  } catch (e) {
    return fail('upload', avatarErrorKey(e), e)
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
