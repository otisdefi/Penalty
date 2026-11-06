import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useI18n, type MessageKey } from '@/i18n'
import { JerseyDot } from './art'
import { COLORS, PATTERNS } from './catalog'
import { NAME_MAX, tagMessage, tagProblem, trimTag } from './nameFilter'
import { setCosmetics, useCosmetics } from './store'
import { Choice, SectionTitle, Swatch } from './ui'
import type { Jersey } from './types'

/**
 * Shirt colour, pattern, second colour, number and player name. Edits are saved as you go and
 * show up in any preview on the same screen. `disabled` freezes it (for example once you are ready).
 */
export function JerseyEditor({ disabled = false }: { disabled?: boolean }) {
  const { t: tr, n } = useI18n()
  const { jersey } = useCosmetics()
  const [tagDraft, setTagDraft] = useState(jersey.tag ?? '')
  const [tagError, setTagError] = useState<MessageKey | null>(null)

  const setJersey = (patch: Partial<Jersey>) => setCosmetics((cur) => ({ ...cur, jersey: { ...cur.jersey, ...patch } }))

  const onTag = (value: string) => {
    const cleaned = trimTag(value)
    setTagDraft(cleaned)
    const problem = tagProblem(value)
    setTagError(tagMessage(problem))
    setJersey({ tag: problem ? '' : cleaned.trim() })
  }

  return (
    <fieldset disabled={disabled} className="m-0 min-w-0 space-y-5 border-0 p-0" style={{ opacity: disabled ? 0.6 : 1 }}>

          <div>
            <SectionTitle>{tr('cz.mainColor')}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((x) => (
                <Swatch key={x.id} color={x.id} label={tr(x.labelKey)} selected={jersey.color === x.id} onClick={() => setJersey({ color: x.id })} />
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>{tr('cz.pattern')}</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {PATTERNS.map((p) => (
                <Choice key={p.id} selected={(jersey.pattern ?? 'solid') === p.id} label={tr(p.labelKey)} onClick={() => setJersey({ pattern: p.id })}>
                  <svg viewBox="-13 -13 26 26" className="h-9 w-9" aria-hidden>
                    <JerseyDot jersey={{ ...jersey, pattern: p.id }} number={jersey.number} r={12} fontSize={11} />
                  </svg>
                </Choice>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>{tr('cz.secondColor')}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((x) => (
                <Swatch key={x.id} color={x.id} label={tr(x.labelKey)} selected={jersey.secondary === x.id} onClick={() => setJersey({ secondary: x.id })} />
              ))}
            </div>
            {(jersey.pattern ?? 'solid') === 'solid' && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--subtle)' }}>
                {tr('cz.secondHint')}
              </p>
            )}
          </div>

          <div className="space-y-5">
            <div>
              <SectionTitle>{tr('cz.number')}</SectionTitle>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={tr('cz.numberDown')} className="btn btn-ghost" style={{ width: 44, minHeight: 44, padding: 0 }} onClick={() => setJersey({ number: Math.max(1, jersey.number - 1) })}>
                  <Minus size={16} />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  aria-label={tr('cz.numberAria')}
                  value={jersey.number}
                  onChange={(e) => {
                    const v = Math.floor(Number(e.target.value))
                    if (Number.isFinite(v)) setJersey({ number: Math.min(99, Math.max(1, v)) })
                  }}
                  className="display h-11 w-14 rounded-xl border bg-transparent text-center text-2xl font-extrabold tabular-nums"
                  style={{ borderColor: 'var(--line)' }}
                />
                <button type="button" aria-label={tr('cz.numberUp')} className="btn btn-ghost" style={{ width: 44, minHeight: 44, padding: 0 }} onClick={() => setJersey({ number: Math.min(99, jersey.number + 1) })}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div>
              <SectionTitle>{tr('cz.tag', { max: n(NAME_MAX) })}</SectionTitle>
              <input
                type="text"
                maxLength={NAME_MAX}
                value={tagDraft}
                onChange={(e) => onTag(e.target.value)}
                placeholder={tr('cz.optional')}
                autoComplete="off"
                autoCapitalize="words"
                spellCheck={false}
                aria-label={tr('cz.tagAria')}
                aria-invalid={tagError !== null}
                className="h-11 w-full rounded-xl border bg-transparent px-3 text-base font-semibold"
                style={{ borderColor: tagError ? 'var(--bad)' : 'var(--line)' }}
              />
            </div>
          </div>
          {tagError && (
            <p className="text-xs" style={{ color: 'var(--bad)' }} role="alert">
              {tr(tagError)}
            </p>
          )}
          <p className="text-[11px] text-pretty" style={{ color: 'var(--subtle)' }}>
            {tr('cz.tagRules')}
          </p>
            </fieldset>
  )
}
