import { Avatar } from '../avatar/Avatar'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Flag, MessageCircle, MoreHorizontal, Send, VolumeX } from 'lucide-react'
import { useI18n } from '@/i18n'
import { openAuthDialog, useAuth } from './account'
import { CHAT_CONFIGURED, MESSAGE_MAX } from './config'
import { unmuteAll, useMuted } from './mute'
import { blockPlayer, useBlocks } from '../social/blocks'
import { openProfileCard } from '../social/profileCard'
import { useChat, type ChatMessage } from './useChat'

interface Props {
  /** "lobby", "room:<code>" or "match:<id>". */
  channel: string
  title: string
  /** Height of the message list in pixels. */
  height?: number
}

function Row({ m, mine, reported, canAct, onReport, onMute, onOpen }: { m: ChatMessage; mine: boolean; reported: boolean; canAct: boolean; onReport: () => void; onMute: () => void; onOpen: () => void }) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const time = useMemo(() => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(m.at), [lang, m.at])
  return (
    <li className="group rounded-xl px-2 py-1.5" style={{ background: mine ? 'rgba(198,255,61,0.08)' : 'transparent' }}>
      <div className="flex items-center gap-2">
        <Avatar username={m.username} size={22} />
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('social.card.open', { name: m.username })}
          className="max-w-[60%] truncate text-left text-[12px] font-bold underline-offset-2 hover:underline"
          style={{ color: mine ? 'var(--lime)' : 'var(--ink)' }}
        >
          {m.username}
        </button>
        <time className="text-[10px] tabular-nums" style={{ color: 'var(--subtle)' }} dateTime={new Date(m.at).toISOString()}>
          {time}
        </time>
        {!mine && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={t('chat.more')}
            aria-expanded={open}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full"
            style={{ color: 'var(--subtle)' }}
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>
      {/* Plain text only: React escapes everything, so a message can never run as HTML. */}
      <p className="text-[13px] leading-snug" style={{ overflowWrap: 'anywhere' }}>
        {m.body}
      </p>
      {open && !mine && (
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={reported}
            onClick={onReport}
            className="flex min-h-[32px] items-center gap-1 rounded-full px-3 text-[11px] font-bold"
            style={{ background: 'rgba(255,255,255,0.08)', opacity: reported ? 0.6 : 1 }}
          >
            <Flag size={12} /> {reported ? t('chat.reported') : t('chat.report')}
          </button>
          <button type="button" onClick={onMute} className="flex min-h-[32px] items-center gap-1 rounded-full px-3 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <VolumeX size={12} /> {t('chat.mute', { name: m.username })}
          </button>
          {!canAct && (
            <span className="self-center text-[10px]" style={{ color: 'var(--subtle)' }}>
              {t('chat.signInToReport')}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

/** Chat for the lobby, a friend room or an online match. Anyone can read; only signed-in players can write. */
export function ChatPanel({ channel, title, height = 240 }: Props) {
  const { t, n } = useI18n()
  const auth = useAuth()
  const chat = useChat(channel)
  const muted = useMuted()
  const blocked = useBlocks()
  const [text, setText] = useState('')
  const list = useRef<HTMLUListElement>(null)
  const stick = useRef(true)

  const visible = useMemo(() => chat.messages.filter((m) => !muted.includes(m.userId) && !blocked.some((b) => b.id === m.userId)), [chat.messages, muted, blocked])

  // Keep the newest message in view, unless the player scrolled up to read older ones.
  useEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible.length])

  if (!CHAT_CONFIGURED) {
    return (
      <section className="panel space-y-2 p-4" aria-label={title}>
        <h2 className="display flex items-center gap-2 text-xl font-extrabold">
          <MessageCircle size={17} style={{ color: 'var(--lime)' }} /> {title}
        </h2>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {t('chat.notConfigured')}
        </p>
      </section>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (chat.sending || !text.trim()) return
    if (await chat.send(text)) {
      setText('')
      stick.current = true
    }
  }

  const signedIn = auth.status === 'in'

  return (
    <section className="panel space-y-2 p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="display flex min-w-0 items-center gap-2 text-xl font-extrabold">
          <MessageCircle size={17} style={{ color: 'var(--lime)' }} className="shrink-0" /> <span className="truncate">{title}</span>
        </h2>
        {muted.length > 0 && (
          <button type="button" onClick={unmuteAll} className="shrink-0 text-[11px] font-bold underline" style={{ color: 'var(--muted)' }}>
            {t('chat.unmuteAll', { count: n(muted.length) })}
          </button>
        )}
      </div>
      <p className="text-[11px] font-semibold" style={{ color: 'var(--yellow)' }}>
        {t('chat.rule')}
      </p>

      <ul
        ref={list}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        className="space-y-0.5 overflow-y-auto rounded-2xl p-1"
        style={{ height, background: 'rgba(0,0,0,0.22)' }}
      >
        {chat.status === 'loading' && (
          <li className="p-3 text-center text-xs" style={{ color: 'var(--muted)' }}>
            {t('chat.loading')}
          </li>
        )}
        {chat.status === 'error' && (
          <li className="p-3 text-center text-xs" style={{ color: 'var(--bad)' }}>
            {t('chat.loadError')}
          </li>
        )}
        {chat.status === 'ready' && visible.length === 0 && (
          <li className="p-3 text-center text-xs" style={{ color: 'var(--muted)' }}>
            {t('chat.empty')}
          </li>
        )}
        {visible.map((m) => (
          <Row
            key={m.id}
            m={m}
            mine={auth.user?.id === m.userId}
            reported={chat.reported.includes(m.id)}
            canAct={signedIn}
            onReport={() => (signedIn ? void chat.report(m.id) : openAuthDialog('signin'))}
            onMute={() => void blockPlayer(m.username, m.userId, 'mute')}
            onOpen={() => openProfileCard(m.username, m.userId)}
          />
        ))}
      </ul>

      {signedIn ? (
        <form onSubmit={(e) => void submit(e)} className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => {
                setText(e.target.value.slice(0, MESSAGE_MAX))
                if (chat.error) chat.clearError()
              }}
              maxLength={MESSAGE_MAX}
              placeholder={t('chat.placeholder')}
              aria-label={t('chat.placeholder')}
              autoComplete="off"
              enterKeyHint="send"
              className="h-11 min-w-0 flex-1 rounded-xl border bg-transparent px-3 text-sm"
              style={{ borderColor: chat.error ? 'var(--bad)' : 'var(--line)' }}
            />
            <button type="submit" disabled={chat.sending || !text.trim()} aria-label={t('chat.send')} className="btn btn-primary" style={{ width: 44, minHeight: 44, padding: 0 }}>
              <Send size={16} />
            </button>
          </div>
          <div className="flex justify-between gap-2 text-[11px]">
            <span style={{ color: 'var(--bad)' }} role="alert">
              {chat.error ? t(chat.error) : ''}
            </span>
            <span className="tabular-nums" style={{ color: 'var(--subtle)' }}>
              {n(text.length)}/{n(MESSAGE_MAX)}
            </span>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => openAuthDialog('signin')} disabled={auth.status === 'loading'}>
          {t('chat.signInToChat')}
        </button>
      )}
    </section>
  )
}
