// Supabase Edge Function: automatic safety check of profile pictures.
//
// The app calls it right after an upload (and after someone reports an approved picture). It reads the picture from the
// private "avatars" bucket with the service role, sends it to one or more image moderation services, and applies the
// verdict through the database functions in supabase/avatars/moderation_part2_of_2.sql:
//   clearly safe  -> approved at once        flagged -> rejected, file deleted        anything else -> stays "pending" for you
//
// No key is in this file or in the app. Everything comes from Edge Function secrets (Dashboard > Edge Functions > Secrets):
//   MODERATION_PROVIDER             one name, or several separated by commas (the strictest answer wins). Default: sightengine
//                                   Names: sightengine | openai | azure
//   SIGHTENGINE_API_USER, SIGHTENGINE_API_SECRET        for "sightengine"   (optional: SIGHTENGINE_MODELS, comma separated)
//   OPENAI_API_KEY                                      for "openai"
//   AZURE_CONTENT_SAFETY_ENDPOINT, AZURE_CONTENT_SAFETY_KEY   for "azure"   (endpoint like https://NAME.cognitiveservices.azure.com)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase itself.
//
// Deploy: Dashboard > Edge Functions > Deploy a new function > Via Editor > name it "check-avatar" > paste this file > Deploy.
// Keep "Verify JWT" ON. To use another service, add one function below and register it in PROVIDERS.

const BUCKET = 'avatars'
const MAX_BYTES = 512 * 1024 // the bucket limit
const TIMEOUT_MS = 12_000
const FLAG = 0.6 // probability at or above which a picture is clearly not allowed
const MAYBE = 0.2 // probability at or above which a person should look

type Verdict = 'safe' | 'flagged' | 'uncertain' | 'error'
export interface Result {
  verdict: Verdict
  reasons: string[]
}
export interface Img {
  bytes: Uint8Array
  mime: 'image/webp' | 'image/jpeg'
}
type RpcReply = PromiseLike<{ data: unknown; error: { message: string } | null }>
export interface Admin {
  auth: { getUser: (jwt: string) => PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> }
  rpc: (fn: string, args?: Record<string, unknown>) => RpcReply
  from: (table: string) => { select: (cols: string) => { eq: (col: string, val: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } } }
  storage: { from: (bucket: string) => { download: (path: string) => PromiseLike<{ data: Blob | null; error: { message: string } | null }> } }
}
export interface Deps {
  admin: Admin
  env: (name: string) => string | undefined
  fetchImpl: typeof fetch
}
type Provider = (img: Img, deps: Deps) => Promise<Result>

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------
const bad = (reason: string): Result => ({ verdict: 'error', reasons: [reason] })
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const pct = (x: number) => x.toFixed(2)

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** The largest number among the given values, or null when none of them is a number. */
function maxOf(values: unknown[]): number | null {
  const nums = values.map(num).filter((n): n is number => n !== null)
  return nums.length ? Math.max(...nums) : null
}

/** Turns a list of "name score" findings into one verdict. A missing finding means the answer was not understood. */
function judge(findings: { name: string; score: number | null; flag?: number; maybe?: number }[]): Result {
  let verdict: Verdict = 'safe'
  const reasons: string[] = []
  for (const f of findings) {
    if (f.score === null) return bad(`${f.name}: answer not understood`)
    if (f.score >= (f.flag ?? FLAG)) {
      verdict = 'flagged'
      reasons.push(`${f.name} ${pct(f.score)}`)
    } else if (f.score >= (f.maybe ?? MAYBE)) {
      if (verdict !== 'flagged') verdict = 'uncertain'
      reasons.push(`${f.name} ${pct(f.score)}`)
    }
  }
  return { verdict, reasons }
}

/** Several services at once: the strictest answer wins; a service that failed means "not clearly safe". */
export function combine(results: Result[]): Result {
  const order: Verdict[] = ['flagged', 'uncertain', 'error', 'safe']
  const verdict = order.find((v) => results.some((r) => r.verdict === v)) ?? 'error'
  return { verdict, reasons: results.flatMap((r) => r.reasons) }
}

// ---------------------------------------------------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------------------------------------------------

/** Sightengine (https://sightengine.com/docs): nudity, hate symbols, gore, weapons, and optionally minors and self-harm. */
const sightengine: Provider = async (img, d) => {
  const user = d.env('SIGHTENGINE_API_USER')
  const secret = d.env('SIGHTENGINE_API_SECRET')
  if (!user || !secret) return bad('sightengine: SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET are not set')
  const models = (d.env('SIGHTENGINE_MODELS') || 'nudity-2.1,offensive,gore-2.0,weapon')
    .split(',').map((m) => m.trim()).filter(Boolean)
  const form = new FormData()
  form.append('media', new Blob([img.bytes], { type: img.mime }), img.mime === 'image/webp' ? 'avatar.webp' : 'avatar.jpg')
  form.append('models', models.join(','))
  form.append('api_user', user)
  form.append('api_secret', secret)
  const res = await d.fetchImpl('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) return bad(`sightengine: http ${res.status}`)
  const body: unknown = await res.json()
  if (!isRecord(body) || body.status !== 'success') return bad('sightengine: the request was not accepted')

  const findings: { name: string; score: number | null; flag?: number; maybe?: number }[] = []
  for (const model of models) {
    const part = (key: string): Record<string, unknown> | null => (isRecord(body[key]) ? (body[key] as Record<string, unknown>) : null)
    if (model.startsWith('nudity')) {
      const n = part('nudity')
      findings.push({ name: 'nudity', score: n ? maxOf([n.sexual_activity, n.sexual_display, n.erotica]) : null })
      findings.push({ name: 'suggestive', score: n ? maxOf([n.very_suggestive]) : null, flag: 0.9, maybe: 0.6 })
    } else if (model.startsWith('offensive')) {
      const o = part('offensive')
      const classes = o && isRecord(o.classes) ? Object.values(o.classes) : []
      findings.push({ name: 'offensive symbols', score: o ? (num(o.prob) ?? maxOf(classes)) : null })
    } else if (model.startsWith('gore')) {
      const g = part('gore')
      const classes = g && isRecord(g.classes) ? Object.values(g.classes) : []
      findings.push({ name: 'gore', score: g ? (num(g.prob) ?? maxOf(classes)) : null })
    } else if (model === 'weapon') {
      const w = body.weapon
      const classes = isRecord(w) && isRecord(w.classes) ? Object.values(w.classes) : isRecord(w) ? Object.values(w) : []
      findings.push({ name: 'weapon', score: num(w) ?? maxOf(classes), flag: 0.7, maybe: 0.3 })
    } else if (model === 'violence' || model === 'self-harm') {
      const v = part(model)
      findings.push({ name: model, score: v ? num(v.prob) : null })
    } else if (model === 'face-attributes') {
      const faces = body.faces
      const minors = Array.isArray(faces)
        ? faces.map((f) => (isRecord(f) && isRecord(f.attributes) ? num(f.attributes.minor) : null))
        : null
      findings.push({ name: 'minor', score: minors ? (minors.length ? maxOf(minors) : 0) : null, flag: 0.7, maybe: 0.4 })
    } else {
      return bad(`sightengine: model "${model}" is not supported by this function`)
    }
  }
  return judge(findings)
}

/** OpenAI omni-moderation (https://platform.openai.com/docs/guides/moderation): free; for images it covers sexual, violence and self-harm only. */
const openai: Provider = async (img, d) => {
  const key = d.env('OPENAI_API_KEY')
  if (!key) return bad('openai: OPENAI_API_KEY is not set')
  const res = await d.fetchImpl('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url: `data:${img.mime};base64,${toBase64(img.bytes)}` } }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return bad(`openai: http ${res.status}`)
  const body: unknown = await res.json()
  const first = isRecord(body) && Array.isArray(body.results) ? body.results[0] : null
  const scores = isRecord(first) && isRecord(first.category_scores) ? first.category_scores : null
  if (!scores) return bad('openai: answer not understood')
  const names = ['sexual', 'violence', 'violence/graphic', 'self-harm', 'self-harm/intent', 'self-harm/instructions']
  return judge(names.map((name) => ({ name, score: num(scores[name]) })))
}

/** Azure AI Content Safety (https://learn.microsoft.com/azure/ai-services/content-safety/): hate, sexual, violence, self-harm with severity levels. */
const azure: Provider = async (img, d) => {
  const endpoint = d.env('AZURE_CONTENT_SAFETY_ENDPOINT')?.replace(/\/+$/, '')
  const key = d.env('AZURE_CONTENT_SAFETY_KEY')
  if (!endpoint || !key) return bad('azure: AZURE_CONTENT_SAFETY_ENDPOINT / AZURE_CONTENT_SAFETY_KEY are not set')
  const res = await d.fetchImpl(`${endpoint}/contentsafety/image:analyze?api-version=2024-09-01`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ image: { content: toBase64(img.bytes) }, categories: ['Hate', 'SelfHarm', 'Sexual', 'Violence'], outputType: 'FourSeverityLevels' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return bad(`azure: http ${res.status}`)
  const body: unknown = await res.json()
  const list = isRecord(body) && Array.isArray(body.categoriesAnalysis) ? body.categoriesAnalysis : null
  if (!list) return bad('azure: answer not understood')
  const severity = (category: string): number | null => {
    const row = list.find((r) => isRecord(r) && r.category === category)
    return isRecord(row) ? num(row.severity) : null
  }
  // Severity 0 = safe, 2 = low, 4 = medium, 6 = high. Medium and high are rejected, low goes to a person.
  return judge(['Hate', 'SelfHarm', 'Sexual', 'Violence'].map((name) => {
    const s = severity(name)
    return { name, score: s === null ? null : s / 6, flag: 4 / 6, maybe: 2 / 6 }
  }))
}

export const PROVIDERS: Record<string, Provider> = { sightengine, openai, azure }

async function moderate(img: Img, deps: Deps): Promise<{ provider: string; result: Result }> {
  const names = [...new Set((deps.env('MODERATION_PROVIDER') || 'sightengine').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean))]
  const results = await Promise.all(names.map(async (name): Promise<Result> => {
    const run = PROVIDERS[name]
    if (!run) return bad(`unknown provider "${name}"`)
    try {
      return await run(img, deps)
    } catch (e) {
      return bad(`${name}: ${e instanceof Error ? e.name : 'failed'}`) // no message: it could echo a URL or a key
    }
  }))
  return { provider: names.join('+') || 'none', result: combine(results) }
}

function sniff(bytes: Uint8Array): Img['mime'] | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

// ---------------------------------------------------------------------------------------------------------------------
// the request
// ---------------------------------------------------------------------------------------------------------------------
export async function handle(req: Request, deps: Deps): Promise<Response> {
  const headers = {
    'Access-Control-Allow-Origin': deps.env('ALLOWED_ORIGIN') || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return reply(405, { error: 'method' })

  // Who is asking: the signed-in player, from their own token. Never a user id from the request body.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: 'sign_in' })
  const who = await deps.admin.auth.getUser(token)
  const caller = who.data.user?.id
  if (!caller) return reply(401, { error: 'sign_in' })

  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text.length > 1000) return reply(413, { error: 'too_large' })
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return reply(400, { error: 'bad_request' })
  }
  const mode = body.mode === 'report' ? 'report' : 'upload'

  // upload: the caller's own picture.  report: the picture of the player the caller has reported.
  let target = caller
  if (mode === 'report') {
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    if (!/^[A-Za-z0-9_]{3,12}$/.test(username)) return reply(400, { error: 'bad_request' })
    const found = await deps.admin.from('profiles').select('id').eq('username_lower', username.toLowerCase()).maybeSingle()
    const id = isRecord(found.data) && typeof found.data.id === 'string' ? found.data.id : null
    if (!id) return reply(200, { result: 'no_picture' })
    target = id
  }

  const claim = await deps.admin.rpc('moderation_claim', { p_user: target, p_mode: mode, p_reporter: mode === 'report' ? caller : null })
  if (claim.error) return reply(500, { error: 'database' })
  const row = Array.isArray(claim.data) ? (claim.data as unknown[])[0] : null
  const outcome = isRecord(row) && typeof row.outcome === 'string' ? row.outcome : ''
  const version = isRecord(row) ? num(row.picture_version) : null
  if (outcome !== 'check' || version === null) return reply(200, { result: outcome || 'unavailable' })

  const decide = async (provider: string, result: Result) => {
    const done = await deps.admin.rpc('moderation_decide', {
      p_user: target, p_version: version, p_mode: mode, p_provider: provider, p_verdict: result.verdict, p_reasons: result.reasons.join('; ').slice(0, 300),
    })
    if (done.error || typeof done.data !== 'string') return reply(500, { error: 'database' })
    console.log(JSON.stringify({ check: mode, provider, verdict: result.verdict, decision: done.data })) // no picture, no ids, no keys
    return reply(200, { result: done.data })
  }

  const file = await deps.admin.storage.from(BUCKET).download(target)
  if (file.error || !file.data) return decide('storage', bad('the file could not be read'))
  const bytes = new Uint8Array(await file.data.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return decide('storage', bad('the file size is not allowed'))
  const mime = sniff(bytes)
  if (!mime) return decide('storage', { verdict: 'flagged', reasons: ['not a WebP or JPEG image'] })

  const checked = await moderate({ bytes, mime }, deps)
  return decide(checked.provider, checked.result)
}

// Start the server only inside Supabase (Deno). The code above is plain TypeScript so it can be tested.
declare const Deno: { env: { get: (name: string) => string | undefined }; serve: (handler: (req: Request) => Promise<Response>) => void } | undefined
if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  Deno.serve((req) => handle(req, { admin: admin as unknown as Admin, env: (name) => Deno.env.get(name), fetchImpl: fetch }))
}
