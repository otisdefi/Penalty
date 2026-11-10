import { useState } from 'react'
import { Bot, Globe, Shirt, Swords, Users } from 'lucide-react'
import { JerseyDot } from '@/cosmetics/art'
import type { Jersey } from '@/game/storage'
import { sfx } from '@/game/audio'
import { extractRoomId } from '@/game/peer'
import { useI18n } from '@/i18n'
import { useNetwork } from '@/networks'
import { unlockAudio } from '@/lib/whistle'

interface Props {
  jersey: Jersey
  onCustomize: () => void
  invited: boolean
  onRanked: () => void
  onPractice: () => void
  onHost: () => void
  onJoinInvite: () => void
  /** Join a friend's room from a typed code or pasted link. */
  onJoinCode: (room: string) => void
  onOnline: () => void
}

export function Menu({ jersey, onCustomize, invited, onRanked, onPractice, onHost, onJoinInvite, onJoinCode, onOnline }: Props) {
  const { t, n } = useI18n()
  const net = useNetwork()
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState(false)

  const go = (fn: () => void) => () => {
    unlockAudio()
    sfx.unlock()
    fn()
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--lime)' }}>
          {t('menu.kicker')}
        </p>
        <h1 className="display text-6xl font-extrabold leading-[0.9] text-balance">Tiebreaker</h1>
        <p className="max-w-[34ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>
          {t('menu.tagline', { network: net.name })}
        </p>
      </div>

      <button
        type="button"
        onClick={go(onCustomize)}
        className="panel flex w-full items-center gap-4 p-4 text-left transition active:scale-[0.99]"
        aria-label={t('menu.customizeAria')}
      >
        <svg viewBox="-16 -16 32 32" className="h-20 w-20 shrink-0" aria-hidden>
          <JerseyDot jersey={jersey} number={jersey.number} r={14} fontSize={16} />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
            {t('menu.yourShirt')}
          </span>
          <span className="display block truncate text-3xl font-extrabold leading-none">{jersey.tag || t('menu.number', { n: n(jersey.number) })}</span>
          <span className="mt-1 block text-xs" style={{ color: 'var(--lime)' }}>
            {t('menu.customize')}
          </span>
        </span>
        <Shirt size={22} style={{ color: 'var(--muted)' }} aria-hidden />
      </button>

      <div className="space-y-2">
        {invited && (
          <button type="button" className="btn btn-primary" onClick={go(onJoinInvite)}>
            <Users size={18} /> {t('menu.joinFriend')}
          </button>
        )}
        <button type="button" className={`btn ${invited ? 'btn-ghost' : 'btn-primary'}`} onClick={go(onRanked)}>
          <Swords size={18} /> {t('menu.ranked')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={go(onOnline)}>
          <Globe size={18} /> {t('menu.online')}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost" onClick={go(onPractice)}>
            <Bot size={18} /> {t('menu.practice')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={go(onHost)}>
            <Users size={18} /> {t('menu.playFriend')}
          </button>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const room = extractRoomId(code)
            if (!room) {
              setCodeError(true)
              return
            }
            go(() => onJoinCode(room))()
          }}
        >
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setCodeError(false)
            }}
            placeholder={t('menu.codePlaceholder')}
            aria-label={t('menu.codePlaceholder')}
            aria-invalid={codeError}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="mono h-11 min-w-0 flex-1 rounded-xl border bg-transparent px-3 text-sm"
            style={{ borderColor: codeError ? 'var(--bad)' : 'var(--line)' }}
          />
          <button type="submit" className="btn btn-ghost" style={{ width: 'auto', minHeight: 44 }} disabled={code.trim() === ''}>
            {t('menu.join')}
          </button>
        </form>
        {codeError && (
          <p className="text-xs" style={{ color: 'var(--bad)' }} role="alert">
            {t('menu.codeInvalid')}
          </p>
        )}
        <p className="text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          {t('menu.footnote')}
        </p>
      </div>
    </section>
  )
}
