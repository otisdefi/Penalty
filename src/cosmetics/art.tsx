import { useId } from 'react'
import { textOn } from '@/lib/color'
import type { BallDesign, Jersey, StadiumId, TrailId } from './types'

const safeId = (raw: string) => raw.replace(/[^a-zA-Z0-9]/g, '')

/* ---------------- jersey ---------------- */

/** A numbered circle in the player's colours, drawn around (0, 0). */
export function JerseyDot({ jersey, number, r = 10, fontSize = 11.5 }: { jersey: Jersey; number: number | string; r?: number; fontSize?: number }) {
  const id = `jd${safeId(useId())}`
  const sec = jersey.secondary ?? '#f1f5f9'
  const ink = textOn(jersey.color)
  const outline = ink === '#ffffff' ? 'rgba(10,21,48,0.85)' : 'rgba(255,255,255,0.9)'
  const band = r * 0.3
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <circle r={r} />
        </clipPath>
      </defs>
      <circle r={r} fill={jersey.color} />
      <g clipPath={`url(#${id})`} fill={sec}>
        {jersey.pattern === 'stripes' &&
          [-0.7, -0.15, 0.4].map((x) => <rect key={x} x={r * x} y={-r} width={band} height={r * 2} />)}
        {jersey.pattern === 'hoops' &&
          [-0.7, -0.15, 0.4].map((y) => <rect key={y} x={-r} y={r * y} width={r * 2} height={band} />)}
        {jersey.pattern === 'half' && <rect x="0" y={-r} width={r} height={r * 2} />}
        {jersey.pattern === 'sash' && <rect x={-r * 2} y={-r * 0.24} width={r * 4} height={r * 0.48} transform="rotate(-45)" />}
      </g>
      <circle r={r} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
      <text
        x="0"
        y={fontSize * 0.34}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="800"
        fill={ink}
        stroke={outline}
        strokeWidth="2.2"
        strokeLinejoin="round"
        paintOrder="stroke"
        style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
      >
        {number}
      </text>
    </g>
  )
}

/* ---------------- ball ---------------- */

const PENTAGON = '0,-3 2.9,-0.9 1.8,2.4 -1.8,2.4 -2.9,-0.9'

/** One ball drawn around (0, 0) with radius 6.5. */
export function BallArt({ design }: { design: BallDesign }) {
  const id = `ba${safeId(useId())}`
  switch (design) {
    case 'neon':
      return (
        <g>
          <circle r="8.4" fill="none" stroke="rgba(198,255,61,0.5)" strokeWidth="1.6" />
          <circle r="6.5" fill="#c6ff3d" stroke="#0a1530" strokeWidth="0.9" />
          <polygon points={PENTAGON} fill="#0a1530" />
          <path d="M-6 0Q0 -4 6 0" fill="none" stroke="#0a1530" strokeWidth="0.8" />
        </g>
      )
    case 'gold':
      return (
        <g>
          <defs>
            <radialGradient id={id} cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor="#fff3b0" />
              <stop offset="55%" stopColor="#f2b705" />
              <stop offset="100%" stopColor="#a87400" />
            </radialGradient>
          </defs>
          <circle r="6.5" fill={`url(#${id})`} stroke="#7a5200" strokeWidth="0.9" />
          <polygon points={PENTAGON} fill="#7a5200" />
        </g>
      )
    case 'night':
      return (
        <g>
          <circle r="7.6" fill="none" stroke="rgba(96,165,250,0.45)" strokeWidth="1.4" />
          <circle r="6.5" fill="#0d1b3a" stroke="#60a5fa" strokeWidth="1" />
          <polygon points={PENTAGON} fill="#60a5fa" />
        </g>
      )
    case 'retro':
      return (
        <g>
          <circle r="6.5" fill="#f5ecd7" stroke="#5b3a1e" strokeWidth="0.9" />
          <path d="M-6.4 -1.4Q0 -4.5 6.4 -1.4M-6.4 1.8Q0 -1.2 6.4 1.8M0 -6.5V6.5" fill="none" stroke="#8a5a2b" strokeWidth="0.8" />
          <circle r="1.5" fill="#8a5a2b" />
        </g>
      )
    case 'camo':
      return (
        <g>
          <defs>
            <clipPath id={id}>
              <circle r="6.5" />
            </clipPath>
          </defs>
          <circle r="6.5" fill="#6b7f3a" />
          <g clipPath={`url(#${id})`}>
            <ellipse cx="-2.5" cy="-2" rx="3.2" ry="2.2" fill="#3b4d1f" />
            <ellipse cx="3" cy="2.5" rx="3.4" ry="2.2" fill="#3b4d1f" />
            <ellipse cx="2.5" cy="-3.2" rx="2.4" ry="1.6" fill="#a3b06a" />
            <ellipse cx="-3" cy="3.4" rx="2.6" ry="1.7" fill="#a3b06a" />
            <ellipse cx="0" cy="0.3" rx="1.7" ry="1.2" fill="#2a3516" />
          </g>
          <circle r="6.5" fill="none" stroke="#1f2a12" strokeWidth="0.9" />
        </g>
      )
    default:
      return (
        <g>
          <circle r="6.5" fill="#fff" stroke="#0a1530" strokeWidth="0.9" />
          <polygon points={PENTAGON} fill="#0a1530" />
        </g>
      )
  }
}

const SPARK_COLORS = ['#ffd23f', '#ffffff', '#ffb703', '#fff3b0', '#ffd23f']
const RAINBOW = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93']

/** One ghost of the ball trail (index 0 is closest to the ball). */
export function TrailPuff({ trail, i }: { trail: TrailId; i: number }) {
  if (trail === 'sparks') return <circle r={2.2 - i * 0.25} cx={i % 2 ? 3 : -3} cy={i % 2 ? -2 : 2} fill={SPARK_COLORS[i % SPARK_COLORS.length]} />
  if (trail === 'smoke') return <circle r={4.4 + i * 0.5} fill="rgba(210,220,232,0.42)" />
  if (trail === 'rainbow') return <circle r={4.6 - i * 0.5} fill={RAINBOW[i % RAINBOW.length]} opacity="0.9" />
  return null
}

/* ---------------- stadium ---------------- */

export interface StadiumPalette {
  label: string
  grass: string
  stripe: string
  line: string
  stand: string
  crowd: readonly string[]
  /** Darkness of the vignette around the penalty area. */
  vignette: number
}

export const STADIUM_PALETTE: Record<StadiumId, StadiumPalette> = {
  day: { label: 'Day grass', grass: '#1d7a3c', stripe: '#228a44', line: 'rgba(255,255,255,0.82)', stand: '#1f3a5f', crowd: ['#f87171', '#fbbf24', '#60a5fa', '#f1f5f9'], vignette: 0.45 },
  night: { label: 'Night lights', grass: '#0e5a2d', stripe: '#126a36', line: 'rgba(225,242,255,0.9)', stand: '#0a1226', crowd: ['#93c5fd', '#c4b5fd', '#fde68a', '#e2e8f0'], vignette: 0.7 },
  rain: { label: 'Rainy', grass: '#2b6747', stripe: '#31734f', line: 'rgba(225,238,245,0.72)', stand: '#243247', crowd: ['#94a3b8', '#cbd5e1', '#7dd3fc', '#64748b'], vignette: 0.55 },
  sunset: { label: 'Sunset', grass: '#2f7a3c', stripe: '#378845', line: 'rgba(255,241,221,0.85)', stand: '#3b2145', crowd: ['#fb923c', '#f472b6', '#fde68a', '#fca5a5'], vignette: 0.5 },
  snow: { label: 'Snow', grass: '#d3e2ec', stripe: '#e3eef5', line: 'rgba(52,104,160,0.8)', stand: '#415a77', crowd: ['#60a5fa', '#f87171', '#1e293b', '#fde68a'], vignette: 0.3 },
}

/** Deterministic crowd so the dots do not jump between renders. */
const CROWD = Array.from({ length: 56 }, (_, i) => ({ x: 3 + i * 5.7, y: 1.6 + ((i * 7) % 3) * 1.9, c: i % 4 }))

export function StadiumBackground({ stadium, w, h }: { stadium: StadiumId; w: number; h: number }) {
  const p = STADIUM_PALETTE[stadium]
  return (
    <g>
      <rect width={w} height={h} fill={p.grass} />
      {[0, 2, 4, 6, 8].map((i) => (
        <rect key={i} y={i * 40} width={w} height="40" fill={p.stripe} />
      ))}
      <rect width={w} height="7" fill={p.stand} />
      {CROWD.map((d) => (
        <circle key={d.x} cx={d.x} cy={d.y} r="1.35" fill={p.crowd[d.c]} opacity={stadium === 'night' ? 0.8 : 1} />
      ))}
    </g>
  )
}

const RAIN = Array.from({ length: 18 }, (_, i) => ({ x: (i * 37) % 330, delay: ((i * 53) % 90) / 100 }))
const SNOW = Array.from({ length: 20 }, (_, i) => ({ x: (i * 43) % 320, r: 1 + (i % 3) * 0.5, delay: ((i * 71) % 100) / 20, dur: 4.5 + (i % 4) }))

/** Lighting and weather drawn over the grass but under the vignette. */
export function StadiumOverlay({ stadium, w, h }: { stadium: StadiumId; w: number; h: number }) {
  const id = `so${safeId(useId())}`
  switch (stadium) {
    case 'night':
      return (
        <g pointerEvents="none">
          <defs>
            <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff8d6" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#fff8d6" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}r`} x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff8d6" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#fff8d6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width={w} height={h} fill="rgba(2,10,32,0.3)" />
          <polygon points={`0,0 ${w * 0.62},0 0,${h * 0.8}`} fill={`url(#${id}l)`} />
          <polygon points={`${w},0 ${w * 0.38},0 ${w},${h * 0.8}`} fill={`url(#${id}r)`} />
        </g>
      )
    case 'rain':
      return (
        <g pointerEvents="none">
          <rect width={w} height={h} fill="rgba(25,45,80,0.2)" />
          {RAIN.map((d) => (
            <path key={d.x} className="rain-drop" d={`M${d.x} 0l-3 9`} stroke="rgba(205,225,255,0.55)" strokeWidth="1" style={{ animationDelay: `${-d.delay}s` }} />
          ))}
        </g>
      )
    case 'sunset':
      return (
        <g pointerEvents="none">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff8a3d" stopOpacity="0.42" />
              <stop offset="55%" stopColor="#ff8a3d" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#6d2a7a" stopOpacity="0.28" />
            </linearGradient>
          </defs>
          <rect width={w} height={h} fill={`url(#${id})`} />
        </g>
      )
    case 'snow':
      return (
        <g pointerEvents="none">
          <rect width={w} height={h} fill="rgba(210,230,255,0.12)" />
          {SNOW.map((d) => (
            <circle key={d.x} className="snow-flake" cx={d.x} cy="0" r={d.r} fill="#ffffff" opacity="0.9" style={{ animationDelay: `${-d.delay}s`, animationDuration: `${d.dur}s` }} />
          ))}
        </g>
      )
    default:
      return null
  }
}
