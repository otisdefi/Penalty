import type { SupabaseClient } from '@supabase/supabase-js'
import { CHAT_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

let clientPromise: Promise<SupabaseClient> | null = null

/**
 * The Supabase client is loaded on demand, so players who never open chat or sign in do not download it.
 * It only ever uses the public anon key; what a player may do is decided by Row Level Security.
 */
export function getSupabase(): Promise<SupabaseClient> {
  if (!CHAT_CONFIGURED) return Promise.reject(new Error('chat_not_configured'))
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'tiebreaker-auth' },
      realtime: { params: { eventsPerSecond: 5 } },
    }),
  )
  return clientPromise
}
