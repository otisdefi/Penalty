import { useEffect, useSyncExternalStore } from 'react'
import type { MessageKey } from '../i18n/types'
import { getSupabase } from './client'
import { CHAT_CONFIGURED } from './config'
import { generateRecoveryCode, hashRecoveryCode, identityEmail } from './rules'

/* ---------- who is signed in ---------- */

export interface AccountUser {
  id: string
  /** The public name. Read from the profile table, never from editable metadata. */
  username: string
}

export interface AuthState {
  status: 'off' | 'loading' | 'out' | 'in'
  user: AccountUser | null
}

let state: AuthState = { status: CHAT_CONFIGURED ? 'loading' : 'off', user: null }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
const setState = (next: AuthState) => {
  state = next
  emit()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let started = false

async function applySession(session: { user: { id: string } } | null): Promise<void> {
  if (!session) {
    setState({ status: 'out', user: null })
    return
  }
  try {
    const sb = await getSupabase()
    const { data, error } = await sb.from('profiles').select('username').eq('id', session.user.id).maybeSingle()
    if (error || !data || typeof data.username !== 'string') {
      // The account was deleted or has no profile: treat as signed out.
      await sb.auth.signOut({ scope: 'local' })
      setState({ status: 'out', user: null })
      return
    }
    setState({ status: 'in', user: { id: session.user.id, username: data.username } })
  } catch {
    setState({ status: 'out', user: null })
  }
}

/** Restore a saved session and follow sign-ins and sign-outs. Safe to call many times. */
export function startAuth(): void {
  if (started || !CHAT_CONFIGURED) return
  started = true
  void (async () => {
    try {
      const sb = await getSupabase()
      const { data } = await sb.auth.getSession()
      await applySession(data.session)
      // Do not call Supabase inside this callback directly; hand the work to the next tick.
      sb.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') return
        setTimeout(() => void applySession(session), 0)
      })
    } catch {
      setState({ status: 'out', user: null })
    }
  })()
}

export function useAuth(): AuthState {
  useEffect(startAuth, [])
  return useSyncExternalStore(subscribe, () => state)
}

/** The signed-in username, or null. Used as the public player name everywhere. */
export function useAccountName(): string | null {
  return useSyncExternalStore(subscribe, () => state.user?.username ?? null)
}

/* ---------- the sign-in dialog (one instance for the whole app) ---------- */

export type DialogView = 'signin' | 'signup' | 'reset' | 'account'
interface DialogState {
  open: boolean
  view: DialogView
}
let dialog: DialogState = { open: false, view: 'signin' }
const dialogListeners = new Set<() => void>()
const setDialog = (next: DialogState) => {
  dialog = next
  dialogListeners.forEach((fn) => fn())
}
export const openAuthDialog = (view?: DialogView) => setDialog({ open: true, view: view ?? (state.status === 'in' ? 'account' : 'signin') })
export const closeAuthDialog = () => setDialog({ ...dialog, open: false })
export const setAuthView = (view: DialogView) => setDialog({ open: true, view })
export const useAuthDialog = (): DialogState =>
  useSyncExternalStore(
    (fn) => {
      dialogListeners.add(fn)
      return () => dialogListeners.delete(fn)
    },
    () => dialog,
  )

/* ---------- actions ---------- */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: MessageKey }

interface SupabaseErrorLike {
  message?: string
  code?: string
  status?: number
}

/** Turn a Supabase Auth error into a short message the player can act on. */
export function authErrorKey(err: unknown): MessageKey {
  const e = (err ?? {}) as SupabaseErrorLike
  const text = `${e.code ?? ''} ${e.message ?? ''}`.toLowerCase()
  if (text.includes('user_already_exists') || text.includes('already registered')) return 'auth.err.taken'
  if (text.includes('database error saving new user')) return 'auth.err.createFailed'
  if (text.includes('weak_password') || text.includes('password should')) return 'auth.err.weak'
  if (text.includes('captcha')) return 'auth.err.captcha'
  if (text.includes('rate') || e.status === 429) return 'auth.err.rateLimit'
  if (text.includes('invalid_credentials') || text.includes('invalid login')) return 'auth.err.credentials'
  if (text.includes('banned')) return 'auth.err.banned'
  if (text.includes('signup_disabled') || text.includes('signups not allowed')) return 'auth.err.disabled'
  if (text.includes('email_address_invalid') || text.includes('invalid email') || text.includes('is invalid')) return 'auth.err.identity'
  if (text.includes('fetch') || text.includes('network')) return 'auth.err.network'
  return 'auth.err.generic'
}

/** Create an account. Returns the recovery code, which the caller shows exactly once. */
export async function signUp(username: string, password: string, captchaToken?: string): Promise<Result<{ recoveryCode: string }>> {
  try {
    const sb = await getSupabase()
    const { data, error } = await sb.auth.signUp({
      email: identityEmail(username),
      password,
      options: { data: { username }, captchaToken },
    })
    if (error) return { ok: false, error: authErrorKey(error) }
    // No session means the project still asks for email confirmation, which this app never uses.
    if (!data.session) return { ok: false, error: 'auth.err.confirmOn' }
    const code = generateRecoveryCode()
    const { error: rpcError } = await sb.rpc('set_recovery_hash', { p_hash: await hashRecoveryCode(code) })
    if (rpcError) return { ok: false, error: 'auth.err.recoverySave' }
    // The sign-in listener updates the state a moment later, after the recovery code has been shown.
    return { ok: true, recoveryCode: code }
  } catch (e) {
    return { ok: false, error: authErrorKey(e) }
  }
}

export async function signIn(username: string, password: string, captchaToken?: string): Promise<Result> {
  try {
    const sb = await getSupabase()
    const { data, error } = await sb.auth.signInWithPassword({ email: identityEmail(username), password, options: { captchaToken } })
    if (error) return { ok: false, error: authErrorKey(error) }
    await applySession(data.session)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: authErrorKey(e) }
  }
}

export async function signOut(): Promise<void> {
  try {
    const sb = await getSupabase()
    await sb.auth.signOut({ scope: 'local' })
  } catch {
    /* already signed out */
  }
  setState({ status: 'out', user: null })
}

/** Checks the current password first, then sets the new one. */
export async function changePassword(current: string, next: string, captchaToken?: string): Promise<Result> {
  const user = state.user
  if (!user) return { ok: false, error: 'auth.err.generic' }
  try {
    const sb = await getSupabase()
    const check = await sb.auth.signInWithPassword({ email: identityEmail(user.username), password: current, options: { captchaToken } })
    if (check.error) return { ok: false, error: authErrorKey(check.error) }
    const { error } = await sb.auth.updateUser({ password: next })
    if (error) return { ok: false, error: authErrorKey(error) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: authErrorKey(e) }
  }
}

/** A fresh recovery code replaces the old one. Shown once by the caller. */
export async function newRecoveryCode(): Promise<Result<{ recoveryCode: string }>> {
  try {
    const sb = await getSupabase()
    const code = generateRecoveryCode()
    const { error } = await sb.rpc('set_recovery_hash', { p_hash: await hashRecoveryCode(code) })
    if (error) return { ok: false, error: 'auth.err.recoverySave' }
    return { ok: true, recoveryCode: code }
  } catch (e) {
    return { ok: false, error: authErrorKey(e) }
  }
}

/** Reset a forgotten password with the recovery code, through the server-side Edge Function. */
export async function resetPassword(username: string, code: string, newPassword: string, captchaToken?: string): Promise<Result<{ recoveryCode: string }>> {
  try {
    const sb = await getSupabase()
    const { data, error } = (await sb.functions.invoke('reset-password', { body: { username, code, newPassword, captchaToken } })) as { data: unknown; error: unknown }
    if (error) {
      let reason = ''
      try {
        reason = String(((await (error as { context?: Response }).context?.json()) as { error?: string } | undefined)?.error ?? '')
      } catch {
        /* no body */
      }
      if (reason === 'locked') return { ok: false, error: 'auth.err.resetLocked' }
      if (reason === 'weak') return { ok: false, error: 'auth.err.weak' }
      if (reason === 'captcha') return { ok: false, error: 'auth.err.captcha' }
      if (reason === 'invalid') return { ok: false, error: 'auth.err.resetInvalid' }
      return { ok: false, error: reason ? 'auth.err.generic' : 'auth.err.network' }
    }
    const next = (data as { recoveryCode?: unknown } | null)?.recoveryCode
    if (typeof next !== 'string') return { ok: false, error: 'auth.err.generic' }
    return { ok: true, recoveryCode: next }
  } catch (e) {
    return { ok: false, error: authErrorKey(e) }
  }
}

export async function deleteAccount(): Promise<Result> {
  try {
    const sb = await getSupabase()
    const { error } = await sb.rpc('delete_my_account')
    if (error) return { ok: false, error: 'auth.err.generic' }
    await signOut()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: authErrorKey(e) }
  }
}

export async function usernameAvailable(name: string): Promise<boolean | null> {
  try {
    const sb = await getSupabase()
    const { data, error } = (await sb.rpc('username_available', { p_name: name })) as { data: unknown; error: unknown }
    return error ? null : data === true
  } catch {
    return null
  }
}
