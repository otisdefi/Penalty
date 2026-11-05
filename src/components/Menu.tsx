import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Bot, Globe, Shirt, Swords, Users } from 'lucide-react'
import { JerseyDot } from '@/cosmetics/art'
import { SaveResult } from './SaveResult'
import { clearPending, loadPending, type Jersey } from '@/game/storage'
import { sfx } from '@/game/audio'
import { unlockAudio } from '@/lib/whistle'

interface Props {
  jersey: Jersey
  onCustomize: () => void
  invited: boolean
  onRanked: () => void
  onPractice: () => void
  onHost: () => void
  onJoinInvite: () => void
  onOnline: () => void
}

export function Menu({ jersey, onCustomize, invited, onRanked, onPractice, onHost, onJoinInvite, onOnline }: Props) {
  const { address } = useAccount()
  const [pending, setPending] = useState(loadPending)

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

      <button
        type="button"
        onClick={go(onCustomize)}
        className="panel flex w-full items-center gap-4 p-4 text-left transition active:scale-[0.99]"
        aria-label="Customize your shirt, ball and stadium"
      >
        <svg viewBox="-16 -16 32 32" className="h-20 w-20 shrink-0" aria-hidden>
          <JerseyDot jersey={jersey} number={jersey.number} r={14} fontSize={16} />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
            Your shirt
          </span>
          <span className="display block truncate text-3xl font-extrabold leading-none">{jersey.tag || `No. ${jersey.number}`}</span>
          <span className="mt-1 block text-xs" style={{ color: 'var(--lime)' }}>
            Customize shirt, ball and stadium
          </span>
        </span>
        <Shirt size={22} style={{ color: 'var(--muted)' }} aria-hidden />
      </button>

      <div className="space-y-2">
        {invited && (
          <button type="button" className="btn btn-primary" onClick={go(onJoinInvite)}>
            <Users size={18} /> Join your friend's match
          </button>
        )}
        <button type="button" className={`btn ${invited ? 'btn-ghost' : 'btn-primary'}`} onClick={go(onRanked)}>
          <Swords size={18} /> Ranked match vs bot
        </button>
        <button type="button" className="btn btn-ghost" onClick={go(onOnline)}>
          <Globe size={18} /> Online match (two wallets, onchain)
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
