import { Check, Timer, X } from 'lucide-react'
import { CHOICE_SECONDS, REGULATION, type Status, type Team } from '@/game/logic'
import type { Jersey } from '@/game/storage'
import { textOn, YELLOW } from '@/lib/color'

interface Props {
  status: Status
  kicksTaken: number
  kits: Record<Team, Jersey>
  myTeam: Team
  rivalName: string
  shooterTeam: Team
  done: boolean
  choosing: boolean
  secondsLeft: number
}

function Circle({ result, next }: { result: boolean | undefined; next: boolean }) {
  if (result === undefined) {
    return (
      <span
        className="h-6 w-6 shrink-0 rounded-full"
        style={{
          boxShadow: next ? `inset 0 0 0 2px ${YELLOW}` : 'inset 0 0 0 1.5px rgba(255,255,255,0.22)',
        }}
      />
    )
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
      style={{ background: result ? 'var(--good)' : 'var(--bad)', color: '#06210f' }}
      role="img"
      aria-label={result ? 'Goal' : 'Miss'}
    >
      {result ? <Check size={14} strokeWidth={3.5} /> : <X size={14} strokeWidth={3.5} color="#2b0509" />}
    </span>
  )
}

function Row({ team, kit, name, isMe, acting, results, slots, score, nextIndex }: {
  team: Team
  kit: Jersey
  name: string
  isMe: boolean
  acting: boolean
  results: boolean[]
  slots: number
  score: number
  nextIndex: number
}) {
  return (
    <div
      data-team={team}
      className="flex items-center gap-2 rounded-2xl px-2.5 py-1.5 transition-colors"
      style={{
        background: acting ? 'rgba(255,210,63,0.10)' : 'rgba(255,255,255,0.04)',
        boxShadow: acting ? `inset 0 0 0 2px ${YELLOW}` : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
      }}
    >
      <span
        className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold"
        style={{ background: kit.color, color: textOn(kit.color), boxShadow: '0 0 0 1px rgba(255,255,255,0.25)' }}
      >
        {kit.number}
      </span>
      <div className="w-[76px] shrink-0 space-y-0.5">
        <div className="flex items-center gap-1">
          <span className="truncate text-[11px] font-bold uppercase tracking-[0.06em]">{name}</span>
          {isMe && (
            <span className="rounded px-1 py-px text-[9px] font-extrabold tracking-[0.06em]" style={{ background: YELLOW, color: '#0a1530' }}>
              YOU
            </span>
          )}
        </div>
        <p className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: acting ? YELLOW : 'var(--subtle)' }}>
          {acting ? 'Shooting' : 'Keeper'}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {Array.from({ length: slots }, (_, i) => (
          <Circle key={i} result={results[i]} next={acting && i === nextIndex} />
        ))}
      </div>
      <span className="display w-8 shrink-0 text-right text-3xl font-extrabold tabular-nums">{score}</span>
    </div>
  )
}

export function Scoreboard({ status, kicksTaken, kits, myTeam, rivalName, shooterTeam, done, choosing, secondsLeft }: Props) {
  const suddenDeath = kicksTaken >= REGULATION * 2
  const round = Math.floor(kicksTaken / 2) + 1
  const title = done ? 'Full time' : suddenDeath ? `Sudden death · Round ${round}` : `Round ${round} of ${REGULATION}`
  const names: Record<Team, string> = {
    red: myTeam === 'red' ? 'Player' : rivalName,
    blue: myTeam === 'blue' ? 'Player' : rivalName,
  }
  const results: Record<Team, boolean[]> = { red: status.redKicks, blue: status.blueKicks }

  return (
    <div className="panel space-y-1.5 p-2.5" style={{ borderRadius: 20 }}>
      <div className="flex items-center justify-between px-1">
        <p className="display text-lg font-extrabold leading-none">{title}</p>
        <span
          className="display flex items-center gap-1 text-2xl font-extrabold leading-none tabular-nums"
          style={{ color: YELLOW, opacity: choosing ? 1 : 0.35 }}
          aria-label={choosing ? `${secondsLeft} seconds left` : 'Timer paused'}
        >
          <Timer size={16} />
          {choosing ? secondsLeft : CHOICE_SECONDS}
        </span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} aria-hidden>
        <div
          className="h-full rounded-full"
          style={{
            background: YELLOW,
            width: `${choosing ? (secondsLeft / CHOICE_SECONDS) * 100 : 100}%`,
            transition: 'width 1s linear',
            opacity: choosing ? 1 : 0.3,
          }}
        />
      </div>
      {(['red', 'blue'] as const).map((t) => (
        <Row
          key={t}
          team={t}
          kit={kits[t]}
          name={names[t]}
          isMe={t === myTeam}
          acting={!done && t === shooterTeam}
          results={results[t]}
          slots={status.slots}
          score={status[t]}
          nextIndex={results[t].length}
        />
      ))}
    </div>
  )
}
