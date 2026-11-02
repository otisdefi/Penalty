import { useEffect, useState } from 'react'
import type { Dir, Kick, Team } from '../game/logic'
import type { Jersey } from '../game/storage'
import { textOn, YELLOW } from '../lib/color'

interface Props {
  kick: Kick | null
  kits: Record<Team, Jersey>
  /** The zone the local player has locked in (aim or dive), shown as a ring. */
  pick: Dir | null
  role: 'shoot' | 'dive'
  shooterTeam: Team
  /** The local player's team, used to place the YOU tag. */
  myTeam: Team
}

/** Close-up of the penalty area: goal at the top, spot and shooter in the lower third. */
export const PITCH_W = 320
export const PITCH_H = 360

const GOAL = { x: 84, y: 8, w: 152, h: 40 } // goal line sits at y = 48
const ZONE_X = [109, 160, 211] as const
const KEEPER = { x: 160, y: 72 }
const BALL = { x: 160, y: 262 }
const SHOOTER = { x: 160, y: 314 }
const DIVE_DX = 51

function YouTag({ y }: { y: number }) {
  return (
    <g transform={`translate(0 ${y})`} pointerEvents="none">
      <rect x="-16" y="0" width="32" height="14" rx="3.5" fill={YELLOW} />
      <text x="0" y="10.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="#0a1530" letterSpacing="0.8">
        YOU
      </text>
    </g>
  )
}

function Glove() {
  return (
    <g stroke="#0a1530" strokeWidth="1.2" strokeLinejoin="round" transform="scale(1.9)">
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

export default function Pitch({ kick, kits, pick, role, shooterTeam, myTeam }: Props) {
  const iShoot = shooterTeam === myTeam
  const [deflectedKick, setDeflectedKick] = useState<Kick | null>(null)

  useEffect(() => {
    if (!kick || kick.goal) return
    const id = window.setTimeout(() => setDeflectedKick(kick), 480)
    return () => window.clearTimeout(id)
  }, [kick])

  const deflect = kick !== null && !kick.goal && deflectedKick === kick

  const keeperTeam: Team = shooterTeam === 'red' ? 'blue' : 'red'
  const shooterKit = kits[shooterTeam]
  const keeperKit = kits[keeperTeam]

  const zoneX = kick ? ZONE_X[kick.shot] : BALL.x
  const ballTarget = !kick
    ? { x: BALL.x, y: BALL.y, s: 1 }
    : kick.goal
      ? { x: zoneX, y: 26, s: 0.7 }
      : deflect
        ? { x: zoneX + (kick.shot === 0 ? -38 : kick.shot === 2 ? 38 : (kick.dive === 0 ? 1 : -1) * 34), y: 118, s: 0.9 }
        : { x: zoneX, y: 78, s: 0.8 }
  const ballMs = !kick ? 0 : deflect ? 320 : 430

  const dive = kick ? kick.dive : 1
  const kx = KEEPER.x + (kick ? (dive - 1) * DIVE_DX : 0)
  const krot = kick ? (dive - 1) * 28 : 0
  const kdelay = kick ? 90 : 0

  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className="block h-full w-full"
      role="img"
      aria-label="Penalty area close-up, goal at the top and the penalty spot at the bottom"
    >
      <defs>
        <pattern id="net" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 0H8M0 0V8" stroke="rgba(255,255,255,0.38)" strokeWidth="0.8" fill="none" />
        </pattern>
        <radialGradient id="vignette" cx="50%" cy="55%" r="78%">
          <stop offset="62%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(3,10,25,0.5)" />
        </radialGradient>
      </defs>

      {/* grass with mowing stripes */}
      <rect width={PITCH_W} height={PITCH_H} fill="#1d7a3c" />
      {[0, 2, 4, 6, 8].map((i) => (
        <rect key={i} y={i * 40} width={PITCH_W} height="40" fill="#228a44" />
      ))}

      {/* penalty area markings only: end line, boxes, spot and arc */}
      <g fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.2">
        <path d="M0 48H320" />
        <path d="M16 48V292H304V48" />
        <path d="M58 48V98H262V48" />
        <path d="M97 292A70 70 0 0 0 223 292" />
      </g>
      <circle cx={BALL.x} cy={BALL.y} r="3" fill="rgba(255,255,255,0.9)" />

      {/* goal */}
      <rect x={GOAL.x} y={GOAL.y} width={GOAL.w} height={GOAL.h} fill="url(#net)" />
      <rect x={GOAL.x} y={GOAL.y} width={GOAL.w} height={GOAL.h} fill="rgba(255,255,255,0.07)" />
      <path d={`M${GOAL.x} ${GOAL.y + GOAL.h}V${GOAL.y}H${GOAL.x + GOAL.w}V${GOAL.y + GOAL.h}`} fill="none" stroke="#fff" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />

      {/* aim / dive zones */}
      {ZONE_X.map((x, i) => {
        const active = pick === i
        const scored = kick?.goal && kick.shot === i
        return (
          <rect
            key={i}
            x={x - 23}
            y="12"
            width="46"
            height="33"
            rx="4"
            fill={scored ? 'rgba(198,255,61,0.45)' : active ? 'rgba(198,255,61,0.28)' : 'rgba(255,255,255,0.05)'}
            stroke={active ? '#c6ff3d' : 'rgba(255,255,255,0.22)'}
            strokeWidth={active ? 2.5 : 1.2}
            strokeDasharray={active ? undefined : '4 3'}
          />
        )
      })}
      {pick !== null && !kick && (
        <text x={ZONE_X[pick]} y="33" textAnchor="middle" fontSize="11" fontWeight="800" fill="#c6ff3d" letterSpacing="1.2">
          {role === 'shoot' ? 'AIM' : 'DIVE'}
        </text>
      )}

      {/* keeper, just in front of the goal line */}
      <g style={{ transform: `translate(${kx}px, ${KEEPER.y}px)`, transition: kick ? `transform 330ms ${ease} ${kdelay}ms` : 'none' }}>
        <g style={{ transform: `rotate(${krot}deg)`, transition: kick ? `transform 330ms ${ease} ${kdelay}ms` : 'none' }}>
          <ellipse cx="0" cy="5" rx="30" ry="12" fill="rgba(0,0,0,0.28)" />
          {deflect ? (
            <Glove />
          ) : (
            <g transform="scale(1.9)">
              <ellipse cx="0" cy="0" rx="13" ry="8" fill={keeperKit.color} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
              <circle cx="0" cy="3" r="5.5" fill="#f1c7a0" stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" />
              <circle cx="-17" cy="4" r="4.8" fill="#ffd23f" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
              <circle cx="17" cy="4" r="4.8" fill="#ffd23f" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
            </g>
          )}
        </g>
        {!iShoot && <YouTag y={deflect ? 34 : 24} />}
      </g>

      {/* shooter, directly behind the ball inside the penalty arc */}
      <g
        style={{
          transform: `translate(${kick ? SHOOTER.x + 8 : SHOOTER.x}px, ${kick ? SHOOTER.y - 26 : SHOOTER.y}px)`,
          transition: kick ? 'transform 260ms ease-out' : 'none',
        }}
      >
        <g transform="scale(1.75)">
          <ellipse cx="0" cy="3" rx="16" ry="9" fill="rgba(0,0,0,0.28)" />
          <ellipse cx="0" cy="0" rx="14" ry="9" fill={shooterKit.color} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
          <circle cx="0" cy="-6" r="5.5" fill="#3b2a20" stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" />
          <text x="0" y="4.5" textAnchor="middle" fontSize="10" fontWeight="800" fill={textOn(shooterKit.color)} style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            {shooterKit.number}
          </text>
        </g>
        {!kick && <ellipse cx="0" cy="0" rx="36" ry="22" fill="none" stroke={YELLOW} strokeWidth="2.2" strokeDasharray="5 4" />}
        {iShoot && <YouTag y={26} />}
      </g>

      {/* ball */}
      <g style={{ transform: `translate(${ballTarget.x}px, ${ballTarget.y}px)`, transition: kick ? `transform ${ballMs}ms ${ease}` : 'none' }}>
        <g style={{ transform: `scale(${ballTarget.s})`, transition: kick ? `transform ${ballMs}ms ${ease}` : 'none' }}>
          <g transform="scale(1.45)">
            <ellipse cx="1" cy="3" rx="6" ry="3" fill="rgba(0,0,0,0.3)" />
            <circle r="6.5" fill="#fff" stroke="#0a1530" strokeWidth="0.9" />
            <polygon points="0,-3 2.9,-0.9 1.8,2.4 -1.8,2.4 -2.9,-0.9" fill="#0a1530" />
          </g>
        </g>
      </g>

      <rect width={PITCH_W} height={PITCH_H} fill="url(#vignette)" pointerEvents="none" />
    </svg>
  )
}
