import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Loader2, RefreshCw, Share2, WifiOff } from 'lucide-react'
import { friendError, joinRoom, openHost, MAX_RECONNECTS, type FriendError, type FriendLink, type FriendNotice, type HostStatus } from '@/game/peer'
import { useI18n, type MessageKey } from '@/i18n'
import type { Jersey } from '@/game/storage'
import type { StadiumId } from '@/cosmetics/types'
import { buildShareLink } from '@/lib/share'

interface Props {
  role: 'host' | 'guest'
  room: string | null
  jersey: Jersey
  /** The host's stadium is shown to both players. */
  stadium: StadiumId
  onReady: (link: FriendLink, theirs: Jersey, hostStadium: StadiumId | undefined) => void
  onCancel: () => void
}

const formatClock = (ms: number, pad: (v: number) => string): string => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

const ERROR_KEYS = {
  service: ['friend.err.service.title', 'friend.err.service.message', 'friend.err.service.hint'],
  friend: ['friend.err.friend.title', 'friend.err.friend.message', 'friend.err.friend.hint'],
  expiredHost: ['friend.err.expiredHost.title', 'friend.err.expiredHost.message', 'friend.err.expiredHost.hint'],
  expiredGuest: ['friend.err.expiredGuest.title', 'friend.err.expiredGuest.message', 'friend.err.expiredGuest.hint'],
  browser: ['friend.err.browser.title', 'friend.err.browser.message', 'friend.err.browser.hint'],
} as const satisfies Record<string, readonly [MessageKey, MessageKey, MessageKey]>

const NOTICE_KEYS: Record<FriendNotice, MessageKey> = {
  trouble: 'friend.notice.trouble',
  incomplete: 'friend.notice.incomplete',
  dropped: 'friend.notice.dropped',
}

const errorKeys = (e: FriendError) => (e.kind === 'expired' ? ERROR_KEYS[e.role === 'host' ? 'expiredHost' : 'expiredGuest'] : ERROR_KEYS[e.kind])

/** Keep the screen on while waiting, where the browser allows it. Phones sleep otherwise and drop the room. */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let stopped = false
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request('screen')
        if (stopped) void next.release().catch(() => undefined)
        else lock = next
      } catch {
        /* denied or unsupported: the room still works, the screen may just dim */
      }
    }
    void request()
    // The browser releases the lock when the tab is hidden, so ask again when it comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!lock || lock.released)) void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => undefined)
    }
  }, [active])
}

export function FriendLobby({ role, room, jersey, stadium, onReady, onCancel }: Props) {
  const { t, n } = useI18n()
  const [runKey, setRunKey] = useState(0)
  const [roomId, setRoomId] = useState<string | null>(room)
  const [link, setLink] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [hostStatus, setHostStatus] = useState<HostStatus>({ state: 'waiting', attempt: 0, max: MAX_RECONNECTS })
  const [error, setError] = useState<FriendError | null>(null)
  const [notice, setNotice] = useState<FriendNotice | null>(null)
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)
  const [shareNote, setShareNote] = useState<MessageKey | null>(null)
  const jerseyRef = useRef(jersey)
  const stadiumRef = useRef(stadium)
  const readyRef = useRef(onReady)

  useEffect(() => {
    jerseyRef.current = jersey
    stadiumRef.current = stadium
    readyRef.current = onReady
  })

  useEffect(() => {
    let alive = true
    const handshake = (l: FriendLink) => {
      l.setHandlers({
        onMessage: (m) => {
          if (m.t === 'hello' && alive) {
            alive = false
            readyRef.current(l, m.jersey, m.stadium)
          }
        },
        onClose: () => {
          if (!alive) return
          alive = false
          setError(friendError('friend', role))
        },
      })
      l.send({ t: 'hello', jersey: jerseyRef.current, stadium: role === 'host' ? stadiumRef.current : undefined })
    }
    const fail = (e: FriendError) => {
      if (alive) setError(e)
    }

    let cancel: () => void
    if (role === 'host') {
      cancel = openHost({
        onWaiting: (id, until) => {
          if (!alive) return
          setRoomId(id)
          setExpiresAt(until)
        },
        onStatus: (s) => alive && setHostStatus(s),
        onNotice: (message) => alive && setNotice(message),
        onConnected: handshake,
        onError: fail,
      })
    } else if (room) {
      cancel = joinRoom(room, { onConnected: handshake, onError: fail })
    } else {
      cancel = () => undefined
    }
    return () => {
      alive = false
      cancel()
    }
  }, [role, room, runKey])

  useEffect(() => {
    if (role !== 'host' || !roomId) return
    let live = true
    void buildShareLink(`/?room=${roomId}`).then((url) => live && setLink(url))
    return () => {
      live = false
    }
  }, [role, roomId])

  // Countdown for the host's room.
  useEffect(() => {
    if (role !== 'host' || !expiresAt || error) return
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 1000)
    const start = setTimeout(tick, 0)
    return () => {
      clearInterval(timer)
      clearTimeout(start)
    }
  }, [role, expiresAt, error])

  useWakeLock(!error)

  const retry = () => {
    setError(null)
    setNotice(null)
    setCopied(null)
    setLink(null)
    setExpiresAt(null)
    setHostStatus({ state: 'waiting', attempt: 0, max: MAX_RECONNECTS })
    if (role === 'host') setRoomId(null)
    setRunKey((k) => k + 1)
  }

  const copy = async (what: 'link' | 'code') => {
    const text = what === 'link' ? link : roomId
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      setShareNote('friend.copyBlocked')
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const share = async () => {
    if (!link) return
    try {
      await navigator.share({ title: t('friend.shareTitle'), text: t('friend.shareText', { code: roomId?.toUpperCase() ?? '' }), url: link })
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') setShareNote('friend.shareFailed')
    }
  }

  const remaining = expiresAt ? expiresAt - (now || expiresAt - 1000 * 60 * 10) : 0

  if (error) {
    const canRetry = !(role === 'guest' && error.kind === 'expired') && error.kind !== 'browser'
    const [titleKey, messageKey, hintKey] = errorKeys(error)
    return (
      <div className="panel mx-auto max-w-md space-y-4 p-6 text-center" role="alert">
        <AlertTriangle size={30} className="mx-auto" style={{ color: 'var(--bad)' }} aria-hidden />
        <h2 className="display text-2xl font-extrabold text-balance">{t(titleKey)}</h2>
        <p className="text-sm text-pretty">{t(messageKey)}</p>
        <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {t(hintKey)}
        </p>
        {canRetry && (
          <button type="button" className="btn btn-primary" onClick={retry}>
            <RefreshCw size={16} /> {role === 'host' ? t('friend.tryNewRoom') : t('common.tryAgain')}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t('common.backToMenu')}
        </button>
      </div>
    )
  }

  if (role === 'guest') {
    return (
      <div className="panel mx-auto max-w-md space-y-4 p-6 text-center">
        <h2 className="display text-3xl font-extrabold text-balance">{t('friend.joining')}</h2>
        <p className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
          <Loader2 size={15} className="animate-spin" /> {t('friend.connectingFriend')}
        </p>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  const reconnecting = hostStatus.state === 'reconnecting'
  const offline = hostStatus.state === 'offline'

  return (
    <div className="panel mx-auto max-w-md space-y-4 p-6 text-center">
      <h2 className="display text-3xl font-extrabold">{roomId ? t('match.waitingFriend') : t('friend.opening')}</h2>

      {roomId ? (
        <>
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            {t('friend.sendIt')}
          </p>

          <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <span className="block text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
              {t('friend.roomCode')}
            </span>
            <span className="mono block text-3xl font-bold tracking-[0.12em]" aria-label={t('friend.roomCodeAria', { code: roomId })}>
              {roomId.toUpperCase()}
            </span>
          </div>

          <div className={`grid gap-2 ${canShare ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button type="button" onClick={() => void copy('link')} disabled={!link} className="btn btn-primary" style={{ minHeight: 48 }}>
              {copied === 'link' ? <Check size={16} /> : <Copy size={16} />}
              {copied === 'link' ? t('common.copied') : t('friend.copyLink')}
            </button>
            <button type="button" onClick={() => void copy('code')} className="btn btn-ghost" style={{ minHeight: 48 }}>
              {copied === 'code' ? <Check size={16} /> : <Copy size={16} />}
              {copied === 'code' ? t('common.copied') : t('friend.copyCode')}
            </button>
            {canShare && (
              <button type="button" onClick={() => void share()} disabled={!link} className="btn btn-ghost" style={{ minHeight: 48 }}>
                <Share2 size={16} /> {t('common.share')}
              </button>
            )}
          </div>

          <p className="mono text-sm" style={{ color: 'var(--yellow)' }} aria-live="off">
            {t('friend.openFor', { time: formatClock(remaining, (v) => n(v, { minimumIntegerDigits: 2 })) })}
          </p>
        </>
      ) : (
        <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {t('friend.connectingService')}
        </p>
      )}

      <p className="flex items-center justify-center gap-2 text-sm" style={{ color: reconnecting || offline ? 'var(--yellow)' : 'var(--muted)' }} role="status">
        {offline ? (
          <>
            <WifiOff size={15} /> {t('friend.offline')}
          </>
        ) : reconnecting ? (
          <>
            <Loader2 size={15} className="animate-spin" /> {t('friend.reconnecting', { n: n(Math.min(hostStatus.attempt, hostStatus.max)), max: n(hostStatus.max) })}
          </>
        ) : (
          <>
            <Loader2 size={15} className="animate-spin" /> {roomId ? t('friend.waitingShort') : t('friend.connecting')}
          </>
        )}
      </p>

      {notice && (
        <p className="text-xs text-pretty" style={{ color: 'var(--yellow)' }} role="status">
          {t(NOTICE_KEYS[notice])}
        </p>
      )}
      {shareNote && (
        <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }} role="status">
          {t(shareNote)}
        </p>
      )}

      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  )
}
