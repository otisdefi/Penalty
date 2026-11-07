import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { Check, Loader2, Swords, X } from 'lucide-react'
import { useI18n, type MessageKey } from '@/i18n'
import { useAuth } from '../chat/account'
import { type Challenge } from './api'
import { clearBlocks, refreshBlocks } from './blocks'
import { clearSendError, respondToChallenge, startEngine, stopEngine, useChallenges, cancelOutgoing } from './challenges'
import { appBridge } from './nav'

const OUT_TEXT: Record<Challenge['status'], MessageKey | null> = {
  pending: 'social.out.sent',
  accepted: 'social.out.accepted',
  declined: 'social.out.declined',
  expired: 'social.out.expired',
  busy: 'social.out.busy',
  cancelled: null,
}

/** Refresh a clock once a second while something is on screen. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [active])
  return now
}

const clock = (ms: number, pad: (v: number) => string) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/**
 * Follows my challenges for the whole app: shows an invite with Accept / Decline wherever I am, and the
 * state of the invite I sent. Starts when I sign in and stops when I sign out.
 */
export function ChallengeHost() {
  const { t, n } = useI18n()
  const auth = useAuth()
  const { isConnected } = useAccount()
  const { list, sendError } = useChallenges()
  const [answering, setAnswering] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; error: MessageKey } | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const userId = auth.status === 'in' ? auth.user?.id : undefined

  useEffect(() => {
    if (!userId) {
      stopEngine()
      clearBlocks()
      return
    }
    void startEngine(userId)
    void refreshBlocks()
    return () => stopEngine()
  }, [userId])

  const incoming = list.filter((c) => c.direction === 'in' && c.status === 'pending')
  const outgoing = list.find((c) => c.direction === 'out')
  const now = useNow(incoming.length > 0 || !!outgoing || !!sendError)
  const pad = (v: number) => n(v, { minimumIntegerDigits: 2 })

  const liveIncoming = incoming.filter((c) => c.expiresAt > now).slice(0, 2)
  const showOutgoing = outgoing && OUT_TEXT[outgoing.status] && !dismissed.includes(outgoing.id) && (outgoing.status === 'pending' ? outgoing.expiresAt > now : now - outgoing.createdAt < 5 * 60 * 1000)
  const outStatus: Challenge['status'] | null = outgoing ? (outgoing.status === 'pending' && outgoing.expiresAt <= now ? 'expired' : outgoing.status) : null

  if (!userId || now === 0 || (liveIncoming.length === 0 && !showOutgoing && !sendError)) return null

  const accept = async (c: Challenge) => {
    setAnswering(c.id)
    setFailed(null)
    const result = await respondToChallenge(c.id, 'accept')
    setAnswering(null)
    if (!result.ok) setFailed({ id: c.id, error: result.error })
    else if (result.status === 'accepted') appBridge.onAccepted(c)
    else setFailed({ id: c.id, error: 'social.in.gone' })
  }

  const decline = async (c: Challenge) => {
    setAnswering(c.id)
    await respondToChallenge(c.id, 'decline')
    setAnswering(null)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))]" aria-live="polite">
      {liveIncoming.map((c) => {
        const needsWallet = c.mode === 'online' && !isConnected
        const cannot = appBridge.busy || needsWallet
        return (
          <div key={c.id} role="alertdialog" aria-label={t('social.in.title', { name: c.other })} className="panel pointer-events-auto w-full max-w-sm space-y-2 p-3" style={{ background: '#0b1630', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
            <div className="flex items-start gap-3">
              <Swords size={20} style={{ color: 'var(--lime)' }} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{t('social.in.title', { name: c.other })}</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {t(c.mode === 'friendly' ? 'social.mode.friendly' : 'social.mode.online')} · {clock(c.expiresAt - now, pad)}
                </p>
              </div>
            </div>
            {(cannot || failed?.id === c.id) && (
              <p className="text-xs text-pretty" style={{ color: failed?.id === c.id ? 'var(--bad)' : 'var(--yellow)' }} role="status">
                {failed?.id === c.id ? t(failed.error) : appBridge.busy ? t('social.in.finishMatch') : t('social.in.needWallet')}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} disabled={answering === c.id} onClick={() => void decline(c)}>
                <X size={16} /> {t('social.in.decline')}
              </button>
              <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={answering === c.id || cannot} onClick={() => void accept(c)}>
                {answering === c.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t('social.in.accept')}
              </button>
            </div>
            <p className="text-center text-[10px]" style={{ color: 'var(--subtle)' }}>
              {t('social.rule')}
            </p>
          </div>
        )
      })}

      {(showOutgoing && outgoing && outStatus) || sendError ? (
        <div className="panel pointer-events-auto flex w-full max-w-sm items-center gap-3 p-3" style={{ background: '#0b1630', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }} role="status">
          <div className="min-w-0 flex-1">
            {sendError && !showOutgoing ? (
              <p className="text-xs text-pretty" style={{ color: 'var(--bad)' }}>
                {t(sendError)}
              </p>
            ) : outgoing && outStatus ? (
              <p className="text-xs font-semibold text-pretty" style={{ color: outStatus === 'accepted' ? 'var(--good)' : outStatus === 'pending' ? 'var(--ink)' : 'var(--yellow)' }}>
                {t(OUT_TEXT[outStatus] ?? 'social.out.expired', { name: outgoing.other })}
                {outStatus === 'pending' ? ` ${clock(outgoing.expiresAt - now, pad)}` : ''}
              </p>
            ) : null}
          </div>
          {outgoing && outStatus === 'pending' ? (
            <button type="button" className="shrink-0 text-xs font-bold underline" style={{ color: 'var(--muted)' }} onClick={() => void cancelOutgoing()}>
              {t('common.cancel')}
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('auth.close')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ color: 'var(--muted)' }}
              onClick={() => {
                if (outgoing) setDismissed((d) => [...d, outgoing.id])
                clearSendError()
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
