import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { MessageKey } from '../i18n/types'
import { useAuth } from './account'
import { getSupabase } from './client'
import { CHAT_CONFIGURED, HISTORY_LIMIT, MESSAGE_MAX, SEND_COOLDOWN_MS } from './config'
import { cleanMessage, messageProblem, type MessageProblem } from './rules'

export interface ChatMessage {
  id: number
  userId: string
  username: string
  body: string
  at: number
}

/** Accept only well-formed rows. Everything is later drawn as plain text. */
function parseRow(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'number' || typeof r.user_id !== 'string' || typeof r.username !== 'string' || typeof r.body !== 'string' || typeof r.created_at !== 'string') return null
  if (r.body.length > MESSAGE_MAX || r.username.length > 12) return null
  const at = Date.parse(r.created_at)
  if (!Number.isFinite(at)) return null
  return { id: r.id, userId: r.user_id, username: r.username, body: r.body, at }
}

const PROBLEM_KEYS: Record<MessageProblem, MessageKey> = {
  empty: 'chat.err.empty',
  too_long: 'chat.err.tooLong',
  bad_chars: 'chat.err.badChars',
  link: 'chat.err.link',
  email: 'chat.err.email',
  phone: 'chat.err.phone',
  blocked_word: 'chat.err.word',
}

/** Map a database rule name (the error message) to a text the player understands. */
function serverErrorKey(message: string): MessageKey {
  const rule = message.replace(/^chat_/, '')
  switch (rule) {
    case 'rate_2s':
      return 'chat.err.rate2s'
    case 'rate_minute':
      return 'chat.err.rateMinute'
    case 'banned':
      return 'chat.err.banned'
    case 'blocked_word':
      return 'chat.err.word'
    case 'link':
    case 'email':
    case 'phone':
    case 'empty':
    case 'too_long':
    case 'bad_chars':
      return PROBLEM_KEYS[rule]
    default:
      return 'chat.err.generic'
  }
}

const merge = (a: ChatMessage[], b: ChatMessage[]): ChatMessage[] => {
  const byId = new Map<number, ChatMessage>()
  for (const m of [...a, ...b]) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => x.id - y.id).slice(-200)
}

export function useChat(channel: string) {
  const auth = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(CHAT_CONFIGURED ? 'loading' : 'error')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [reported, setReported] = useState<number[]>([])
  const nextAllowed = useRef(0)

  useEffect(() => {
    if (!CHAT_CONFIGURED) return
    let cancelled = false
    let live: RealtimeChannel | null = null
    void (async () => {
      try {
        const sb = await getSupabase()
        if (cancelled) return
        // Subscribe first so nothing is missed between loading the history and going live.
        live = sb
          .channel(`chat:${channel}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel=eq.${channel}` }, (payload) => {
            const row = parseRow(payload.new)
            if (row) setMessages((prev) => merge(prev, [row]))
          })
          .subscribe()
        const { data, error: loadError } = await sb
          .from('messages')
          .select('id,user_id,username,body,created_at')
          .eq('channel', channel)
          .order('id', { ascending: false })
          .limit(HISTORY_LIMIT)
        if (cancelled) return
        if (loadError) {
          setStatus('error')
          return
        }
        const rows = (data ?? []).map(parseRow).filter((m): m is ChatMessage => m !== null)
        setMessages((prev) => merge(rows, prev))
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      if (live) void getSupabase().then((sb) => sb.removeChannel(live as RealtimeChannel))
    }
  }, [channel])

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      setError(null)
      if (auth.status !== 'in' || !auth.user) return false
      const wait = nextAllowed.current - Date.now()
      if (wait > 0) {
        setError('chat.err.rate2s')
        return false
      }
      const problem = messageProblem(text)
      if (problem) {
        setError(PROBLEM_KEYS[problem])
        return false
      }
      setSending(true)
      try {
        const sb = await getSupabase()
        const { data, error: insertError } = await sb
          .from('messages')
          .insert({ channel, body: cleanMessage(text), user_id: auth.user.id })
          .select('id,user_id,username,body,created_at')
          .single()
        if (insertError) {
          setError(serverErrorKey(insertError.message ?? ''))
          return false
        }
        nextAllowed.current = Date.now() + SEND_COOLDOWN_MS
        const row = parseRow(data)
        if (row) setMessages((prev) => merge(prev, [row]))
        return true
      } catch {
        setError('chat.err.network')
        return false
      } finally {
        setSending(false)
      }
    },
    [auth.status, auth.user, channel],
  )

  const report = useCallback(
    async (messageId: number): Promise<boolean> => {
      if (auth.status !== 'in' || !auth.user) return false
      try {
        const sb = await getSupabase()
        const { error: reportError } = await sb.from('reports').insert({ message_id: messageId, reporter_id: auth.user.id, reason: null })
        // A second report of the same message is fine: it is already on file.
        if (reportError && !/duplicate key/i.test(reportError.message ?? '')) return false
        setReported((prev) => [...prev, messageId])
        return true
      } catch {
        return false
      }
    },
    [auth.status, auth.user],
  )

  return { messages, status, sending, error, reported, send, report, clearError: () => setError(null) }
}
