// Supabase Edge Function: delete profile pictures that were rejected, removed, or whose account was deleted.
//
// Why a function: Supabase does not allow deleting storage files with SQL, only through the Storage API,
// and only the service role may delete another player's file. The service-role key lives only on Supabase's
// servers (injected as SUPABASE_SERVICE_ROLE_KEY); it is never in the app or in this file.
//
// Safe to call at any time and as often as you like: it only deletes files that the database has already
// queued for deletion (public.avatar_purge_queue), and never a file whose owner has a live picture.
//
// Deploy: Supabase dashboard > Edge Functions > Deploy a new function > Via Editor > name it "purge-avatars" >
// paste this file > Deploy. Keep "Verify JWT" on. No secrets to set. (Or: supabase functions deploy purge-avatars)

const BUCKET = 'avatars'
const BATCH_LIMIT = 5 // up to 5 batches of 50 files per call
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

interface Rpc {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  storage: { from: (bucket: string) => { remove: (paths: string[]) => PromiseLike<{ error: { message: string } | null }> } }
}

export interface Deps {
  admin: Rpc
  env: (name: string) => string | undefined
}

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

  let purged = 0
  for (let round = 0; round < BATCH_LIMIT; round++) {
    const taken = await deps.admin.rpc('take_avatar_purge_batch')
    if (taken.error) return reply(500, { error: 'database', purged })
    const paths = (Array.isArray(taken.data) ? (taken.data as unknown[]) : []).filter((p): p is string => typeof p === 'string' && UUID.test(p))
    if (paths.length === 0) return reply(200, { purged, more: false })

    // A file that is already gone is not an error: remove() simply skips it.
    const removed = await deps.admin.storage.from(BUCKET).remove(paths)
    if (removed.error) return reply(502, { error: 'storage', purged }) // keep them queued and try again later
    const done = await deps.admin.rpc('done_avatar_purge', { p_paths: paths })
    if (done.error) return reply(500, { error: 'database', purged })
    purged += paths.length
  }
  return reply(200, { purged, more: true }) // call again to continue
}

// Start the server only inside Supabase (Deno). The function above is plain TypeScript so it can be tested.
declare const Deno: { env: { get: (name: string) => string | undefined }; serve: (handler: (req: Request) => Promise<Response>) => void } | undefined
if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  Deno.serve((req) => handle(req, { admin: admin as unknown as Rpc, env: (name) => Deno.env.get(name) }))
}
