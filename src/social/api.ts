import type { MessageKey } from '../i18n/types'
import { getSupabase } from '../chat/client'
import { CHAT_CONFIGURED } from '../chat/config'

/*
 * Thin, defensive wrappers around the database functions in supabase/profiles_challenges.sql.
 * Every rule (filters, limits, cooldowns, blocks) is enforced by the database; the app only
 * explains the outcome. Everything that comes back is checked before it is used.
 */

export type ChallengeMode = 'friendly' | 'online'
export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'busy' | 'cancelled'
export type BlockKind = 'mute' | 'block'

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: MessageKey }

export interface Challenge {
  id: string
  direction: 'in' | 'out'
  /** The other player's username. */
  other: string
  mode: ChallengeMode
  roomCode: string
  matchId: bigint | null
  status: ChallengeStatus
  createdAt: number
  expiresAt: number
}

export interface PublicProfile {
  username: string
  joinedAt: number
  jerseyColor: string
  jerseySecondary: string
  jerseyPattern: 'solid' | 'stripes' | 'hoops' | 'half' | 'sash'
  jerseyNumber: number
  nameTag: string
  bio: string | null
  openToChallenges: boolean
  available: boolean
  banned: boolean
  challengesPlayed: number
  rankedWins: number | null
  winStreak: number | null
  myRelation: BlockKind | null
  isMe: boolean
  blockedMe: boolean
}

export interface MyProfile {
  nameTag: string
  bio: string
  openToChallenges: boolean
  showStats: boolean
}

export interface BlockedPlayer {
  username: string
  kind: BlockKind
  id: string
}

const PATTERNS = ['solid', 'stripes', 'hoops', 'half', 'sash'] as const
const STATUSES: ChallengeStatus[] = ['pending', 'accepted', 'declined', 'expired', 'busy', 'cancelled']

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null)
const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

/** Database rule names (the error text) to a message the player can act on. */
export function socialErrorKey(err: unknown): MessageKey {
  const raw = (err as { message?: unknown } | null)?.message
  const message = typeof raw === 'string' ? raw : ''
  const rule = /(challenge|profile|block|report)_[a-z_0-9]+|not_signed_in/.exec(message)?.[0] ?? ''
  switch (rule) {
    case 'not_signed_in':
      return 'social.err.signin'
    case 'challenge_self':
      return 'social.err.self'
    case 'challenge_unknown_player':
    case 'block_unknown_player':
    case 'report_unknown_player':
      return 'social.err.unknown'
    case 'challenge_receiver_banned':
    case 'challenge_sender_banned':
    case 'profile_banned':
      return 'social.err.banned'
    case 'challenge_blocked':
      return 'social.err.blocked'
    case 'challenge_closed':
      return 'social.err.closed'
    case 'challenge_unavailable':
      return 'social.err.unavailable'
    case 'challenge_pending':
      return 'social.err.pending'
    case 'challenge_cooldown':
      return 'social.err.cooldown'
    case 'challenge_rate_minute':
      return 'social.err.rateMinute'
    case 'challenge_rate_day':
      return 'social.err.rateDay'
    case 'profile_rate':
      return 'social.err.profileRate'
    case 'profile_tag_long':
    case 'profile_tag_chars':
      return 'social.err.tagChars'
    case 'profile_tag_blocked':
      return 'social.err.tagBlocked'
    case 'profile_bio_long':
      return 'social.err.bioLong'
    case 'profile_bio_link':
      return 'chat.err.link'
    case 'profile_bio_email':
      return 'chat.err.email'
    case 'profile_bio_phone':
      return 'chat.err.phone'
    case 'profile_bio_word':
      return 'chat.err.word'
    case 'profile_bio_bad_chars':
      return 'chat.err.badChars'
    case 'block_limit':
      return 'social.err.blockLimit'
    case 'report_rate':
      return 'social.err.reportRate'
    default:
      return /fetch|network|failed to|timeout/i.test(message) ? 'social.err.network' : 'social.err.generic'
  }
}

async function rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
  if (!CHAT_CONFIGURED) return { data: null, error: { message: 'chat_not_configured' } }
  try {
    const sb = await getSupabase()
    return await sb.rpc(fn, args)
  } catch (error) {
    return { data: null, error }
  }
}

/* ---------- profiles ---------- */

function parseProfile(raw: unknown): PublicProfile | null {
  if (!isObj(raw)) return null
  const username = str(raw.username, 12)
  const joined = time(raw.joined_at)
  const color = str(raw.jersey_color, 7)
  const secondary = str(raw.jersey_secondary, 7)
  const number = int(raw.jersey_number)
  const pattern = PATTERNS.find((p) => p === raw.jersey_pattern)
  if (!username || joined === null || !color || !secondary || number === null || !pattern) return null
  if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(secondary)) return null
  const relation = raw.my_relation === 'mute' || raw.my_relation === 'block' ? raw.my_relation : null
  return {
    username,
    joinedAt: joined,
    jerseyColor: color.toLowerCase(),
    jerseySecondary: secondary.toLowerCase(),
    jerseyPattern: pattern,
    jerseyNumber: Math.min(99, Math.max(1, number)),
    nameTag: str(raw.name_tag, 12) ?? '',
    bio: str(raw.bio, 60),
    openToChallenges: raw.open_to_challenges === true,
    available: raw.available === true,
    banned: raw.banned === true,
    challengesPlayed: Math.max(0, int(raw.challenges_played) ?? 0),
    rankedWins: int(raw.ranked_wins),
    winStreak: int(raw.win_streak),
    myRelation: relation,
    isMe: raw.is_me === true,
    blockedMe: raw.blocked_me === true,
  }
}

export async function getPublicProfile(username: string): Promise<Outcome<{ profile: PublicProfile | null }>> {
  const { data, error } = await rpc('get_public_profile', { p_username: username })
  if (error) return { ok: false, error: socialErrorKey(error) }
  const row: unknown = Array.isArray(data) ? (data as unknown[])[0] : data
  return { ok: true, profile: parseProfile(row) }
}

export async function getMyProfile(userId: string): Promise<Outcome<{ profile: MyProfile }>> {
  if (!CHAT_CONFIGURED) return { ok: false, error: 'social.err.generic' }
  try {
    const sb = await getSupabase()
    const { data, error } = await sb.from('profiles').select('name_tag,bio,open_to_challenges,show_stats').eq('id', userId).maybeSingle()
    if (error || !isObj(data)) return { ok: false, error: socialErrorKey(error) }
    return {
      ok: true,
      profile: {
        nameTag: str(data.name_tag, 12) ?? '',
        bio: str(data.bio, 60) ?? '',
        openToChallenges: data.open_to_challenges !== false,
        showStats: data.show_stats === true,
      },
    }
  } catch (error) {
    return { ok: false, error: socialErrorKey(error) }
  }
}

export interface ProfileUpdate {
  color: string
  secondary: string
  pattern: string
  number: number
  nameTag: string
  bio: string
  openToChallenges: boolean
  showStats: boolean
  wins: number | null
  streak: number | null
}

export async function updateMyProfile(u: ProfileUpdate): Promise<Outcome> {
  const { error } = await rpc('update_my_profile', {
    p_color: u.color,
    p_secondary: u.secondary,
    p_pattern: u.pattern,
    p_number: u.number,
    p_tag: u.nameTag,
    p_bio: u.bio,
    p_open: u.openToChallenges,
    p_show_stats: u.showStats,
    p_wins: u.wins,
    p_streak: u.streak,
  })
  return error ? { ok: false, error: socialErrorKey(error) } : { ok: true }
}

export async function touchPresence(): Promise<void> {
  await rpc('touch_presence')
}

/* ---------- challenges ---------- */

function parseChallenge(raw: unknown): Challenge | null {
  if (!isObj(raw)) return null
  const id = str(raw.id, 64)
  const other = str(raw.other_username, 12)
  const created = time(raw.created_at)
  const expires = time(raw.expires_at)
  const room = str(raw.room_code, 80)
  const status = STATUSES.find((s) => s === raw.status)
  const mode = raw.mode === 'friendly' || raw.mode === 'online' ? raw.mode : null
  if (!id || !other || created === null || expires === null || !room || !status || !mode) return null
  if (raw.direction !== 'in' && raw.direction !== 'out') return null
  const matchText = typeof raw.match_id === 'string' || typeof raw.match_id === 'number' ? String(raw.match_id) : null
  return {
    id,
    direction: raw.direction,
    other,
    mode,
    roomCode: room,
    matchId: matchText && /^\d{1,18}$/.test(matchText) ? BigInt(matchText) : null,
    status,
    createdAt: created,
    expiresAt: expires,
  }
}

export async function listChallenges(): Promise<Outcome<{ challenges: Challenge[] }>> {
  const { data, error } = await rpc('my_challenges')
  if (error) return { ok: false, error: socialErrorKey(error) }
  const rows = Array.isArray(data) ? data : []
  return { ok: true, challenges: rows.map(parseChallenge).filter((c): c is Challenge => c !== null) }
}

export async function sendChallengeRpc(to: string, mode: ChallengeMode, room: string, matchId: bigint | null): Promise<Outcome<{ id: string }>> {
  const { data, error } = await rpc('send_challenge', { p_to: to, p_mode: mode, p_room: room, p_match_id: matchId === null ? null : matchId.toString() })
  if (error) return { ok: false, error: socialErrorKey(error) }
  return typeof data === 'string' ? { ok: true, id: data } : { ok: false, error: 'social.err.generic' }
}

export async function respondChallengeRpc(id: string, action: 'accept' | 'decline' | 'busy' | 'cancel'): Promise<Outcome<{ status: ChallengeStatus }>> {
  const { data, error } = await rpc('respond_challenge', { p_id: id, p_action: action })
  if (error) return { ok: false, error: socialErrorKey(error) }
  const status = STATUSES.find((s) => s === data)
  return status ? { ok: true, status } : { ok: false, error: 'social.err.generic' }
}

/* ---------- mute, block, report ---------- */

export async function setBlockRpc(username: string, kind: BlockKind): Promise<Outcome> {
  const { error } = await rpc('set_block', { p_username: username, p_kind: kind })
  return error ? { ok: false, error: socialErrorKey(error) } : { ok: true }
}

export async function removeBlockRpc(username: string): Promise<Outcome> {
  const { error } = await rpc('remove_block', { p_username: username })
  return error ? { ok: false, error: socialErrorKey(error) } : { ok: true }
}

export async function listBlocks(): Promise<Outcome<{ blocks: BlockedPlayer[] }>> {
  const { data, error } = await rpc('my_blocks')
  if (error) return { ok: false, error: socialErrorKey(error) }
  const rows = Array.isArray(data) ? data : []
  const blocks: BlockedPlayer[] = []
  for (const r of rows) {
    if (!isObj(r)) continue
    const username = str(r.username, 12)
    const id = str(r.blocked_id, 64)
    if (username && id && (r.kind === 'mute' || r.kind === 'block')) blocks.push({ username, id, kind: r.kind })
  }
  return { ok: true, blocks }
}

export async function reportPlayerRpc(username: string): Promise<Outcome> {
  const { error } = await rpc('report_player', { p_username: username, p_reason: null })
  return error ? { ok: false, error: socialErrorKey(error) } : { ok: true }
}
