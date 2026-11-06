import { useEffect, useState } from 'react'
import type { Dir, Kick, Team } from '../game/logic'
import type { Jersey } from '../game/storage'
import { YELLOW } from '../lib/color'
import { BallArt, JerseyDot, STADIUM_PALETTE, StadiumBackground, StadiumOverlay, TrailPuff } from '../cosmetics/art'
import { DEFAULT_LOOK, type Look } from '../cosmetics/types'
import { useI18n } from '../i18n'

interface Props {
  kick: Kick | null
  kits: Record<Team, Jersey>
  /** The zone the local player has locked in (aim or dive), shown as a ring. */
  pick: Dir | null
  role: 'shoot' | 'dive'
  shooterTeam: Team
  /** The local player's team, used to place the YOU tag. */
  myTeam: Team
  /** Short label under the opponent's circle, such as "Bot" or a shortened wallet address. */
  rivalLabel?: string
  /** Ball design, trail and stadium for the local view. */
  look?: Look
}

/** Close-up of the penalty area: goal at the top, spot and shooter in the lower third. */
export const PITCH_W = 320
export const PITCH_H = 360

const GOAL = { x: 84, y: 8, w: 152, h: 40 } // goal line sits at y = 48
const ZONE_X = [109, 160, 211] as const
/** Both players are small circles, about 1/8 of the goal width across. */
const R = 10
const KEEPER = { x: 160, y: 60 }
const BALL = { x: 160, y: 262 }
const SHOOTER = { x: 160, y: 290 }
const DIVE_DX = 51

function PlayerDot({ jersey, number, acting }: { jersey: Jersey; number: number | string; acting?: boolean }) {
  return (
    <g>
      <JerseyDot jersey={jersey} number={number} r={R} />
      {acting && <circle r={R + 3.5} fill="none" stroke={YELLOW} strokeWidth="1.4" />}
    </g>
  )
}

function Label({ mine, text, you }: { mine: boolean; text: string; you: string }) {
  const w = Math.max(22, 8 + you.length * 5.6)
  return (
    <g transform={`translate(0 ${R + 5})`} pointerEvents="none">
      {mine ? (
        <>
          <rect x={-w / 2} y="0" width={w} height="10" rx="2.5" fill={YELLOW} />
          <text x="0" y="7.6" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#0a1530" letterSpacing="0.6">
            {you}
          </text>
        </>
      ) : (
        <text x="0" y="8" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="rgba(255,255,255,0.85)" letterSpacing="0.4">
          {text}
        </text>
      )}
    </g>
  )
}

/** Small glove icon, shown only while a shot is being saved. */
function Glove() {
  return (
    <g stroke="#0a1530" strokeWidth="1.1" strokeLinejoin="round" transform="scale(0.62)">
      <rect x="-8" y="-5" width="16" height="15" rx="5" fill={YELLOW} />
      <rect x="-8.5" y="-15" width="4" height="13" rx="2" fill={YELLOW} />
      <rect x="-3.5" y="-17" width="4" height="15" rx="2" fill={YELLOW} />
      <rect x="1.5" y="-16" width="4" height="14" rx="2" fill={YELLOW} />
      <rect x="6" y="-12" width="3.6" height="10" rx="1.8" fill={YELLOW} />
      <rect x="-13" y="-2" width="7" height="4.2" rx="2.1" fill={YELLOW} transform="rotate(-28 -9 0)" />
      <rect x="-9" y="9" width="18" height="6" rx="2" fill="#ffffff" />
    </g>
  )
}

const ease = 'cubic-bezier(0.15, 0.75, 0.35, 1)'

export default function Pitch({ kick, kits, pick, role, shooterTeam, myTeam, rivalLabel, look = DEFAULT_LOOK }: Props) {
  const { t } = useI18n()
  const rival = rivalLabel ?? t('rival.opponent')
  const pal = STADIUM_PALETTE[look.stadium]
  const iShoot = shooterTeam === myTeam
  const [deflectedKick, setDeflectedKick] = useState<Kick | null>(null)

  useEffect(() => {
    if (!kick || kick.goal) return
    const id = window.setTimeout(() => setDeflectedKick(kick), 480)
    return () => window.clearTimeout(id)
  }, [kick])

  const saved = kick !== null && !kick.goal && deflectedKick === kick

  const keeperTeam: Team = shooterTeam === 'red' ? 'blue' : 'red'
  const shooterKit = kits[shooterTeam]
  const keeperKit = kits[keeperTeam]

  const zoneX = kick ? ZONE_X[kick.shot] : BALL.x
  const ballTarget = !kick
    ? { x: BALL.x, y: BALL.y, s: 1 }
    : kick.goal
      ? { x: zoneX, y: 22, s: 0.7 }
      : saved
        ? { x: zoneX + (kick.shot === 0 ? -38 : kick.shot === 2 ? 38 : (kick.dive === 0 ? 1 : -1) * 34), y: 112, s: 0.9 }
        : { x: zoneX, y: 70, s: 0.85 }
  const ballMs = !kick ? 0 : saved ? 320 : 430

  const dive = kick ? kick.dive : 1
  const kx = KEEPER.x + (kick ? (dive - 1) * DIVE_DX : 0)
  const kdelay = kick ? 90 : 0
  const scored = kick?.goal === true

  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className="block h-full w-full"
      role="img"
      aria-label={t('pitch.aria')}
    >
      <defs>
        <pattern id="net" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 0H8M0 0V8" stroke="rgba(255,255,255,0.38)" strokeWidth="0.8" fill="none" />
        </pattern>
        <radialGradient id="vignette" cx="50%" cy="55%" r="78%">
          <stop offset="62%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor={`rgba(3,10,25,${pal.vignette})`} />
        </radialGradient>
      </defs>

      {/* grass, mowing stripes and crowd for the chosen stadium */}
      <StadiumBackground stadium={look.stadium} w={PITCH_W} h={PITCH_H} />

      {/* penalty area markings only: end line, boxes, spot and arc */}
      <g fill="none" stroke={pal.line} strokeWidth="2.2">
        <path d="M0 48H320" />
        <path d="M16 48V292H304V48" />
        <path d="M58 48V98H262V48" />
        <path d="M97 292A70 70 0 0 0 223 292" />
      </g>
      <circle cx={BALL.x} cy={BALL.y} r="3" fill={pal.line} />

      {/* goal: the net ripples when a shot goes in */}
      <g className={scored ? 'net-ripple' : undefined} style={{ transformOrigin: `${GOAL.x + GOAL.w / 2}px ${GOAL.y}px` }}>
        <rect x={GOAL.x} y={GOAL.y} width={GOAL.w} height={GOAL.h} fill="url(#net)" />
        <rect x={GOAL.x} y={GOAL.y} width={GOAL.w} height={GOAL.h} fill="rgba(255,255,255,0.07)" />
      </g>
      <path d={`M${GOAL.x} ${GOAL.y + GOAL.h}V${GOAL.y}H${GOAL.x + GOAL.w}V${GOAL.y + GOAL.h}`} fill="none" stroke="#fff" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />

      <StadiumOverlay stadium={look.stadium} w={PITCH_W} h={PITCH_H} />

      {/* aim / dive zones */}
      {ZONE_X.map((x, i) => {
        const active = pick === i
        const goalHere = kick?.goal && kick.shot === i
        return (
          <rect
            key={i}
            x={x - 23}
            y="12"
            width="46"
            height="33"
            rx="4"
            fill={goalHere ? 'rgba(198,255,61,0.45)' : active ? 'rgba(198,255,61,0.28)' : 'rgba(255,255,255,0.05)'}
            stroke={active ? '#c6ff3d' : 'rgba(255,255,255,0.22)'}
            strokeWidth={active ? 2.5 : 1.2}
            strokeDasharray={active ? undefined : '4 3'}
          />
        )
      })}
      {pick !== null && !kick && (
        <text x={ZONE_X[pick]} y="33" textAnchor="middle" fontSize="11" fontWeight="800" fill="#c6ff3d" letterSpacing="1.2">
          {role === 'shoot' ? t('pitch.aim') : t('pitch.dive')}
        </text>
      )}

      {/* goalkeeper: numbered circle on the goal line, slides to the chosen side */}
      <g style={{ transform: `translate(${kx}px, ${KEEPER.y}px)`, transition: kick ? `transform 330ms ${ease} ${kdelay}ms` : 'none' }}>
        <PlayerDot jersey={keeperKit} number={1} />
        <Label mine={!iShoot} text={keeperKit.tag || rival} you={t('you')} />
        {saved && (
          <g transform="translate(16 -9)">
            <Glove />
          </g>
        )}
      </g>

      {/* shooter: numbered circle just behind the ball, ringed while it is their turn */}
      <g
        style={{
          transform: `translate(${kick ? SHOOTER.x + 4 : SHOOTER.x}px, ${kick ? SHOOTER.y - 16 : SHOOTER.y}px)`,
          transition: kick ? 'transform 260ms ease-out' : 'none',
        }}
      >
        <PlayerDot jersey={shooterKit} number={shooterKit.number} acting />
        <Label mine={iShoot} text={shooterKit.tag || rival} you={t('you')} />
      </g>

      {/* ball trail: ghosts that follow the ball and fade out */}
      {look.trail !== 'none' &&
        [0, 1, 2, 3, 4].map((i) => (
          <g
            key={i}
            className={kick ? 'trail-fade' : undefined}
            style={{
              opacity: kick ? undefined : 0,
              transform: `translate(${ballTarget.x}px, ${ballTarget.y}px)`,
              transition: kick ? `transform ${ballMs + (i + 1) * 70}ms ${ease}` : 'none',
            }}
          >
            <TrailPuff trail={look.trail} i={i} />
          </g>
        ))}

      {/* ball */}
      <g style={{ transform: `translate(${ballTarget.x}px, ${ballTarget.y}px)`, transition: kick ? `transform ${ballMs}ms ${ease}` : 'none' }}>
        <g style={{ transform: `scale(${ballTarget.s})`, transition: kick ? `transform ${ballMs}ms ${ease}` : 'none' }}>
          <g transform="scale(1.2)">
            <ellipse cx="1" cy="3" rx="6" ry="3" fill="rgba(0,0,0,0.3)" />
            <BallArt design={look.ball} />
          </g>
        </g>
      </g>

      <rect width={PITCH_W} height={PITCH_H} fill="url(#vignette)" pointerEvents="none" />
    </svg>
  )
}
