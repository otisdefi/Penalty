// Supabase Edge Function: reset a forgotten password with the one-time recovery code.
//
// It runs on Supabase's servers. The service-role key lives only there (Supabase injects it as
// SUPABASE_SERVICE_ROLE_KEY) and is never sent to the browser or put in the app's code.
//
// Deploy: Supabase dashboard > Edge Functions > Deploy a new function > name it "reset-password" >
// paste this file. (Or: supabase functions deploy reset-password)
// Optional secrets (Edge Functions > Secrets): TURNSTILE_SECRET_KEY, ALLOWED_ORIGIN.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 20

interface Admin {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  auth: { admin: { updateUserById: (id: string, attrs: { password: string }) => PromiseLike<{ error: { message: string; code?: string } | null }> } }
}

export interface Deps {
  admin: Admin
  env: (name: string) => string | undefined
  fetchImpl: typeof fetch
}

const normalizeCode = (input: string): string =>
  input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function newRecoveryCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => ALPHABET[b % 32]!)
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-')
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = deps.env('ALLOWED_ORIGIN') || '*'
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return reply(405, { error: 'method' })

  let body: Record<string, unknown>
  try {
    const text = await req.text()
    if (text.length > 2000) return reply(413, { error: 'too_large' })
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return reply(400, { error: 'bad_request' })
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const code = typeof body.code === 'string' ? normalizeCode(body.code) : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : ''

  if (!/^[A-Za-z0-9_]{3,12}$/.test(username) || code.length !== CODE_LENGTH) return reply(400, { error: 'invalid' })
  if (newPassword.length < 8 || newPassword.length > 72) return reply(422, { error: 'weak' })

  // Bot protection: when a Turnstile secret is set, a valid token is required.
  const turnstileSecret = deps.env('TURNSTILE_SECRET_KEY')
  if (turnstileSecret) {
    if (!captchaToken) return reply(400, { error: 'captcha' })
    try {
      const form = new URLSearchParams({ secret: turnstileSecret, response: captchaToken })
      const res = await deps.fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
      const result = (await res.json()) as { success?: boolean }
      if (!result.success) return reply(400, { error: 'captcha' })
    } catch {
      return reply(502, { error: 'captcha' })
    }
  }

  // 1. Check the code (the database counts wrong guesses and locks after 5 for 15 minutes).
  const check = await deps.admin.rpc('check_recovery', { p_username: username, p_hash: await sha256Hex(code) })
  if (check.error) return check.error.message.includes('recovery_locked') ? reply(429, { error: 'locked' }) : reply(500, { error: 'server' })
  const userId = typeof check.data === 'string' ? check.data : null
  if (!userId) return reply(400, { error: 'invalid' }) // unknown name and wrong code look the same

  // 2. Set the new password with the admin API.
  const update = await deps.admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (update.error) return update.error.code === 'weak_password' || /password/i.test(update.error.message) ? reply(422, { error: 'weak' }) : reply(500, { error: 'server' })

  // 3. The code is one-time: issue a new one and store only its hash.
  const next = newRecoveryCode()
  const store = await deps.admin.rpc('replace_recovery_hash', { p_user: userId, p_hash: await sha256Hex(normalizeCode(next)) })
  if (store.error) return reply(500, { error: 'server' })
  return reply(200, { recoveryCode: next })
}

// Start the server only inside Supabase (Deno). The functions above are plain TypeScript so they can be tested.
declare const Deno: { env: { get: (name: string) => string | undefined }; serve: (handler: (req: Request) => Promise<Response>) => void } | undefined
if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  Deno.serve((req) => handle(req, { admin: admin as unknown as Admin, env: (name) => Deno.env.get(name), fetchImpl: fetch }))
}
