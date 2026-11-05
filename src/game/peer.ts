import type { DataConnection, Peer } from 'peerjs'
import type { Dir } from './logic'
import { isStadium, parseJersey } from '../cosmetics/validate'
import type { StadiumId } from '../cosmetics/types'
import { peerOptions } from './ice'
import type { Jersey } from './storage'

export type Msg =
  | { t: 'hello'; jersey: Jersey; stadium?: StadiumId }
  | { t: 'commit'; r: number; h: string }
  | { t: 'reveal'; r: number; d: Dir; n: string }
  | { t: 'again' }
  | { t: 'ping' }
  | { t: 'pong' }

export interface FriendLink {
  role: 'host' | 'guest'
  send: (m: Msg) => void
  setHandlers: (h: { onMessage?: (m: Msg) => void; onClose?: () => void }) => void
  close: () => void
}

export function parseMsg(raw: unknown): Msg | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  switch (m.t) {
    case 'hello': {
      const jersey = parseJersey(m.jersey)
      if (!jersey) return null
      return { t: 'hello', jersey, stadium: isStadium(m.stadium) ? m.stadium : undefined }
    }
    case 'commit':
      return Number.isInteger(m.r) && typeof m.h === 'string' && /^[0-9a-f]{64}$/.test(m.h) ? { t: 'commit', r: m.r as number, h: m.h } : null
    case 'reveal':
      return Number.isInteger(m.r) && (m.d === 0 || m.d === 1 || m.d === 2) && typeof m.n === 'string' && /^[0-9a-f]{32}$/.test(m.n)
        ? { t: 'reveal', r: m.r as number, d: m.d, n: m.n }
        : null
    case 'again':
      return { t: 'again' }
    case 'ping':
      return { t: 'ping' }
    case 'pong':
      return { t: 'pong' }
    default:
      return null
  }
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
function roomId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return 'tb' + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export const isRoomId = (v: string | null): v is string => !!v && /^tb[a-z0-9]{8}$/.test(v)

/** Pull a room code out of a pasted code or invite link. */
export function extractRoomId(text: string): string | null {
  const match = /tb[a-z0-9]{8}/i.exec(text.trim())
  const id = match?.[0].toLowerCase() ?? null
  return isRoomId(id) ? id : null
}

/* ---------- errors people can act on ---------- */

export type FriendErrorKind = 'service' | 'friend' | 'expired' | 'browser'

export interface FriendError {
  kind: FriendErrorKind
  title: string
  message: string
  hint: string
}

export const ROOM_TTL_MS = 10 * 60 * 1000
export const MAX_RECONNECTS = 8
/** Seconds to wait before reconnect attempt 1, 2, 3... (about 1s, 2s, 4s, then 8s). */
const BACKOFF_S = [1, 2, 4, 8, 8, 8, 8, 8]

export function friendError(kind: FriendErrorKind, role: 'host' | 'guest'): FriendError {
  switch (kind) {
    case 'service':
      return {
        kind,
        title: 'Matchmaking service unreachable',
        message: "We couldn't reach the service that connects players, even after several tries.",
        hint: 'Check your internet connection and try again. If it keeps happening, the service may be down: wait a minute and retry.',
      }
    case 'friend':
      return {
        kind,
        title: "Couldn't connect to your friend",
        message: 'The room is open, but the direct connection between you two did not complete.',
        hint: 'Ask your friend to reopen the link and keep their tab open. Switching one of you between Wi-Fi and mobile data often fixes it.',
      }
    case 'expired':
      return role === 'host'
        ? {
            kind,
            title: 'Room expired',
            message: 'Nobody joined within 10 minutes, so the room was closed.',
            hint: 'Create a new room and send your friend the new link.',
          }
        : {
            kind,
            title: 'Room not found',
            message: 'This room has expired or was closed by the host.',
            hint: 'Ask your friend to create a new room and send you a fresh link.',
          }
    case 'browser':
      return {
        kind,
        title: 'Browser not supported',
        message: "This browser can't make peer-to-peer connections.",
        hint: 'Open the game in a recent version of Chrome, Safari or Firefox.',
      }
  }
}

const errType = (err: unknown): string => (err as { type?: string } | null)?.type ?? ''

/* ---------- link between two players ---------- */

const PING_MS = 10_000
const DEAD_MS = 45_000

function wrap(peer: Peer, conn: DataConnection, role: FriendLink['role']): FriendLink {
  let onMessage: ((m: Msg) => void) | undefined
  let onClose: (() => void) | undefined
  let closed = false
  const queue: Msg[] = []
  let closeQueued = false
  let lastSeen = Date.now()

  const handleClose = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    document.removeEventListener('visibilitychange', onVisible)
    if (onClose) onClose()
    else closeQueued = true
  }

  // Heartbeat: keeps the data channel active while idle and notices a friend who silently vanished.
  const heartbeat = setInterval(() => {
    if (closed) return
    if (document.visibilityState === 'visible' && Date.now() - lastSeen > DEAD_MS) {
      handleClose()
      return
    }
    if (conn.open) void conn.send({ t: 'ping' })
  }, PING_MS)
  // Timers pause in background tabs, so do not count that time as silence.
  const onVisible = () => {
    if (document.visibilityState === 'visible') lastSeen = Date.now()
  }
  document.addEventListener('visibilitychange', onVisible)

  conn.on('data', (raw) => {
    lastSeen = Date.now()
    const msg = parseMsg(raw)
    if (!msg) return
    if (msg.t === 'ping') {
      if (conn.open) void conn.send({ t: 'pong' })
      return
    }
    if (msg.t === 'pong') return
    if (onMessage) onMessage(msg)
    else queue.push(msg)
  })
  conn.on('close', handleClose)
  conn.on('error', handleClose)

  return {
    role,
    send: (m) => {
      if (!closed && conn.open) void conn.send(m)
    },
    setHandlers: (h) => {
      onMessage = h.onMessage
      onClose = h.onClose
      if (onMessage) while (queue.length) onMessage(queue.shift() as Msg)
      if (onClose && closeQueued) onClose()
    },
    close: () => {
      closed = true
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisible)
      onMessage = undefined
      onClose = undefined
      conn.close()
      peer.destroy()
    },
  }
}

async function createPeer(id?: string): Promise<Peer> {
  const { Peer: PeerCtor } = await import('peerjs')
  return id ? new PeerCtor(id, peerOptions()) : new PeerCtor(peerOptions())
}

/* ---------- host: open a room and wait ---------- */

export interface HostStatus {
  state: 'waiting' | 'reconnecting' | 'offline'
  /** Reconnect attempt in progress (1 to max). 0 while connected. */
  attempt: number
  max: number
}

interface HostCallbacks {
  /** The room is open. Fires once; the room code never changes afterwards, even across reconnects. */
  onWaiting: (id: string, expiresAt: number) => void
  onStatus: (s: HostStatus) => void
  /** A non-fatal problem worth telling the host about, or null to clear it. */
  onNotice: (message: string | null) => void
  onConnected: (link: FriendLink) => void
  onError: (e: FriendError) => void
}

/** Open a room and wait for one friend. Returns a cancel function. */
export function openHost(cb: HostCallbacks): () => void {
  let cancelled = false
  let finished = false
  let connected = false
  let pendingConn = false
  let peer: Peer | null = null
  let id: string | null = null
  let opened = false
  let attempt = 0
  let idTries = 0
  let expiresAt = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let guardTimer: ReturnType<typeof setTimeout> | undefined
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let hiddenAt = 0

  const status = (state: HostStatus['state']) => cb.onStatus({ state, attempt: state === 'waiting' ? 0 : attempt, max: MAX_RECONNECTS })

  const clearTimers = () => {
    clearTimeout(retryTimer)
    clearTimeout(guardTimer)
    retryTimer = undefined
    guardTimer = undefined
  }

  const removeListeners = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }

  const stop = (destroyPeer: boolean) => {
    clearTimers()
    clearTimeout(expiryTimer)
    removeListeners()
    if (destroyPeer) peer?.destroy()
  }

  const fail = (e: FriendError) => {
    if (finished) return
    finished = true
    stop(true)
    cb.onError(e)
  }

  const expire = () => fail(friendError('expired', 'host'))

  const scheduleReconnect = (immediate = false) => {
    if (finished || connected) return
    if (retryTimer && !immediate) return
    clearTimeout(retryTimer)
    retryTimer = undefined
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      status('offline')
      return
    }
    if (attempt >= MAX_RECONNECTS) {
      fail(friendError('service', 'host'))
      return
    }
    const delay = immediate ? 0 : (BACKOFF_S[attempt] ?? 8) * 1000
    attempt += 1
    status('reconnecting')
    retryTimer = setTimeout(doReconnect, delay)
  }

  const doReconnect = () => {
    retryTimer = undefined
    if (finished || connected) return
    // If the attempt hangs without opening, try again with the next backoff step.
    clearTimeout(guardTimer)
    guardTimer = setTimeout(() => scheduleReconnect(), 10_000)
    try {
      if (peer && !peer.destroyed && peer.disconnected) {
        peer.reconnect()
        return
      }
      if (peer && !peer.destroyed && !peer.disconnected && !peer.open) return // still making the first connection
      if (peer && !peer.destroyed && peer.open) {
        clearTimeout(guardTimer)
        status('waiting')
        return
      }
    } catch {
      // fall through and rebuild the peer under the same room code
    }
    void build(id ?? roomId())
  }

  const onDisconnected = (p: Peer) => {
    if (p !== peer || finished || connected) return
    scheduleReconnect()
  }

  const handleError = (p: Peer, err: unknown) => {
    if (p !== peer || finished) return
    const type = errType(err)
    switch (type) {
      case 'browser-incompatible':
        fail(friendError('browser', 'host'))
        return
      case 'unavailable-id':
        if (!opened && idTries < 3) {
          idTries += 1
          id = null
        }
        scheduleReconnect()
        return
      case 'webrtc':
        if (!connected) cb.onNotice("Your friend's connection hit a problem. They can reopen the link to try again.")
        return
      case 'peer-unavailable':
        return
      default:
        // network, server-error, socket-error, socket-closed and anything unexpected: treat as a dropped
        // signaling connection and recover quietly instead of showing an error.
        scheduleReconnect()
    }
  }

  const build = async (useId: string) => {
    if (finished || cancelled) return
    try {
      const p = await createPeer(useId)
      if (finished || cancelled) {
        p.destroy()
        return
      }
      if (peer && peer !== p && !peer.destroyed) peer.destroy()
      peer = p
      p.on('open', (openId) => {
        if (p !== peer || finished) return
        clearTimers()
        opened = true
        id = openId
        attempt = 0
        if (!expiresAt) {
          expiresAt = Date.now() + ROOM_TTL_MS
          expiryTimer = setTimeout(expire, ROOM_TTL_MS)
          cb.onWaiting(openId, expiresAt)
        }
        status('waiting')
      })
      p.on('disconnected', () => onDisconnected(p))
      p.on('close', () => {
        if (p !== peer || finished || connected) return
        scheduleReconnect()
      })
      p.on('error', (err) => handleError(p, err))
      p.on('connection', (conn) => {
        if (connected || pendingConn || finished) {
          conn.on('open', () => conn.close())
          return
        }
        pendingConn = true
        const giveUp = setTimeout(() => {
          if (connected) return
          pendingConn = false
          conn.close()
          cb.onNotice("Your friend's connection did not complete. Ask them to reopen the link.")
        }, 20_000)
        const dropped = () => {
          if (connected) return
          clearTimeout(giveUp)
          pendingConn = false
          cb.onNotice("Your friend's connection dropped before the match started. They can reopen the link.")
        }
        conn.on('error', dropped)
        conn.on('close', dropped)
        conn.on('open', () => {
          clearTimeout(giveUp)
          if (connected || finished) {
            conn.close()
            return
          }
          connected = true
          pendingConn = false
          // The matchmaking service is no longer needed once the two players are linked.
          stop(false)
          cb.onNotice(null)
          cb.onConnected(wrap(p, conn, 'host'))
        })
      })
    } catch {
      // For example a failed script download on a flaky network: retry with the same backoff.
      scheduleReconnect()
    }
  }

  // Phones freeze or kill background sockets, so check again the moment the page is usable.
  const check = (force: boolean) => {
    if (finished || cancelled || connected) return
    if (expiresAt && Date.now() > expiresAt) {
      expire()
      return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      status('offline')
      return
    }
    const healthy = !!peer && !peer.destroyed && !peer.disconnected && peer.open
    if (healthy && force) {
      // The socket may have died silently while hidden. Cycle it; the room code stays the same.
      try {
        peer?.disconnect()
      } catch {
        /* rebuilt below */
      }
    }
    if (!healthy || force) {
      attempt = 0
      scheduleReconnect(true)
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      return
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0
    hiddenAt = 0
    check(away > 20_000)
  }
  function onOnline() {
    check(false)
  }
  function onOffline() {
    if (!finished && !connected) status('offline')
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  if (navigator.onLine === false) status('offline')
  void build(roomId())

  return () => {
    cancelled = true
    finished = true
    stop(!connected)
  }
}

/* ---------- guest: join a friend's room ---------- */

/** Join a friend's room. Returns a cancel function. */
export function joinRoom(id: string, cb: { onConnected: (link: FriendLink) => void; onError: (e: FriendError) => void }): () => void {
  let cancelled = false
  let done = false
  let peer: Peer | null = null
  let reconnects = 0

  const stop = () => {
    clearTimeout(timer)
    if (!done) peer?.destroy()
  }
  const fail = (e: FriendError) => {
    if (cancelled || done) return
    cancelled = true
    stop()
    cb.onError(e)
  }

  const timer = setTimeout(() => fail(friendError('friend', 'guest')), 25_000)

  void (async () => {
    try {
      const p = await createPeer()
      if (cancelled) {
        p.destroy()
        return
      }
      peer = p
      const dial = () => {
        const conn = p.connect(id, { reliable: true, serialization: 'json' })
        conn.on('open', () => {
          if (cancelled) return
          done = true
          clearTimeout(timer)
          cb.onConnected(wrap(p, conn, 'guest'))
        })
        conn.on('error', () => fail(friendError('friend', 'guest')))
      }
      p.on('open', dial)
      p.on('disconnected', () => {
        // Brief signaling drops while connecting: reconnect a few times before giving up.
        if (cancelled || done || reconnects >= 3) return
        reconnects += 1
        setTimeout(() => {
          try {
            if (!cancelled && !done && !p.destroyed) p.reconnect()
          } catch {
            /* the overall timeout reports the failure */
          }
        }, 1000 * reconnects)
      })
      p.on('error', (err) => {
        if (cancelled || done) return
        const type = errType(err)
        if (type === 'peer-unavailable') fail(friendError('expired', 'guest'))
        else if (type === 'browser-incompatible') fail(friendError('browser', 'guest'))
        else if (type === 'webrtc') fail(friendError('friend', 'guest'))
        else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
          if (reconnects >= 3) fail(friendError('service', 'guest'))
        } else fail(friendError('service', 'guest'))
      })
    } catch {
      fail(friendError('service', 'guest'))
    }
  })()

  return () => {
    cancelled = true
    stop()
  }
}
