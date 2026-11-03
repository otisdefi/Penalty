import { useEffect, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { QUEUE_TTL_S } from './config'
import type { OnchainMatch } from './helpers'
import { buildShareLink } from '@/lib/share'

interface Props {
  matchId: bigint
  m: OnchainMatch
  roomCode?: string
  chainNow: number
  busy: string | null
  error: string | null
  onCancel: () => void
}

/** Waiting room: a ranked queue search, or a private room with a share link. */
export function OnlineLobby({ matchId, m, roomCode, chainNow, busy, error, onCancel }: Props) {
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  useEffect(() => {
    if (m.ranked || !roomCode) return
    let live = true
    // The room code is a bearer secret, so it travels in the #fragment, never in the path or query.
    void buildShareLink(`/?match=${matchId.toString()}`).then((url) => live && setLink(`${url}#${roomCode}`))
    return () => {
      live = false
    }
  }, [m.ranked, matchId, roomCode])

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setCopyError(false)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopyError(true)
    }
  }

  const queueLeft = Math.max(0, Math.ceil(m.createdAt + QUEUE_TTL_S - chainNow))
  const cancelling = busy === 'cancel'

  return (
    <div className="panel space-y-4 p-5 text-center">
      {m.ranked ? (
        <>
          <h2 className="display text-3xl font-extrabold">Finding an opponent</h2>
          <p className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <Loader2 size={15} className="animate-spin" />
            {queueLeft > 0 ? `Searching... ${queueLeft}s left` : 'No opponent yet. Your search has expired.'}
          </p>
          <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
            The match starts the moment another player queues. Ranked results update the verified leaderboard.
          </p>
        </>
      ) : (
        <>
          <h2 className="display text-3xl font-extrabold">Room #{matchId.toString()}</h2>
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            Send this link to your friend. The match starts as soon as they join. Anyone with the link can join, so share it privately.
          </p>
          {roomCode ? (
            <div className="flex items-center gap-2 rounded-2xl p-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <span className="mono min-w-0 flex-1 truncate px-2 text-left text-xs">{link ?? 'Creating link...'}</span>
              <button type="button" onClick={() => void copy()} disabled={!link} className="btn btn-primary" style={{ width: 'auto', minHeight: 44 }}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--bad)' }}>
              The room code is stored on the device that created this room, so the link cannot be shown here.
            </p>
          )}
          {copyError && (
            <p className="text-xs" style={{ color: 'var(--bad)' }}>
              Copy failed. Select the link and copy it manually.
            </p>
          )}
          <p className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <Loader2 size={15} className="animate-spin" /> Waiting for your friend
          </p>
        </>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      )}
      <button type="button" className="btn btn-ghost" disabled={cancelling} onClick={onCancel}>
        {cancelling ? <Loader2 size={16} className="animate-spin" /> : null}
        {m.ranked ? 'Stop searching' : 'Cancel room'}
      </button>
    </div>
  )
}
