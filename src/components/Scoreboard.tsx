import { Avatar } from '@/avatar/Avatar'
import { Check, Timer, X } from 'lucide-react'
import { CHOICE_SECONDS, REGULATION, type Status, type Team } from '@/game/logic'
import type { Jersey } from '@/game/storage'
import { textOn, YELLOW } from '@/lib/color'
import { formatNumber, useI18n, type TFunction } from '@/i18n'

interface Props {
  status: Status
  kicksTaken: number
  kits: Record<Team, Jersey>
  myTeam: Team
  /** Display name of each team's player. */
  names: Record<Team, string>
  shooterTeam: Team
  done: boolean
  choosing: boolean
  secondsLeft: number
  /** Length of the countdown in seconds (defaults to the offline 10 seconds). */
  totalSeconds?: number
  /** Usernames of verified account holders per team; their round picture replaces the number badge. */
  avatars?: Partial<Record<Team, string>>
}

function Circle({ result, next, t }: { result: boolean | undefined; next: boolean; t: TFunction }) {
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
      aria-label={result ? t('sb.goal') : t('sb.miss')}
    >
      {result ? <Check size={14} strokeWidth={3.5} /> : <X size={14} strokeWidth={3.5} color="#2b0509" />}
    </span>
  )
}

function Row({ team, kit, name, avatar, isMe, acting, results, slots, score, nextIndex, t }: {
  t: TFunction
  avatar?: string
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
      {avatar ? (
        <Avatar username={avatar} size={36} />
      ) : (
        <span
          className="display flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold"
          style={{ background: kit.color, color: textOn(kit.color), boxShadow: '0 0 0 1px rgba(255,255,255,0.25)' }}
        >
          {formatNumber(kit.number)}
        </span>
      )}
      <div className="w-[88px] shrink-0 space-y-0.5">
        <p className="truncate text-[12px] font-bold leading-tight" title={name}>
          {name}
        </p>
        <div className="flex items-center gap-1">
          {isMe && (
            <span className="rounded px-1 py-px text-[9px] font-extrabold tracking-[0.06em]" style={{ background: YELLOW, color: '#0a1530' }}>
              {t('you')}
            </span>
          )}
          <span className="truncate text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: acting ? YELLOW : 'var(--subtle)' }}>
            {acting ? t('sb.shooting') : t('sb.keeper')}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {Array.from({ length: slots }, (_, i) => (
          <Circle key={i} result={results[i]} next={acting && i === nextIndex} t={t} />
        ))}
      </div>
      <span className="display w-8 shrink-0 text-right text-3xl font-extrabold tabular-nums">{formatNumber(score)}</span>
    </div>
  )
}

export function Scoreboard({ status, kicksTaken, kits, myTeam, names, shooterTeam, done, choosing, secondsLeft, totalSeconds = CHOICE_SECONDS, avatars }: Props) {
  const { t, n } = useI18n()
  const suddenDeath = kicksTaken >= REGULATION * 2
  const round = Math.floor(kicksTaken / 2) + 1
  const title = done ? t('sb.fullTime') : suddenDeath ? t('sb.suddenDeath', { round: n(round) }) : t('sb.round', { round: n(round), total: n(REGULATION) })
  const results: Record<Team, boolean[]> = { red: status.redKicks, blue: status.blueKicks }

  return (
    <div className="panel space-y-1.5 p-2.5" style={{ borderRadius: 20 }}>
      <div className="flex items-center justify-between px-1">
        <p className="display text-lg font-extrabold leading-none">{title}</p>
        <span
          className="display flex items-center gap-1 text-2xl font-extrabold leading-none tabular-nums"
          style={{ color: YELLOW, opacity: choosing ? 1 : 0.35 }}
          aria-label={choosing ? t('sb.secondsLeft', { s: n(secondsLeft) }) : t('sb.timerPaused')}
        >
          <Timer size={16} />
          {n(choosing ? secondsLeft : totalSeconds)}
        </span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} aria-hidden>
        <div
          className="h-full rounded-full"
          style={{
            background: YELLOW,
            width: `${choosing ? (Math.min(secondsLeft, totalSeconds) / totalSeconds) * 100 : 100}%`,
            transition: 'width 1s linear',
            opacity: choosing ? 1 : 0.3,
          }}
        />
      </div>
      {(['red', 'blue'] as const).map((tm) => (
        <Row
          key={tm}
          team={tm}
          kit={kits[tm]}
          name={names[tm]}
          avatar={avatars?.[tm]}
          isMe={tm === myTeam}
          acting={!done && tm === shooterTeam}
          results={results[tm]}
          slots={status.slots}
          score={status[tm]}
          nextIndex={results[tm].length}
          t={t}
        />
      ))}
    </div>
  )
}
