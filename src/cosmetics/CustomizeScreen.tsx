import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Minus, Plus, Zap } from 'lucide-react'
import Pitch from '@/components/Pitch'
import { TestnetBadge } from '@/components/TestnetBadge'
import type { Kick } from '@/game/logic'
import { BallArt, JerseyDot, STADIUM_PALETTE } from './art'
import { BALLS, COLORS, PATTERNS, STADIUMS, TRAILS } from './catalog'
import { TAG_MAX, tagMessage, tagProblem, trimTag } from './nameFilter'
import { setCosmetics, useCosmetics } from './store'
import { DEFAULT_LOOK, type Jersey, type Look, type StadiumId } from './types'

type Tab = 'jersey' | 'ball' | 'stadium'

const TABS: { id: Tab; label: string }[] = [
  { id: 'jersey', label: 'Jersey' },
  { id: 'ball', label: 'Ball' },
  { id: 'stadium', label: 'Stadium' },
]

const RIVAL: Jersey = { color: '#3a86ff', number: 7, pattern: 'solid', secondary: '#f1f5f9', tag: '' }

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
      {children}
    </p>
  )
}

/** One selectable item. */
function Choice({
  selected,
  label,
  onClick,
  className = '',
  children,
}: {
  selected: boolean
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl p-2 text-center transition active:scale-95 ${className}`}
      style={{
        background: selected ? 'rgba(198,255,61,0.12)' : 'rgba(255,255,255,0.05)',
        boxShadow: selected ? '0 0 0 2px var(--lime)' : 'inset 0 0 0 1px rgba(255,255,255,0.1)',
        cursor: 'pointer',
        minHeight: 44,
      }}
    >
      {children}
      <span className="text-[11px] font-semibold leading-tight">{label}</span>
    </button>
  )
}

function Swatch({ color, label, selected, onClick }: { color: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95"
      style={{
        background: color,
        cursor: 'pointer',
        boxShadow: selected ? '0 0 0 2px var(--bg), 0 0 0 4px var(--lime)' : '0 0 0 1px rgba(255,255,255,0.25)',
      }}
    />
  )
}

export function CustomizeScreen({ onBack }: { onBack: () => void }) {
  const raw = useCosmetics()
  const [tab, setTab] = useState<Tab>('jersey')
  const [kick, setKick] = useState<Kick | null>(null)
  const [tagDraft, setTagDraft] = useState(raw.jersey.tag ?? '')
  const [tagError, setTagError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  const c = raw
  const look: Look = { ...DEFAULT_LOOK, ball: c.ball, trail: c.trail, stadium: c.stadium }
  const jersey = raw.jersey

  const setJersey = (patch: Partial<Jersey>) => setCosmetics((cur) => ({ ...cur, jersey: { ...cur.jersey, ...patch } }))

  const testKick = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setKick({ shooter: 'red', shot: Math.random() < 0.5 ? 0 : 2, dive: 1, goal: true })
    timer.current = window.setTimeout(() => setKick(null), 1800)
  }

  const onTag = (value: string) => {
    const cleaned = trimTag(value)
    setTagDraft(cleaned)
    const problem = tagProblem(value)
    setTagError(tagMessage(problem))
    setJersey({ tag: problem ? '' : cleaned.trim() })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 px-4 pb-10 pt-3">
      <header className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex min-h-[44px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          <ArrowLeft size={16} /> Done
        </button>
        <h1 className="display text-2xl font-extrabold">Customize</h1>
        <TestnetBadge />
      </header>

      <div className="relative mx-auto overflow-hidden rounded-3xl" style={{ border: '1px solid var(--line)', aspectRatio: '320 / 360', width: 'min(100%, calc(34dvh * 320 / 360))' }}>
        <Pitch kick={kick} kits={{ red: c.jersey, blue: RIVAL }} pick={null} role="shoot" shooterTeam="red" myTeam="red" rivalLabel="Opponent" look={look} />
      </div>

      <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={testKick}>
        <Zap size={16} /> Test kick
      </button>

      <div className="grid grid-cols-3 gap-1 rounded-full p-1" role="tablist" style={{ background: 'rgba(255,255,255,0.06)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="rounded-full text-sm font-bold transition"
            style={{ minHeight: 44, background: tab === t.id ? 'var(--lime)' : 'transparent', color: tab === t.id ? 'var(--lime-ink)' : 'var(--ink)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'jersey' && (
        <section className="panel space-y-5 p-4">
          <div>
            <SectionTitle>Main colour</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((x) => (
                <Swatch key={x.id} color={x.id} label={x.label} selected={jersey.color === x.id} onClick={() => setJersey({ color: x.id })} />
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>Pattern</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {PATTERNS.map((p) => (
                <Choice key={p.id} selected={(jersey.pattern ?? 'solid') === p.id} label={p.label} onClick={() => setJersey({ pattern: p.id })}>
                  <svg viewBox="-13 -13 26 26" className="h-9 w-9" aria-hidden>
                    <JerseyDot jersey={{ ...jersey, pattern: p.id }} number={jersey.number} r={12} fontSize={11} />
                  </svg>
                </Choice>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>Secondary colour</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((x) => (
                <Swatch key={x.id} color={x.id} label={x.label} selected={jersey.secondary === x.id} onClick={() => setJersey({ secondary: x.id })} />
              ))}
            </div>
            {(jersey.pattern ?? 'solid') === 'solid' && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--subtle)' }}>
                The secondary colour shows on patterned shirts.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <SectionTitle>Shirt number (1 to 99)</SectionTitle>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Lower number" className="btn btn-ghost" style={{ width: 44, minHeight: 44, padding: 0 }} onClick={() => setJersey({ number: Math.max(1, jersey.number - 1) })}>
                  <Minus size={16} />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  aria-label="Shirt number"
                  value={jersey.number}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value))
                    if (Number.isFinite(n)) setJersey({ number: Math.min(99, Math.max(1, n)) })
                  }}
                  className="display h-11 w-14 rounded-xl border bg-transparent text-center text-2xl font-extrabold tabular-nums"
                  style={{ borderColor: 'var(--line)' }}
                />
                <button type="button" aria-label="Raise number" className="btn btn-ghost" style={{ width: 44, minHeight: 44, padding: 0 }} onClick={() => setJersey({ number: Math.min(99, jersey.number + 1) })}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div>
              <SectionTitle>Name tag (max {TAG_MAX})</SectionTitle>
              <input
                type="text"
                maxLength={TAG_MAX}
                value={tagDraft}
                onChange={(e) => onTag(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-label="Name tag"
                aria-invalid={tagError !== null}
                className="display h-11 w-full rounded-xl border bg-transparent px-3 text-xl font-extrabold uppercase"
                style={{ borderColor: tagError ? 'var(--bad)' : 'var(--line)' }}
              />
            </div>
          </div>
          {tagError && (
            <p className="text-xs" style={{ color: 'var(--bad)' }} role="alert">
              {tagError}
            </p>
          )}
          <p className="text-[11px] text-pretty" style={{ color: 'var(--subtle)' }}>
            Use your own style. Letters, numbers, space, dot, dash and underscore only. No links and no club or player names.
          </p>
        </section>
      )}

      {tab === 'ball' && (
        <section className="panel space-y-5 p-4">
          <div>
            <SectionTitle>Ball design</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {BALLS.map((b) => (
                <Choice key={b.id} selected={raw.ball === b.id} label={b.label} onClick={() => setCosmetics({ ball: b.id })}>
                  <svg viewBox="-10 -10 20 20" className="h-11 w-11" aria-hidden>
                    <BallArt design={b.id} />
                  </svg>
                </Choice>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle>Ball trail</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {TRAILS.map((t) => (
                <Choice key={t.id} selected={raw.trail === t.id} label={t.label} onClick={() => setCosmetics({ trail: t.id })}>
                  <span className="h-1" />
                </Choice>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'stadium' && (
        <section className="panel space-y-3 p-4">
          <SectionTitle>Stadium theme</SectionTitle>
          <p className="text-[11px] text-pretty" style={{ color: 'var(--subtle)' }}>
            In online and friend matches, the home player's stadium is shown to both players.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {STADIUMS.map((s) => (
              <Choice key={s.id} selected={raw.stadium === s.id} label={s.label} onClick={() => setCosmetics({ stadium: s.id })}>
                <StadiumThumb stadium={s.id} />
              </Choice>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function StadiumThumb({ stadium }: { stadium: StadiumId }) {
  const p = STADIUM_PALETTE[stadium]
  return (
    <svg viewBox="0 0 64 40" className="h-10 w-16 overflow-hidden rounded-lg" aria-hidden>
      <rect width="64" height="40" fill={p.grass} />
      <rect y="12" width="64" height="9" fill={p.stripe} />
      <rect y="30" width="64" height="9" fill={p.stripe} />
      <rect width="64" height="7" fill={p.stand} />
      {p.crowd.map((color, i) => (
        <circle key={color + i} cx={8 + i * 15} cy="3.5" r="1.7" fill={color} />
      ))}
      <path d="M12 8V34H52V8" fill="none" stroke={p.line} strokeWidth="1.5" />
    </svg>
  )
}
