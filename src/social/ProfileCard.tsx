import { Avatar } from '../avatar/Avatar'
import { reportAvatar } from '../avatar/api'
import { useAvatarEntry } from '../avatar/store'
import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { Ban, Flag, Loader2, Swords, VolumeX, Volume2, X } from 'lucide-react'
import { JerseyDot } from '@/cosmetics/art'
import { useI18n, type MessageKey } from '@/i18n'
import { openAuthDialog, useAuth } from '../chat/account'
import { getPublicProfile, reportPlayerRpc, type ChallengeMode, type PublicProfile } from './api'
import { blockPlayer, unblockPlayer } from './blocks'
import { useChallenges } from './challenges'
import { appBridge, startChallenge } from './nav'
import { closeProfileCard, useProfileCardTarget } from './profileCard'

type Load = { status: 'loading' } | { status: 'ok'; profile: PublicProfile } | { status: 'missing' } | { status: 'error'; error: MessageKey }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl px-2 py-2 text-center" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <p className="display text-xl font-extrabold tabular-nums">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
        {label}
      </p>
    </div>
  )
}

/** The card that opens when you tap a username in chat. One instance sits at the top of the app. */
export function ProfileCardHost() {
  const { t, n, lang } = useI18n()
  const target = useProfileCardTarget()
  const auth = useAuth()
  const { isConnected } = useAccount()
  const { list } = useChallenges()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [step, setStep] = useState<'card' | 'mode'>('card')
  const [busy, setBusy] = useState<'mute' | 'block' | 'report' | 'picture' | null>(null)
  const [message, setMessage] = useState<MessageKey | null>(null)
  const [reported, setReported] = useState(false)
  const [pictureReported, setPictureReported] = useState(false)

  const username = target?.username ?? null
  const signedIn = auth.status === 'in'

  const reload = useCallback(async () => {
    if (!username) return
    const result = await getPublicProfile(username)
    if (!result.ok) setLoad({ status: 'error', error: result.error })
    else setLoad(result.profile ? { status: 'ok', profile: result.profile } : { status: 'missing' })
  }, [username])

  useEffect(() => {
    if (!username || !signedIn) return
    let cancelled = false
    void getPublicProfile(username).then((result) => {
      if (cancelled) return
      if (!result.ok) setLoad({ status: 'error', error: result.error })
      else setLoad(result.profile ? { status: 'ok', profile: result.profile } : { status: 'missing' })
    })
    return () => {
      cancelled = true
    }
  }, [username, signedIn])

  useEffect(() => {
    if (!username) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeProfileCard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [username])

  const avatarEntry = useAvatarEntry(username)
  if (!target || !username) return null

  const close = () => {
    closeProfileCard()
    setLoad({ status: 'loading' })
    setStep('card')
    setMessage(null)
    setReported(false)
    setPictureReported(false)
  }

  const profile = load.status === 'ok' ? load.profile : null
  const hasPending = list.some((c) => c.direction === 'out' && c.status === 'pending') // the database expires old ones

  // Why the Challenge button is switched off (if it is), as a short note.
  const challengeNote: MessageKey | null = !profile
    ? null
    : appBridge.busy
      ? 'social.card.noBusy'
      : profile.banned
      ? 'social.card.noBanned'
      : profile.myRelation
        ? 'social.card.noMuted'
        : profile.blockedMe
          ? 'social.card.noUnavailable'
          : !profile.openToChallenges
            ? 'social.card.noClosed'
            : !profile.available
              ? 'social.card.noOffline'
              : hasPending
                ? 'social.card.noPending'
                : null

  const act = async (kind: 'mute' | 'block') => {
    if (!profile) return
    setBusy(kind)
    setMessage(null)
    const result = profile.myRelation === kind ? await unblockPlayer(profile.username) : await blockPlayer(profile.username, target.userId, kind)
    setBusy(null)
    if (!result.ok) setMessage(result.error)
    else await reload()
  }

  const reportPicture = async () => {
    if (!profile) return
    setBusy('picture')
    setMessage(null)
    const result = await reportAvatar(profile.username)
    setBusy(null)
    if (result.ok) setPictureReported(true)
    else setMessage(result.error)
  }

  const report = async () => {
    if (!profile) return
    setBusy('report')
    setMessage(null)
    const result = await reportPlayerRpc(profile.username)
    setBusy(null)
    if (result.ok) setReported(true)
    else setMessage(result.error)
  }

  const choose = (mode: ChallengeMode) => {
    if (!profile) return
    const name = profile.username
    close()
    startChallenge(name, mode)
  }

  const joined = profile ? new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(profile.joinedAt) : ''

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center overflow-y-auto bg-black/70 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="card-title" className="panel relative max-h-[94dvh] w-full max-w-sm space-y-4 overflow-y-auto p-5" style={{ background: '#0b1630' }}>
        <div className="flex items-center justify-between gap-2">
          <h2 id="card-title" className="display min-w-0 truncate text-2xl font-extrabold">
            {username}
          </h2>
          <button type="button" onClick={close} aria-label={t('auth.close')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: 'var(--muted)' }}>
            <X size={20} />
          </button>
        </div>

        {!signedIn ? (
          <div className="space-y-3">
            <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
              {t('social.card.signIn')}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => { close(); openAuthDialog('signin') }}>
              {t('chat.signInToChat')}
            </button>
          </div>
        ) : load.status === 'loading' ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm" style={{ color: 'var(--muted)' }}>
            <Loader2 size={16} className="animate-spin" /> {t('social.card.loading')}
          </p>
        ) : load.status === 'missing' ? (
          <p className="py-4 text-center text-sm" style={{ color: 'var(--muted)' }}>
            {t('social.err.unknown')}
          </p>
        ) : load.status === 'error' ? (
          <p className="py-4 text-center text-sm" style={{ color: 'var(--bad)' }} role="alert">
            {t(load.error)}
          </p>
        ) : profile ? (
          <>
            <div className="flex items-center gap-4">
              <Avatar username={profile.username} size={64} />
              <svg viewBox="-16 -16 32 32" className="h-14 w-14 shrink-0" aria-hidden>
                <JerseyDot
                  jersey={{ color: profile.jerseyColor, secondary: profile.jerseySecondary, pattern: profile.jerseyPattern, number: profile.jerseyNumber, tag: profile.nameTag }}
                  number={profile.jerseyNumber}
                  r={14}
                  fontSize={16}
                />
              </svg>
              <div className="min-w-0 space-y-1">
                {profile.nameTag && <p className="truncate text-sm font-bold">{profile.nameTag}</p>}
                {profile.available && (
                  <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--good)' }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: 'var(--good)' }} aria-hidden /> {t('social.card.available')}
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {t('social.card.joined', { date: joined })}
                </p>
              </div>
            </div>

            {/* Plain text only: React escapes it, so a bio can never run as HTML. */}
            {profile.bio && (
              <p className="text-sm text-pretty" style={{ overflowWrap: 'anywhere' }}>
                {profile.bio}
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('social.card.challenges')} value={n(profile.challengesPlayed)} />
              {profile.rankedWins !== null && <Stat label={t('social.card.wins')} value={n(profile.rankedWins)} />}
              {profile.winStreak !== null && <Stat label={t('social.card.streak')} value={n(profile.winStreak)} />}
            </div>
            {profile.rankedWins !== null && (
              <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
                {t('social.card.statsNote')}
              </p>
            )}

            {!profile.isMe && step === 'card' && (
              <div className="space-y-2">
                <button type="button" className="btn btn-primary" disabled={challengeNote !== null} onClick={() => setStep('mode')} style={{ minHeight: 48 }}>
                  <Swords size={18} /> {t('social.card.challenge')}
                </button>
                {challengeNote && (
                  <p className="text-center text-xs text-pretty" style={{ color: 'var(--muted)' }} role="status">
                    {t(challengeNote)}
                  </p>
                )}
              </div>
            )}

            {!profile.isMe && step === 'mode' && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">{t('social.card.chooseMode')}</p>
                <button type="button" className="btn btn-primary" onClick={() => choose('friendly')} style={{ minHeight: 48 }}>
                  {t('social.mode.friendly')}
                </button>
                <button type="button" className="btn btn-ghost" disabled={!isConnected} onClick={() => choose('online')} style={{ minHeight: 48 }}>
                  {t('social.mode.online')}
                </button>
                {!isConnected && (
                  <p className="text-center text-xs text-pretty" style={{ color: 'var(--muted)' }}>
                    {t('social.card.needWallet')}
                  </p>
                )}
                <button type="button" className="mx-auto block min-h-[40px] text-xs font-bold" style={{ color: 'var(--muted)' }} onClick={() => setStep('card')}>
                  {t('common.cancel')}
                </button>
              </div>
            )}

            {!profile.isMe && (
              <div className="grid grid-cols-3 gap-2">
                <button type="button" className="btn btn-ghost" style={{ minHeight: 44, padding: '0 6px', fontSize: 13 }} disabled={busy !== null || profile.myRelation === 'block'} onClick={() => void act('mute')}>
                  {busy === 'mute' ? <Loader2 size={14} className="animate-spin" /> : profile.myRelation === 'mute' ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  {profile.myRelation === 'mute' ? t('social.card.unmute') : t('social.card.mute')}
                </button>
                <button type="button" className="btn btn-ghost" style={{ minHeight: 44, padding: '0 6px', fontSize: 13 }} disabled={busy !== null} onClick={() => void act('block')}>
                  {busy === 'block' ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                  {profile.myRelation === 'block' ? t('social.card.unblock') : t('social.card.block')}
                </button>
                <button type="button" className="btn btn-ghost" style={{ minHeight: 44, padding: '0 6px', fontSize: 13 }} disabled={busy !== null || reported} onClick={() => void report()}>
                  {busy === 'report' ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />}
                  {reported ? t('chat.reported') : t('social.card.report')}
                </button>
              </div>
            )}

            {!profile.isMe && avatarEntry.url !== null && (
              <button type="button" className="btn btn-ghost w-full" style={{ minHeight: 44, fontSize: 13 }} disabled={busy !== null || pictureReported} onClick={() => void reportPicture()}>
                {busy === 'picture' ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />}
                {pictureReported ? t('avatar.reported') : t('avatar.report')}
              </button>
            )}

            {message && (
              <p className="text-center text-xs" style={{ color: 'var(--bad)' }} role="alert">
                {t(message)}
              </p>
            )}
            <p className="text-center text-[11px] font-semibold text-pretty" style={{ color: 'var(--yellow)' }}>
              {t('social.rule')}
            </p>
          </>
        ) : null}
      </div>
    </div>
  )
}
