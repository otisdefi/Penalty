import type { DataConnection, Peer } from 'peerjs'
import type { Dir } from './logic'
import { isHexColor, type Jersey } from './storage'

export type Msg =
  | { t: 'hello'; jersey: Jersey }
  | { t: 'commit'; r: number; h: string }
  | { t: 'reveal'; r: number; d: Dir; n: string }
  | { t: 'again' }

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
      const j = m.jersey as Partial<Jersey> | undefined
      if (!j || !isHexColor(j.color) || !Number.isInteger(j.number) || (j.number as number) < 0 || (j.number as number) > 99) return null
      return { t: 'hello', jersey: { color: j.color, number: j.number as number } }
    }
    case 'commit':
      return Number.isInteger(m.r) && typeof m.h === 'string' && /^[0-9a-f]{64}$/.test(m.h) ? { t: 'commit', r: m.r as number, h: m.h } : null
    case 'reveal':
      return Number.isInteger(m.r) && (m.d === 0 || m.d === 1 || m.d === 2) && typeof m.n === 'string' && /^[0-9a-f]{32}$/.test(m.n)
        ? { t: 'reveal', r: m.r as number, d: m.d, n: m.n }
        : null
    case 'again':
      return { t: 'again' }
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

function wrap(peer: Peer, conn: DataConnection, role: FriendLink['role']): FriendLink {
  let onMessage: ((m: Msg) => void) | undefined
  let onClose: (() => void) | undefined
  let closed = false
  const queue: Msg[] = []
  let closeQueued = false

  conn.on('data', (raw) => {
    const msg = parseMsg(raw)
    if (!msg) return
    if (onMessage) onMessage(msg)
    else queue.push(msg)
  })
  const handleClose = () => {
    if (closed) return
    closed = true
    if (onClose) onClose()
    else closeQueued = true
  }
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
      onMessage = undefined
      onClose = undefined
      conn.close()
      peer.destroy()
    },
  }
}

function describe(err: unknown): string {
  const type = (err as { type?: string } | null)?.type
  switch (type) {
    case 'peer-unavailable':
      return 'That room was not found. Ask your friend to send a fresh link.'
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the matchmaking service. Check your connection and try again.'
    case 'browser-incompatible':
      return 'This browser does not support peer-to-peer play.'
    default:
      return 'Could not connect to your friend. Try again.'
  }
}

async function createPeer(id?: string): Promise<Peer> {
  const { Peer: PeerCtor } = await import('peerjs')
  return id ? new PeerCtor(id, { debug: 0 }) : new PeerCtor({ debug: 0 })
}

interface HostCallbacks {
  onWaiting: (id: string) => void
  onConnected: (link: FriendLink) => void
  onError: (message: string) => void
}

/** Open a room and wait for one friend. Returns a cancel function. */
export function openHost(cb: HostCallbacks): () => void {
  let cancelled = false
  let peer: Peer | null = null
  let connected = false

  const start = async (attempt: number) => {
    try {
      const id = roomId()
      const p = await createPeer(id)
      if (cancelled) {
        p.destroy()
        return
      }
      peer = p
      p.on('open', () => cb.onWaiting(id))
      p.on('connection', (conn) => {
        if (connected) {
          conn.on('open', () => conn.close())
          return
        }
        connected = true
        conn.on('open', () => cb.onConnected(wrap(p, conn, 'host')))
      })
      p.on('error', (err) => {
        if (cancelled) return
        if ((err as { type?: string }).type === 'unavailable-id' && attempt < 2) {
          p.destroy()
          void start(attempt + 1)
          return
        }
        cb.onError(describe(err))
      })
    } catch (e) {
      if (!cancelled) cb.onError(describe(e))
    }
  }
  void start(0)

  return () => {
    cancelled = true
    if (!connected) peer?.destroy()
  }
}

/** Join a friend's room. Returns a cancel function. */
export function joinRoom(id: string, cb: { onConnected: (link: FriendLink) => void; onError: (message: string) => void }): () => void {
  let cancelled = false
  let done = false
  let peer: Peer | null = null
  const timer = setTimeout(() => {
    if (done || cancelled) return
    cancelled = true
    peer?.destroy()
    cb.onError('Timed out connecting to your friend. Ask them to keep the room open and try again.')
  }, 15000)

  void (async () => {
    try {
      const p = await createPeer()
      if (cancelled) {
        p.destroy()
        return
      }
      peer = p
      p.on('open', () => {
        const conn = p.connect(id, { reliable: true, serialization: 'json' })
        conn.on('open', () => {
          if (cancelled) return
          done = true
          clearTimeout(timer)
          cb.onConnected(wrap(p, conn, 'guest'))
        })
      })
      p.on('error', (err) => {
        if (cancelled || done) return
        clearTimeout(timer)
        cb.onError(describe(err))
      })
    } catch (e) {
      if (!cancelled) cb.onError(describe(e))
    }
  })()

  return () => {
    cancelled = true
    clearTimeout(timer)
    if (!done) peer?.destroy()
  }
}
