import { useEffect, useState } from 'react'
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react'
import { LanguageButton } from './LanguageButton'
import { useI18n } from '@/i18n'
import Pitch from './Pitch'
import { Scoreboard } from './Scoreboard'
import { SaveResult } from './SaveResult'
import { useMatch } from '@/hooks/useMatch'
import { otherTeam, shooterOf, type Dir, type Team } from '@/game/logic'
import type { Jersey } from '@/game/storage'
import { setMuted as setAudioMuted, sfx } from '@/game/audio'
import type { FriendLink } from '@/game/peer'
import { textOn, YELLOW } from '@/lib/color'
import { isMuted, setMuted as setWhistleMuted } from '@/lib/whistle'
import { useCosmetics } from '@/cosmetics/store'
import { colorLabelKey } from '@/cosmetics/kits'
import { InlineChat } from '@/chat/InlineChat'
import type { Look, StadiumId } from '@/cosmetics/types'

interface Props {
  mode: 'bot' | 'friend'
  ranked: boolean
  myTeam: Team
  kits: Record<Team, Jersey>
  link: FriendLink | null
  /** Display name of each team's player. */
  names: Record<Team, string>
  /** The guest's shirt colour was switched because it matched the host's. */
  recolored?: boolean
  /** Stadium chosen by the host in friend matches; otherwise the player's own. */
  stadium?: StadiumId
  /** Friend room code, used as the chat channel (friend matches only). */
  roomId?: string
  /** Usernames of verified account holders per team (shown as round pictures in the scoreboard). */
  avatars?: Partial<Record<Team, string>>
  onExit: () => void
}

const SHOOT_LABELS = ['match.shoot.left', 'match.shoot.center', 'match.shoot.right'] as const
const KEEP_LABELS = ['match.keep.left', 'match.keep.stay', 'match.keep.right'] as const

export function MatchScreen({ mode, ranked, myTeam, kits, link, names, recolored = false, stadium, roomId, avatars, onExit }: Props) {
  const { t, n } = useI18n()
  const m = useMatch({ mode, myTeam, link })
  const mine = useCosmetics()
  const look: Look = { ball: mine.ball, trail: mine.trail, stadium: stadium ?? mine.stadium }
  const [muted, setMutedState] = useState(isMuted)
  // A ranked result can only be saved from this screen. Skipping (or leaving) discards it for good.
  const [skippedId, setSkippedId] = useState<string | null>(null)
  const rivalTeam = otherTeam(myTeam)
  const shooterTeam: Team = m.anim ? m.anim.shooter : shooterOf(m.round)
  const choosing = m.phase === 'choosing'
  const done = m.phase === 'done'
  const iShoot = m.role === 'shoot'
  const labels = iShoot ? SHOOT_LABELS : KEEP_LABELS
  const myKit = kits[myTeam]

  // Silence any crowd or commentary still playing when the match screen closes.
  useEffect(() => () => sfx.stopAll(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!choosing) return
      const map: Record<string, Dir> = { ArrowLeft: 0, ArrowUp: 1, ArrowDown: 1, ArrowRight: 2 }
      const dir = map[e.key]
      if (dir !== undefined) {
        e.preventDefault()
        m.submit(dir)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choosing, m])

  const toggleMute = () => {
    const next = !muted
    setMutedState(next)
    setWhistleMuted(next) // remembered between visits
    setAudioMuted(next)
    if (!next) sfx.pick()
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-2 px-4 pb-3 pt-1">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onExit} className="flex min-h-[40px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          <ArrowLeft size={16} /> {t('common.leave')}
        </button>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--lime)' }}>
          {ranked ? t('match.ranked') : mode === 'friend' ? t('match.friend') : t('match.practice')}
        </span>
        <div className="flex items-center gap-1">
          <LanguageButton />
          <button type="button" onClick={toggleMute} aria-label={muted ? t('match.unmute') : t('match.mute')} className="flex h-10 w-10 items-center justify-center" style={{ color: 'var(--muted)' }}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>

      <Scoreboard
        status={m.status}
        kicksTaken={m.kicks.length}
        kits={kits}
        myTeam={myTeam}
        names={names}
        avatars={avatars}
        shooterTeam={shooterTeam}
        done={done}
        choosing={choosing}
        secondsLeft={m.secondsLeft}
      />

      <div
        className="relative mx-auto overflow-hidden rounded-3xl"
        style={{ border: '1px solid var(--line)', aspectRatio: '320 / 360', width: 'min(100%, calc(48dvh * 320 / 360))' }}
      >
        <Pitch kick={m.anim} kits={kits} pick={m.myPick} role={m.role} shooterTeam={shooterTeam} myTeam={myTeam} names={names} look={look} />
        {m.anim && (
          <div
            key={m.kicks.length}
            className="banner pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 py-1.5 text-center"
            style={{ background: 'rgba(6,13,31,0.8)', borderBlock: `2px solid ${m.anim.goal ? YELLOW : '#ffffff'}` }}
            role="status"
          >
            <span className="display block truncate px-2 font-extrabold leading-none tracking-wider" style={{ color: m.anim.goal ? YELLOW : '#ffffff', fontSize: (m.anim.goal ? t('banner.goal') : t('banner.saved')).length > 6 ? 44 : 60 }}>
              {m.anim.goal ? t('banner.goal') : t('banner.saved')}
            </span>
          </div>
        )}
      </div>

      {recolored && !done && (
        <p className="text-center text-[11px]" style={{ color: 'var(--yellow)' }} role="status">
          {t('ready.sameColor', { color: colorLabelKey(kits.blue.color) ? t(colorLabelKey(kits.blue.color)!) : '' })}
        </p>
      )}

      {!done && m.phase !== 'aborted' && (
        <div className="space-y-1.5">
          <p className="min-h-[18px] text-[13px] font-semibold" aria-live="polite">
            {m.phase === 'waiting'
              ? t('match.waitingFriend')
              : m.phase === 'whistle'
                ? t('match.whistle')
              : m.phase === 'reveal'
                ? ' '
                : iShoot
                  ? t('match.promptShoot')
                  : t('match.promptKeep')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {([0, 1, 2] as const).map((d) => {
              const picked = m.myPick === d
              const dimmed = m.myPick !== null && !picked
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!choosing}
                  onClick={() => m.submit(d)}
                  aria-pressed={picked}
                  className="btn"
                  style={{
                    minHeight: 56,
                    padding: '0 8px',
                    background: picked ? YELLOW : myKit.color,
                    color: picked ? '#0a1530' : textOn(myKit.color),
                    opacity: dimmed ? 0.3 : 1,
                    boxShadow: picked ? `0 0 0 3px rgba(255,210,63,0.35)` : 'inset 0 0 0 1px rgba(255,255,255,0.25)',
                  }}
                >
                  <span className="display text-[17px] font-extrabold leading-tight tracking-wide">{t(labels[d])}</span>
                </button>
              )
            })}
          </div>
          {m.notice && (
            <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>
              {t(m.notice)}
            </p>
          )}
        </div>
      )}

      {m.phase === 'aborted' && (
        <div className="panel space-y-3 p-4 text-center">
          <p className="text-sm text-pretty">{m.abortReason ? t(m.abortReason) : ''}</p>
          <button type="button" className="btn btn-primary" onClick={onExit}>
            {t('common.backToMenu')}
          </button>
        </div>
      )}

      {done && (
        <div className="panel space-y-3 p-4">
          <p className="display text-center text-4xl font-extrabold" style={{ color: m.won ? 'var(--good)' : 'var(--bad)' }}>
            {m.won ? t('match.youWin') : t('match.youLose')} {n(m.status[myTeam])}-{n(m.status[rivalTeam])}
          </p>
          <p className="truncate text-center text-sm font-semibold" style={{ color: 'var(--muted)' }}>
            {names[myTeam]} {n(m.status[myTeam])} - {n(m.status[rivalTeam])} {names[rivalTeam]}
          </p>
          {ranked && mode === 'bot' && (
            <div className="space-y-2 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
              {skippedId === m.matchId ? (
                <p className="text-center text-sm font-semibold" style={{ color: 'var(--muted)' }} role="status">
                  {t('save.skipped')}
                </p>
              ) : (
                <>
                  <SaveResult won={m.won} />
                  <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setSkippedId(m.matchId)}>
                    {t('save.skip')}
                  </button>
                </>
              )}
              <p className="text-center text-[11px] text-pretty" style={{ color: 'var(--subtle)' }}>
                {t('save.note')}
              </p>
            </div>
          )}
          <button
            type="button"
            className={`btn ${ranked && mode === 'bot' ? 'btn-ghost' : 'btn-primary'}`}
            onClick={m.requestRematch}
            disabled={m.friendGone || m.rematchWait}
          >
            {m.friendGone ? t('match.friendLeft') : m.rematchWait ? t('match.waitingFriend') : mode === 'friend' ? t('match.rematch') : t('match.playAgain')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onExit}>
            {t('common.backToMenu')}
          </button>
        </div>
      )}
      {mode === 'friend' && roomId && <InlineChat channel={`room:${roomId}`} title="chat.title.room" />}
    </div>
  )
}
