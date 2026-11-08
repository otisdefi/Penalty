import { useEffect, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { LanguageButton } from '@/components/LanguageButton'
import { TestnetBadge } from '@/components/TestnetBadge'
import { LEADERBOARD_ADDRESS, LEADERBOARD_CHAIN_ID, leaderboardAbi } from '@/contract'
import { JerseyDot } from '@/cosmetics/art'
import { AvatarUpload } from '@/avatar/AvatarUpload'
import { JerseyStep } from '@/cosmetics/JerseyStep'
import { NAME_MAX, tagMessage, tagProblem, trimTag } from '@/cosmetics/nameFilter'
import { useCosmetics } from '@/cosmetics/store'
import { SectionTitle } from '@/cosmetics/ui'
import { useI18n, type MessageKey } from '@/i18n'
import { openAuthDialog, useAuth } from '../chat/account'
import { messageProblem, type MessageProblem } from '../chat/rules'
import { getMyProfile, updateMyProfile } from './api'
import { unblockPlayer, useBlocks } from './blocks'

const BIO_MAX = 60

const BIO_PROBLEMS: Record<MessageProblem, MessageKey> = {
  empty: 'chat.err.empty',
  too_long: 'social.err.bioLong',
  bad_chars: 'chat.err.badChars',
  link: 'chat.err.link',
  email: 'chat.err.email',
  phone: 'chat.err.phone',
  blocked_word: 'chat.err.word',
}

function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="flex w-full items-start gap-3 text-left" style={{ opacity: disabled ? 0.55 : 1 }}>
      <span className="mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors" style={{ background: on ? 'var(--lime)' : 'rgba(255,255,255,0.15)' }}>
        <span className="h-5 w-5 rounded-full transition-transform" style={{ transform: on ? 'translateX(20px)' : 'none', background: on ? '#0a1530' : '#fff' }} />
      </span>
      <span className="space-y-0.5">
        <span className="block text-sm font-bold">{label}</span>
        {hint && (
          <span className="block text-xs text-pretty" style={{ color: 'var(--muted)' }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  )
}

/** "My profile": edit how other players see you. The username can not be changed. */
export function MyProfile({ onBack }: { onBack: () => void }) {
  const { t, n } = useI18n()
  const auth = useAuth()
  const { jersey } = useCosmetics()
  const { address } = useAccount()
  const blocks = useBlocks()
  const [loaded, setLoaded] = useState(false)
  const [tag, setTag] = useState('')
  const [bio, setBio] = useState('')
  const [open, setOpen] = useState(true)
  const [showStats, setShowStats] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  // Ranked numbers come from the public leaderboard record of the connected wallet. They are only sent if sharing is on.
  const record = useReadContract({
    address: LEADERBOARD_ADDRESS,
    abi: leaderboardAbi,
    functionName: 'getRecord',
    args: address ? [address] : undefined,
    chainId: LEADERBOARD_CHAIN_ID,
    query: { enabled: !!address },
  })

  const userId = auth.user?.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void getMyProfile(userId).then((r) => {
      if (cancelled) return
      if (r.ok) {
        setTag(r.profile.nameTag)
        setBio(r.profile.bio)
        setOpen(r.profile.openToChallenges)
        setShowStats(r.profile.showStats)
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const header = (
    <header className="flex items-center justify-between">
      <button type="button" onClick={onBack} className="flex min-h-[44px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={16} /> {t('online.menu')}
      </button>
      <h1 className="display min-w-0 truncate text-2xl font-extrabold">{t('social.me.title')}</h1>
      <div className="flex items-center gap-1">
        <LanguageButton />
        <TestnetBadge />
      </div>
    </header>
  )

  if (auth.status !== 'in' || !auth.user) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-10 pt-3">
        {header}
        <div className="panel space-y-3 p-5 text-center">
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            {t('social.me.signIn')}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => openAuthDialog('signin')}>
            {t('chat.signInToChat')}
          </button>
        </div>
      </div>
    )
  }

  const tagIssue = tagMessage(tagProblem(tag))
  const cleanedBio = bio.trim().replace(/\s+/g, ' ')
  const bioProblem = cleanedBio ? messageProblem(cleanedBio) : null
  const bioIssue = bioProblem ? BIO_PROBLEMS[bioProblem] : cleanedBio.length > BIO_MAX ? 'social.err.bioLong' : null
  const wins = record.data ? Number(record.data[0]) : null
  const streak = record.data ? Number(record.data[2]) : null
  const canSave = loaded && !saving && !tagIssue && !bioIssue

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    const result = await updateMyProfile({
      color: jersey.color,
      secondary: jersey.secondary ?? '#f1f5f9',
      pattern: jersey.pattern ?? 'solid',
      number: jersey.number,
      nameTag: tag.trim(),
      bio: cleanedBio,
      openToChallenges: open,
      showStats,
      wins,
      streak,
    })
    setSaving(false)
    if (result.ok) setSaved(true)
    else setError(result.error)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-10 pt-3">
      {header}

      <section className="panel space-y-1 p-4">
        <p className="text-sm font-bold">{t('auth.account.signedInAs', { name: auth.user.username })}</p>
        <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          {t('social.me.usernameFixed')}
        </p>
      </section>

      <AvatarUpload />

      <section className="panel p-4">
        <JerseyStep address={address} />
      </section>

      <section className="panel space-y-4 p-4">
        <div>
          <SectionTitle>{t('social.me.tag', { max: n(NAME_MAX) })}</SectionTitle>
          <input
            type="text"
            value={tag}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setTag(trimTag(e.target.value))
              setSaved(false)
            }}
            placeholder={t('cz.optional')}
            aria-label={t('social.me.tag', { max: n(NAME_MAX) })}
            aria-invalid={tagIssue !== null}
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full rounded-xl border bg-transparent px-3 text-base font-semibold"
            style={{ borderColor: tagIssue ? 'var(--bad)' : 'var(--line)' }}
          />
          {tagIssue && (
            <p className="mt-1 text-xs" style={{ color: 'var(--bad)' }} role="alert">
              {t(tagIssue)}
            </p>
          )}
        </div>

        <div>
          <SectionTitle>{t('social.me.bio', { max: n(BIO_MAX) })}</SectionTitle>
          <input
            type="text"
            value={bio}
            maxLength={BIO_MAX}
            onChange={(e) => {
              setBio(e.target.value.slice(0, BIO_MAX))
              setSaved(false)
            }}
            placeholder={t('social.me.bioPlaceholder')}
            aria-label={t('social.me.bio', { max: n(BIO_MAX) })}
            aria-invalid={bioIssue !== null}
            autoComplete="off"
            className="h-11 w-full rounded-xl border bg-transparent px-3 text-base"
            style={{ borderColor: bioIssue ? 'var(--bad)' : 'var(--line)' }}
          />
          <div className="mt-1 flex justify-between gap-2 text-xs">
            <span style={{ color: 'var(--bad)' }} role="alert">
              {bioIssue ? t(bioIssue) : ''}
            </span>
            <span className="tabular-nums" style={{ color: 'var(--subtle)' }}>
              {n(bio.length)}/{n(BIO_MAX)}
            </span>
          </div>
        </div>

        <Toggle on={open} onChange={(v) => { setOpen(v); setSaved(false) }} label={t('social.me.open')} hint={t('social.me.openHint')} />
        <Toggle
          on={showStats && !!address}
          onChange={(v) => { setShowStats(v); setSaved(false) }}
          disabled={!address}
          label={t('social.me.stats')}
          hint={address ? t('social.me.statsHint') : t('social.me.statsNeedWallet')}
        />

        <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
            {t('social.me.preview')}
          </p>
          <div className="flex items-center gap-3">
            <svg viewBox="-16 -16 32 32" className="h-14 w-14 shrink-0" aria-hidden>
              <JerseyDot jersey={jersey} number={jersey.number} r={14} fontSize={16} />
            </svg>
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold">{auth.user.username}</p>
              {tag.trim() && <p className="truncate text-xs font-bold">{tag.trim()}</p>}
              {cleanedBio && !bioIssue && (
                <p className="text-xs text-pretty" style={{ color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                  {cleanedBio}
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          {t('social.me.privacy')}
        </p>

        {error && (
          <p className="text-sm" style={{ color: 'var(--bad)' }} role="alert">
            {t(error)}
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--good)' }} role="status">
            <Check size={15} /> {t('social.me.saved')}
          </p>
        )}
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => void save()} style={{ minHeight: 48 }}>
          {saving && <Loader2 size={16} className="animate-spin" />} {t('social.me.save')}
        </button>
      </section>

      <section className="panel space-y-2 p-4">
        <h2 className="display text-xl font-extrabold">{t('social.me.blocked')}</h2>
        {blocks.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t('social.me.noBlocked')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <span className="min-w-0 truncate text-sm font-semibold">
                  {b.username} <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>· {t(b.kind === 'block' ? 'social.me.kindBlock' : 'social.me.kindMute')}</span>
                </span>
                <button type="button" className="shrink-0 text-xs font-bold underline" style={{ color: 'var(--lime)' }} onClick={() => void unblockPlayer(b.username)}>
                  {t('social.me.unblock')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-[11px] font-semibold text-pretty" style={{ color: 'var(--yellow)' }}>
        {t('social.rule')}
      </p>
    </div>
  )
}
