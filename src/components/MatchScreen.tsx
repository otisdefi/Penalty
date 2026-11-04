import { useEffect, useState } from 'react'
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react'
import Pitch from './Pitch'
import { Scoreboard } from './Scoreboard'
import { SaveResult } from './SaveResult'
import { useMatch } from '@/hooks/useMatch'
import { otherTeam, shooterOf, type Dir, type Team } from '@/game/logic'
import { clearPending, savePending, type Jersey } from '@/game/storage'
import { setMuted as setAudioMuted, sfx } from '@/game/audio'
import type { FriendLink } from '@/game/peer'
import { textOn, YELLOW } from '@/lib/color'
import { isMuted, setMuted as setWhistleMuted } from '@/lib/whistle'
import { useAccount } from 'wagmi'

interface Props {
  mode: 'bot' | 'friend'
  ranked: boolean
  myTeam: Team
  kits: Record<Team, Jersey>
  link: FriendLink | null
  rivalName: string
  onExit: () => void
}

const SHOOT_LABELS = ['LEFT', 'CENTER', 'RIGHT'] as const
const KEEP_LABELS = ['DIVE LEFT', 'STAY', 'DIVE RIGHT'] as const

export function MatchScreen({ mode, ranked, myTeam, kits, link, rivalName, onExit }: Props) {
  const m = useMatch({ mode, myTeam, link })
  const { address } = useAccount()
  const [muted, setMutedState] = useState(isMuted)
  const rivalTeam = otherTeam(myTeam)
  const shooterTeam: Team = m.anim ? m.anim.shooter : shooterOf(m.round)
  const choosing = m.phase === 'choosing'
  const done = m.phase === 'done'
  const iShoot = m.role === 'shoot'
  const labels = iShoot ? SHOOT_LABELS : KEEP_LABELS
  const myKit = kits[myTeam]

  // Keep a ranked result retrievable if the tab closes before it is saved.
  useEffect(() => {
    if (done && ranked && mode === 'bot') {
      savePending({ matchId: m.matchId, won: m.won, address: address ?? '' })
    }
  }, [done, ranked, mode, m.matchId, m.won, address])

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
          <ArrowLeft size={16} /> Leave
        </button>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--lime)' }}>
          {ranked ? 'Ranked' : mode === 'friend' ? 'Friend match' : 'Practice'}
        </span>
        <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="flex h-10 w-10 items-center justify-center" style={{ color: 'var(--muted)' }}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>

      <Scoreboard
        status={m.status}
        kicksTaken={m.kicks.length}
        kits={kits}
        myTeam={myTeam}
        rivalName={rivalName}
        shooterTeam={shooterTeam}
        done={done}
        choosing={choosing}
        secondsLeft={m.secondsLeft}
      />

      <div
        className="relative mx-auto overflow-hidden rounded-3xl"
        style={{ border: '1px solid var(--line)', aspectRatio: '320 / 360', width: 'min(100%, calc(48dvh * 320 / 360))' }}
      >
        <Pitch kick={m.anim} kits={kits} pick={m.myPick} role={m.role} shooterTeam={shooterTeam} myTeam={myTeam} rivalLabel={rivalName} />
        {m.anim && (
          <div
            key={m.kicks.length}
            className="banner pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 py-1.5 text-center"
            style={{ background: 'rgba(6,13,31,0.8)', borderBlock: `2px solid ${m.anim.goal ? YELLOW : '#ffffff'}` }}
            role="status"
          >
            <span className="display text-6xl font-extrabold leading-none tracking-wider" style={{ color: m.anim.goal ? YELLOW : '#ffffff' }}>
              {m.anim.goal ? 'GOAL' : 'SAVED'}
            </span>
          </div>
        )}
      </div>

      {!done && m.phase !== 'aborted' && (
        <div className="space-y-1.5">
          <p className="min-h-[18px] text-[13px] font-semibold" aria-live="polite">
            {m.phase === 'waiting'
              ? 'Waiting for your friend...'
              : m.phase === 'whistle'
                ? 'Referee whistle... get ready.'
              : m.phase === 'reveal'
                ? ' '
                : iShoot
                  ? 'You are the shooter. Pick where to shoot.'
                  : 'You are the goalkeeper. Pick where to dive.'}
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
                  <span className="display text-lg font-extrabold leading-tight tracking-wider">{labels[d]}</span>
                </button>
              )
            })}
          </div>
          {m.notice && (
            <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>
              {m.notice}
            </p>
          )}
        </div>
      )}

      {m.phase === 'aborted' && (
        <div className="panel space-y-3 p-4 text-center">
          <p className="text-sm text-pretty">{m.abortReason}</p>
          <button type="button" className="btn btn-primary" onClick={onExit}>
            Back to menu
          </button>
        </div>
      )}

      {done && (
        <div className="panel space-y-3 p-4">
          <p className="display text-center text-4xl font-extrabold" style={{ color: m.won ? 'var(--good)' : 'var(--bad)' }}>
            {m.won ? 'You win' : 'You lose'} {m.status[myTeam]}-{m.status[rivalTeam]}
          </p>
          {ranked && mode === 'bot' && <SaveResult won={m.won} onSaved={clearPending} />}
          <button
            type="button"
            className={`btn ${ranked && mode === 'bot' ? 'btn-ghost' : 'btn-primary'}`}
            onClick={m.requestRematch}
            disabled={m.friendGone || m.rematchWait}
          >
            {m.friendGone ? 'Friend left' : m.rematchWait ? 'Waiting for your friend...' : mode === 'friend' ? 'Rematch' : 'Play again'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onExit}>
            Back to menu
          </button>
        </div>
      )}
    </div>
  )
}
