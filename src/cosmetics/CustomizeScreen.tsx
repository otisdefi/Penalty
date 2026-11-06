import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Zap } from 'lucide-react'
import Pitch from '@/components/Pitch'
import { TestnetBadge } from '@/components/TestnetBadge'
import { LanguageButton } from '@/components/LanguageButton'
import { useI18n } from '@/i18n'
import type { Kick } from '@/game/logic'
import { BallArt, STADIUM_PALETTE } from './art'
import { JerseyEditor } from './JerseyEditor'
import { displayName } from './identity'
import { Choice, SectionTitle } from './ui'
import { BALLS, STADIUMS, TRAILS } from './catalog'
import { setCosmetics, useCosmetics } from './store'
import { DEFAULT_LOOK, type Jersey, type Look, type StadiumId } from './types'

type Tab = 'jersey' | 'ball' | 'stadium'

const TABS = [
  { id: 'jersey', labelKey: 'cz.tab.jersey' },
  { id: 'ball', labelKey: 'cz.tab.ball' },
  { id: 'stadium', labelKey: 'cz.tab.stadium' },
] as const

const RIVAL: Jersey = { color: '#3a86ff', number: 7, pattern: 'solid', secondary: '#f1f5f9', tag: '' }

export function CustomizeScreen({ onBack }: { onBack: () => void }) {
  const { t: tr } = useI18n()
  const raw = useCosmetics()
  const [tab, setTab] = useState<Tab>('jersey')
  const [kick, setKick] = useState<Kick | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  const c = raw
  const look: Look = { ...DEFAULT_LOOK, ball: c.ball, trail: c.trail, stadium: c.stadium }

  const testKick = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setKick({ shooter: 'red', shot: Math.random() < 0.5 ? 0 : 2, dive: 1, goal: true })
    timer.current = window.setTimeout(() => setKick(null), 1800)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 px-4 pb-10 pt-3">
      <header className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex min-h-[44px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          <ArrowLeft size={16} /> {tr('cz.done')}
        </button>
        <h1 className="display min-w-0 truncate text-2xl font-extrabold">{tr('cz.title')}</h1>
        <div className="flex items-center gap-1">
          <LanguageButton />
          <TestnetBadge />
        </div>
      </header>

      <div className="relative mx-auto overflow-hidden rounded-3xl" style={{ border: '1px solid var(--line)', aspectRatio: '320 / 360', width: 'min(100%, calc(34dvh * 320 / 360))' }}>
        <Pitch kick={kick} kits={{ red: c.jersey, blue: RIVAL }} pick={null} role="shoot" shooterTeam="red" myTeam="red" names={{ red: displayName(c.jersey.tag), blue: tr('rival.opponent') }} look={look} />
      </div>

      <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={testKick}>
        <Zap size={16} /> {tr('cz.testKick')}
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
            {tr(t.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'jersey' && (
        <section className="panel p-4">
          <JerseyEditor />
        </section>
      )}

      {tab === 'ball' && (
        <section className="panel space-y-5 p-4">
          <div>
            <SectionTitle>{tr('cz.ballDesign')}</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {BALLS.map((b) => (
                <Choice key={b.id} selected={raw.ball === b.id} label={tr(b.labelKey)} onClick={() => setCosmetics({ ball: b.id })}>
                  <svg viewBox="-10 -10 20 20" className="h-11 w-11" aria-hidden>
                    <BallArt design={b.id} />
                  </svg>
                </Choice>
              ))}
            </div>
          </div>
          <div>
            <SectionTitle>{tr('cz.ballTrail')}</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {TRAILS.map((tl) => (
                <Choice key={tl.id} selected={raw.trail === tl.id} label={tr(tl.labelKey)} onClick={() => setCosmetics({ trail: tl.id })}>
                  <span className="h-1" />
                </Choice>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'stadium' && (
        <section className="panel space-y-3 p-4">
          <SectionTitle>{tr('cz.stadiumTheme')}</SectionTitle>
          <p className="text-[11px] text-pretty" style={{ color: 'var(--subtle)' }}>
            {tr('cz.stadiumNote')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {STADIUMS.map((s) => (
              <Choice key={s.id} selected={raw.stadium === s.id} label={tr(s.labelKey)} onClick={() => setCosmetics({ stadium: s.id })}>
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
