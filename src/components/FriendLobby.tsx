import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { openHost, joinRoom, type FriendLink } from '@/game/peer'
import type { Jersey } from '@/game/storage'
import { buildShareLink } from '@/lib/share'

interface Props {
  role: 'host' | 'guest'
  room: string | null
  jersey: Jersey
  onReady: (link: FriendLink, theirs: Jersey) => void
  onCancel: () => void
}

export function FriendLobby({ role, room, jersey, onReady, onCancel }: Props) {
  const [roomId, setRoomId] = useState<string | null>(room)
  const [link, setLink] = useState<string | null>(null)
  const [status, setStatus] = useState<'waiting' | 'connecting' | 'error'>(role === 'host' ? 'waiting' : 'connecting')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const jerseyRef = useRef(jersey)
  const readyRef = useRef(onReady)

  useEffect(() => {
    jerseyRef.current = jersey
    readyRef.current = onReady
  })

  useEffect(() => {
    let alive = true
    const handshake = (l: FriendLink) => {
      l.setHandlers({
        onMessage: (m) => {
          if (m.t === 'hello' && alive) {
            alive = false
            readyRef.current(l, m.jersey)
          }
        },
        onClose: () => {
          if (!alive) return
          setStatus('error')
          setError('Your friend left before the match started.')
        },
      })
      l.send({ t: 'hello', jersey: jerseyRef.current })
    }
    const fail = (message: string) => {
      if (!alive) return
      setStatus('error')
      setError(message)
    }

    let cancel: () => void
    if (role === 'host') {
      cancel = openHost({
        onWaiting: (id) => alive && setRoomId(id),
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
  }, [role, room])

  useEffect(() => {
    if (role !== 'host' || !roomId) return
    let live = true
    void buildShareLink(`/?room=${roomId}`).then((url) => live && setLink(url))
    return () => {
      live = false
    }
  }, [role, roomId])

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Copy failed. Select the link and copy it manually.')
    }
  }

  return (
    <div className="panel mx-auto max-w-md space-y-4 p-6 text-center">
      <h2 className="display text-3xl font-extrabold">{role === 'host' ? 'Invite a friend' : 'Joining match'}</h2>

      {status === 'error' ? (
        <p className="text-sm text-pretty" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      ) : role === 'host' ? (
        <>
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            Send this link to a friend. The match starts as soon as they open it. Keep this tab open.
          </p>
          <div className="flex items-center gap-2 rounded-2xl p-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <span className="mono min-w-0 flex-1 truncate px-2 text-left text-xs">{link ?? 'Creating your room...'}</span>
            <button type="button" onClick={() => void copy()} disabled={!link} className="btn btn-primary" style={{ width: 'auto', minHeight: 44 }}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <Loader2 size={15} className="animate-spin" /> Waiting for your friend
          </p>
        </>
      ) : (
        <p className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
          <Loader2 size={15} className="animate-spin" /> Connecting to your friend
        </p>
      )}

      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        {status === 'error' ? 'Back to menu' : 'Cancel'}
      </button>
    </div>
  )
}
