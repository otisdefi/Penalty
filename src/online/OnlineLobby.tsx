import { useEffect, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { QUEUE_TTL_S } from './config'
import type { OnchainMatch } from './helpers'
import { buildShareLink } from '@/lib/share'
import { useI18n } from '@/i18n'
import { useAccount } from 'wagmi'
import { JerseyStep } from '@/cosmetics/JerseyStep'
import type { NetworkConfig } from '../networks'

interface Props {
  matchId: bigint
  /** The network the room is on; the share link names it so the friend joins on the same one. */
  net: NetworkConfig
  m: OnchainMatch
  roomCode?: string
  chainNow: number
  busy: string | null
  error: string | null
  onCancel: () => void
}

/** Waiting room: a ranked queue search, or a private room with a share link. */
export function OnlineLobby({ matchId, net, m, roomCode, chainNow, busy, error, onCancel }: Props) {
  const { t, n } = useI18n()
  const { address } = useAccount()
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  useEffect(() => {
    if (m.ranked || !roomCode) return
    let live = true
    // The room code is a bearer secret, so it travels in the #fragment, never in the path or query.
    void buildShareLink(`/?match=${matchId.toString()}&net=${net.slug}`).then((url) => live && setLink(`${url}#${roomCode}`))
    return () => {
      live = false
    }
  }, [m.ranked, matchId, roomCode, net.slug])

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
          <h2 className="display text-3xl font-extrabold text-balance">{t('lobby.finding')}</h2>
          <p className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <Loader2 size={15} className="animate-spin" />
            {queueLeft > 0 ? t('lobby.searching', { s: n(queueLeft) }) : t('lobby.expired')}
          </p>
          <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
            {t('lobby.rankedHint')}
          </p>
          <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
            {t('net.sameNetwork', { network: net.name })}
          </p>
        </>
      ) : (
        <>
          <h2 className="display text-3xl font-extrabold">{t('lobby.room', { id: matchId.toString() })}</h2>
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            {t('lobby.sendLink')}
          </p>
          <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
            {t('net.sameNetwork', { network: net.name })}
          </p>
          {roomCode ? (
            <div className="flex items-center gap-2 rounded-2xl p-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <span className="mono min-w-0 flex-1 truncate px-2 text-left text-xs">{link ?? t('lobby.creatingLink')}</span>
              <button type="button" onClick={() => void copy()} disabled={!link} className="btn btn-primary" style={{ width: 'auto', minHeight: 44 }}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--bad)' }}>
              {t('lobby.noCode')}
            </p>
          )}
          {copyError && (
            <p className="text-xs" style={{ color: 'var(--bad)' }}>
              {t('lobby.copyFailed')}
            </p>
          )}
          <p className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <Loader2 size={15} className="animate-spin" /> {t('friend.waitingShort')}
          </p>
        </>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      )}
      <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
        <JerseyStep address={address} />
        <p className="mt-2 text-left text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          {t('online.lobbyShare')}
        </p>
      </div>
      <button type="button" className="btn btn-ghost" disabled={cancelling} onClick={onCancel}>
        {cancelling ? <Loader2 size={16} className="animate-spin" /> : null}
        {m.ranked ? t('lobby.stop') : t('lobby.cancelRoom')}
      </button>
    </div>
  )
}
