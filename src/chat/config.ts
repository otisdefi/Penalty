/*
 * Supabase settings. The URL and the anon key are public by design (they only identify the project;
 * Row Level Security decides what each player may do). Never put a service_role key in the app.
 */
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export const SUPABASE_URL = clean(import.meta.env.VITE_SUPABASE_URL)
export const SUPABASE_ANON_KEY = clean(import.meta.env.VITE_SUPABASE_ANON_KEY)

/** Cloudflare Turnstile site key (public). Optional: without it the sign-up form shows no CAPTCHA. */
export const TURNSTILE_SITE_KEY = clean(import.meta.env.VITE_TURNSTILE_SITE_KEY)

/** Chat and accounts only work when both Supabase values are present and look right. */
function looksConfigured(): boolean {
  const urlOk = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(SUPABASE_URL) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(SUPABASE_URL)
  return urlOk && SUPABASE_ANON_KEY.length > 20
}
export const CHAT_CONFIGURED = looksConfigured()

/**
 * Usernames become a placeholder identity  name@players.tiebreaker.invalid  because Supabase Auth wants
 * an email-shaped value. ".invalid" can never receive mail, so no email is collected. This must match
 * the domain in supabase/schema.sql.
 */
export const IDENTITY_DOMAIN = 'players.tiebreaker.invalid'

export const MESSAGE_MAX = 200
export const USERNAME_MIN = 3
export const USERNAME_MAX = 12
export const PASSWORD_MIN = 8
/** Supabase hashes with bcrypt, which only reads the first 72 characters. */
export const PASSWORD_MAX = 72
/** Client-side pause between messages (the database enforces the real limit). */
export const SEND_COOLDOWN_MS = 2000
export const HISTORY_LIMIT = 50
