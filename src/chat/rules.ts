import { hasBlockedWord } from '../cosmetics/nameFilter'
import { IDENTITY_DOMAIN, MESSAGE_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from './config'

/* ---------- usernames and passwords ---------- */

const USERNAME_RE = /^[A-Za-z0-9_]+$/

export type UsernameProblem = 'length' | 'chars' | 'blocked' | null

export function usernameProblem(name: string): UsernameProblem {
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return 'length'
  if (!USERNAME_RE.test(name)) return 'chars'
  if (hasBlockedWord(name)) return 'blocked'
  return null
}

/** The placeholder identity for a username. It is never an inbox. */
export const identityEmail = (username: string): string => `${username.toLowerCase()}@${IDENTITY_DOMAIN}`

/** 0 = too short, 1 = weak, 2 = fair, 3 = strong. A hint only: the rule is the minimum length. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < PASSWORD_MIN) return 0
  let kinds = 0
  if (/[a-z]/.test(pw)) kinds += 1
  if (/[A-Z]/.test(pw)) kinds += 1
  if (/\d/.test(pw)) kinds += 1
  if (/[^A-Za-z0-9]/.test(pw)) kinds += 1
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|qwertyui|iloveyou)/i.test(pw)) return 1
  if (pw.length >= 14 || (pw.length >= 10 && kinds >= 3)) return 3
  return kinds >= 2 ? 2 : 1
}

/* ---------- chat messages (mirrors supabase/schema.sql; the database is the real gatekeeper) ---------- */

export type MessageProblem = 'empty' | 'too_long' | 'bad_chars' | 'link' | 'email' | 'phone' | 'blocked_word'

const BAD_CHARS = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/
const LINK =
  /(https?:|ftp:|www\.|:\/\/|t\.me|bit\.ly|wa\.me|discord|telegram|whatsapp)|[a-z0-9-]\.(com|net|org|io|xyz|gg|me|app|co|ly|eth|link|info|biz|ru|cn|tk|dev|site|online|shop|store|club|top|vip|cc|tv|ws|gl|gd|ai)([^a-z0-9]|$)|(dot|d0t)\s*(com|net|org|io)/i
const EMAIL = /@|\((at)\)|\[(at)\]/i
const PHONE = /(\d[\s().+-]*){7,}/

/** Trim and squash whitespace, the same way the database does. */
export const cleanMessage = (raw: string): string => raw.trim().replace(/\s+/g, ' ')

export function messageProblem(raw: string): MessageProblem | null {
  if (raw.length > MESSAGE_MAX) return 'too_long'
  const body = cleanMessage(raw)
  if (body.length === 0) return 'empty'
  if (BAD_CHARS.test(body)) return 'bad_chars'
  if (LINK.test(body)) return 'link'
  if (EMAIL.test(body)) return 'email'
  if (PHONE.test(body)) return 'phone'
  if (hasBlockedWord(body)) return 'blocked_word'
  return null
}

/* ---------- recovery codes ---------- */

// No I, L, O or U, so a code is easy to read out and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 20 // 20 characters x 5 bits = 100 bits

/** A random one-time code like  7K2QM-9XH4D-TR8WB-C3NF5. Shown once, only its hash is stored. */
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32])
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-')
}

/** Forgiving input: any case, spaces or dashes, and the look-alikes I and L (for 1) and O (for 0). */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}

export const isRecoveryCode = (input: string): boolean => normalizeRecoveryCode(input).length === CODE_LENGTH

/** SHA-256 (hex) of the normalised code. The Edge Function computes the same value. */
export async function hashRecoveryCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeRecoveryCode(code))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
