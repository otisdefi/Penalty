import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Bot, Swords, Users } from 'lucide-react'
import { SaveResult } from './SaveResult'
import { clearPending, loadPending, saveJersey, type Jersey } from '@/game/storage'
import { sfx } from '@/game/audio'
import { unlockAudio } from '@/lib/whistle'

const COLORS = ['#e5383b', '#ffb703', '#2ec4b6', '#8338ec', '#f1f5f9', '#fb5607', '#06d6a0', '#ff4d9d']

interface Props {
  jersey: Jersey
  onJersey: (j: Jersey) => void
  invited: boolean
  onRanked: () => void
  onPractice: () => void
  onHost: () => void
  onJoinInvite: () => void
}

export function Menu({ jersey, onJersey, invited, onRanked, onPractice, onHost, onJoinInvite }: Props) {
  const { address } = useAccount()
  const [pending, setPending] = useState(loadPending)

  const update = (next: Jersey) => {
    onJersey(next)
    saveJersey(next)
  }
  const go = (fn: () => void) => () => {
    unlockAudio()
    sfx.unlock()
    fn()
  }

  const showPending = pending && (pending.address === '' || pending.address.toLowerCase() === address?.toLowerCase())

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--lime)' }}>
          Penalty shootout
        </p>
        <h1 className="display text-6xl font-extrabold leading-[0.9] text-balance">Tiebreaker</h1>
        <p className="max-w-[34ch] text-pretty text-sm" style={{ color: 'var(--muted)' }}>
          Best of five. Outguess the keeper, then save your result to the Arc Testnet table.
        </p>
      </div>

      {showPending && (
        <div className="panel space-y-3 p-4" style={{ borderColor: 'rgba(198,255,61,0.4)' }}>
          <p className="text-sm font-semibold">You have a ranked {pending.won ? 'win' : 'loss'} that was not saved yet.</p>
          <SaveResult
            won={pending.won}
            onSaved={() => {
              clearPending()
              setPending(null)
            }}
          />
        </div>
      )}

      <div className="panel space-y-4 p-5">
        <div className="flex items-center gap-4">
          <span
            className="display flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-5xl font-extrabold"
            style={{ background: jersey.color, color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.55)', boxShadow: '0 0 0 1px rgba(255,255,255,0.25)' }}
          >
            {jersey.number}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor="shirt" className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
              Shirt number
            </label>
            <input
              id="shirt"
              type="number"
              min={0}
              max={99}
              inputMode="numeric"
              value={jersey.number}
              onChange={(e) => {
                const n = Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0)))
                update({ ...jersey, number: n })
              }}
              className="display h-11 w-24 rounded-xl border bg-transparent px-3 text-2xl font-extrabold tabular-nums"
              style={{ borderColor: 'var(--line)' }}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Shirt colour">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={jersey.color === c}
              aria-label={`Colour ${c}`}
              onClick={() => update({ ...jersey, color: c })}
              className="h-11 w-11 rounded-full transition active:scale-95"
              style={{
                background: c,
                boxShadow: jersey.color === c ? '0 0 0 2px var(--bg), 0 0 0 4px var(--lime)' : '0 0 0 1px rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {invited && (
          <button type="button" className="btn btn-primary" onClick={go(onJoinInvite)}>
            <Users size={18} /> Join your friend's match
          </button>
        )}
        <button type="button" className={`btn ${invited ? 'btn-ghost' : 'btn-primary'}`} onClick={go(onRanked)}>
          <Swords size={18} /> Ranked match vs bot
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost" onClick={go(onPractice)}>
            <Bot size={18} /> Practice
          </button>
          <button type="button" className="btn btn-ghost" onClick={go(onHost)}>
            <Users size={18} /> Play a friend
          </button>
        </div>
        <p className="text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          Ranked results can be saved onchain after the final whistle. Friend matches are for fun and are not saved.
        </p>
      </div>
    </section>
  )
}
