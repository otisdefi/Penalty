import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import { ArrowLeft, Loader2, Volume2, VolumeX } from 'lucide-react'
import Pitch from '@/components/Pitch'
import { Scoreboard } from '@/components/Scoreboard'
import { penaltyMatchAbi } from './abi'
import { MATCH_ADDRESS, ONLINE_CHAIN_ID, STEP_TIMEOUT_S } from './config'
import { STATUS, ZERO_ADDRESS, kickFlags, sameAddress, slotsFor } from './helpers'
import { OnlineLobby } from './OnlineLobby'
import { useOnlineMatch } from './useOnlineMatch'
import { loadStored } from './storage'
import type { Jersey } from '@/game/storage'
import { useCosmetics } from '@/cosmetics/store'
import type { Look } from '@/cosmetics/types'
import { useCosmeticSync } from './useCosmeticSync'
import type { Status, Team } from '@/game/logic'
import { setMuted as setAudioMuted, sfx } from '@/game/audio'
import { isMuted, setMuted as setWhistleMuted } from '@/lib/whistle'
import { shortAddress } from '@/lib/errors'
import { textOn, YELLOW } from '@/lib/color'
import { buildTxExplorerUrl, requireChain } from '@/onchain-facts'

interface Props {
  matchId: bigint
  onExit: () => void
}

const SHOOT_LABELS = ['LEFT', 'CENTER', 'RIGHT'] as const
const KEEP_LABELS = ['DIVE LEFT', 'STAY', 'DIVE RIGHT'] as const
const RIVAL_JERSEY: Jersey = { color: '#3a86ff', number: 7 }

export function OnlineMatchScreen({ matchId, onExit }: Props) {
  const o = useOnlineMatch(matchId)
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: ONLINE_CHAIN_ID })
  const [muted, setMutedState] = useState(isMuted)
  const mine = useCosmetics()
  const jersey = mine.jersey
  const { m, stage } = o
  const myJersey = jersey
  const rivalAddr = m ? (o.mySeat === 2 ? m.p1 : m.p2) : undefined
  const sync = useCosmeticSync({
    matchId,
    seat: o.mySeat,
    selfAddress: address,
    rivalAddress: rivalAddr && rivalAddr !== ZERO_ADDRESS ? rivalAddr : undefined,
    jersey: myJersey,
    stadium: mine.stadium,
    enabled: !!m && m.status === STATUS.Active,
  })
  // Own ball and trail; the home player's stadium is shown to both players.
  const look: Look = { ball: mine.ball, trail: mine.trail, stadium: o.mySeat === 2 ? (sync.homeStadium ?? mine.stadium) : mine.stadium }

  useEffect(() => () => sfx.stopAll(), [])

  const toggleMute = () => {
    const next = !muted
    setMutedState(next)
    setWhistleMuted(next)
    setAudioMuted(next)
    if (!next) sfx.pick()
  }

  const finished = stage === 'finished'
  const isWinner = !!m && !!address && sameAddress(m.winner, address)
  const draw = !!m && finished && sameAddress(m.winner, '0x0000000000000000000000000000000000000000')

  const forfeit = useQuery({
    queryKey: ['pm-forfeit', matchId.toString()],
    enabled: finished && !!publicClient && !!MATCH_ADDRESS && !!m,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      if (!publicClient || !MATCH_ADDRESS || !m) return null
      const logs = await publicClient.getContractEvents({
        address: MATCH_ADDRESS,
        abi: penaltyMatchAbi,
        eventName: 'MatchFinished',
        args: { id: matchId },
        fromBlock: m.createdBlock,
        toBlock: 'latest',
      })
      const last = logs[logs.length - 1]
      return last ? { forfeit: last.args.forfeit === true, tx: last.transactionHash } : null
    },
  })

  const record = useQuery({
    queryKey: ['pm-record', address, finished],
    enabled: finished && !!m?.ranked && !!address && !!publicClient && !!MATCH_ADDRESS,
    queryFn: async () => {
      if (!publicClient || !MATCH_ADDRESS || !address) return null
      return publicClient.readContract({ address: MATCH_ADDRESS, abi: penaltyMatchAbi, functionName: 'getRecord', args: [address] })
    },
  })

  if (!MATCH_ADDRESS) {
    return <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge="Online"><Notice text="Online play is not configured." /></Shell>
  }
  if (!m) {
    return (
      <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge="Online">
        <Notice text={o.loadError ? 'Could not load this match. Check your connection.' : 'Loading the match...'} busy={!o.loadError} />
      </Shell>
    )
  }

  const badge = m.ranked ? 'Online · Ranked' : 'Online · Private'

  if (stage === 'missing') return <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={badge}><Notice text="This match does not exist." action="Back" onAction={onExit} /></Shell>
  if (stage === 'cancelled') return <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={badge}><Notice text="This room was cancelled." action="Back" onAction={onExit} /></Shell>

  if (stage === 'open') {
    return (
      <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={badge}>
        <OnlineLobby
          matchId={matchId}
          m={m}
          roomCode={loadStored(matchId)?.roomCode}
          chainNow={o.chainNow}
          busy={o.busy}
          error={o.error}
          onCancel={() => void o.cancel().then(onExit)}
        />
      </Shell>
    )
  }

  // Active or finished: the pitch.
  const flags = kickFlags(m)
  const status: Status = {
    red: m.score1,
    blue: m.score2,
    redKicks: flags.red,
    blueKicks: flags.blue,
    slots: slotsFor(m.kicks),
    winner: null,
  }
  const kits: Record<Team, Jersey> = o.myTeam === 'red' ? { red: myJersey, blue: distinct(myJersey, sync.rival) } : { red: distinct(myJersey, sync.rival), blue: myJersey }
  const shooterTeam: Team = o.anim ? o.anim.shooter : o.shooterTeam
  const iShoot = shooterTeam === o.myTeam
  const labels = iShoot ? SHOOT_LABELS : KEEP_LABELS
  const canPick = stage === 'choose' && !o.anim && !o.busy
  const timerOn = stage === 'choose' || stage === 'committed' || stage === 'reveal' || stage === 'revealed'
  const myKit = kits[o.myTeam]
  const rivalAddress = o.mySeat === 2 ? m.p1 : m.p2
  const rivalLabel = o.mySeat !== 0 && rivalAddress !== ZERO_ADDRESS ? shortAddress(rivalAddress) : 'Opponent'
  const showResult = finished && !o.anim

  return (
    <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={badge}>
      <Scoreboard
        status={status}
        kicksTaken={m.kicks}
        kits={kits}
        myTeam={o.myTeam}
        rivalName="Opponent"
        shooterTeam={shooterTeam}
        done={finished}
        choosing={timerOn}
        secondsLeft={Math.max(0, Math.ceil(o.remaining))}
        totalSeconds={STEP_TIMEOUT_S}
      />

      <div
        className="relative mx-auto overflow-hidden rounded-3xl"
        style={{ border: '1px solid var(--line)', aspectRatio: '320 / 360', width: 'min(100%, calc(48dvh * 320 / 360))' }}
      >
        <Pitch kick={o.anim} kits={kits} pick={o.pick} role={iShoot ? 'shoot' : 'dive'} shooterTeam={shooterTeam} myTeam={o.myTeam} rivalLabel={rivalLabel} look={look} />
        {o.anim && (
          <div
            key={m.kicks}
            className="banner pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 py-1.5 text-center"
            style={{ background: 'rgba(6,13,31,0.8)', borderBlock: `2px solid ${o.anim.goal ? YELLOW : '#ffffff'}` }}
            role="status"
          >
            <span className="display text-6xl font-extrabold leading-none tracking-wider" style={{ color: o.anim.goal ? YELLOW : '#ffffff' }}>
              {o.anim.goal ? 'GOAL' : 'SAVED'}
            </span>
          </div>
        )}
      </div>

      {!showResult && !finished && (
        <div className="space-y-1.5">
          <StatusLine stage={stage} iShoot={iShoot} busy={o.busy} usingKey={o.usingKey} />
          <div className="grid grid-cols-3 gap-2">
            {([0, 1, 2] as const).map((d) => {
              const picked = o.pick === d
              const dimmed = o.pick !== null && !picked
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!canPick}
                  onClick={() => void o.commitMove(d)}
                  aria-pressed={picked}
                  className="btn"
                  style={{
                    minHeight: 56,
                    padding: '0 8px',
                    background: picked ? YELLOW : myKit.color,
                    color: picked ? '#0a1530' : textOn(myKit.color),
                    opacity: dimmed ? 0.3 : canPick || picked ? 1 : 0.55,
                    boxShadow: picked ? '0 0 0 3px rgba(255,210,63,0.35)' : 'inset 0 0 0 1px rgba(255,255,255,0.25)',
                  }}
                >
                  <span className="display text-lg font-extrabold leading-tight tracking-wider">{labels[d]}</span>
                </button>
              )
            })}
          </div>

          {stage === 'reveal' && !o.usingKey && (
            <button type="button" className="btn btn-primary" disabled={!!o.busy} onClick={() => void o.reveal()}>
              {o.busy === 'reveal' ? <Loader2 size={16} className="animate-spin" /> : null}
              Reveal my move
            </button>
          )}
          {stage === 'reveal' && o.usingKey && o.error && (
            <button type="button" className="btn btn-primary" disabled={!!o.busy} onClick={() => void o.reveal()}>
              Retry reveal
            </button>
          )}

          {(stage === 'expired-win' || stage === 'expired-late' || stage === 'expired-none') && (
            <div className="panel space-y-2 p-3 text-center">
              <p className="text-sm font-semibold text-pretty">
                {stage === 'expired-win'
                  ? 'Your opponent missed the 20 second deadline. You can claim the match by forfeit.'
                  : stage === 'expired-late'
                    ? 'You missed the 20 second deadline, so your opponent wins by forfeit. Settle the match to continue.'
                    : 'Neither player moved in time. Close this match to free your wallet.'}
              </p>
              <button type="button" className="btn btn-primary" disabled={!!o.busy} onClick={() => void o.claim()}>
                {o.busy === 'claim' ? <Loader2 size={16} className="animate-spin" /> : null}
                {stage === 'expired-win' ? 'Claim win by forfeit' : stage === 'expired-late' ? 'Settle match' : 'Close match'}
              </button>
            </div>
          )}

          {o.error && (
            <p className="text-center text-xs" style={{ color: 'var(--bad)' }}>
              {o.error}
            </p>
          )}
          {stage === 'spectator' && <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>You are watching. Only the two players can move.</p>}
        </div>
      )}

      {showResult && (
        <div className="panel space-y-3 p-4 text-center">
          <p className="display text-4xl font-extrabold" style={{ color: draw ? 'var(--muted)' : isWinner ? 'var(--good)' : 'var(--bad)' }}>
            {draw ? 'No winner' : isWinner ? 'You win' : o.mySeat === 0 ? 'Match over' : 'You lose'} {o.mySeat === 2 ? `${m.score2}-${m.score1}` : `${m.score1}-${m.score2}`}
          </p>
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            {forfeit.data?.forfeit
              ? isWinner
                ? 'Your opponent ran out of time, so the win was awarded by forfeit.'
                : 'The match ended by forfeit after a missed deadline.'
              : draw
                ? 'Neither player moved in time, or the match stayed level after the maximum number of kicks. No record changed.'
                : 'Settled by the shootout.'}
          </p>
          {m.ranked && record.data && (
            <p className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
              Your verified record: {record.data[0]} wins, {record.data[1]} losses, streak {record.data[2]} (best {record.data[3]})
            </p>
          )}
          {forfeit.data?.tx && (
            <a href={buildTxExplorerUrl(ONLINE_CHAIN_ID, forfeit.data.tx)} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline" style={{ color: 'var(--lime)' }}>
              View final transaction
            </a>
          )}
          <Sweep o={o} />
          <button type="button" className="btn btn-primary" onClick={onExit}>
            Back to online menu
          </button>
        </div>
      )}
    </Shell>
  )
}

/** The opponent's shirt (or a default until theirs arrives), kept visibly different from mine. */
function distinct(mine: Jersey, theirs: Jersey | null): Jersey {
  const base = theirs ?? RIVAL_JERSEY
  return mine.color.toLowerCase() === base.color.toLowerCase() ? { ...base, color: base.color.toLowerCase() === '#ffd23f' ? '#3a86ff' : '#ffd23f' } : base
}

function Sweep({ o }: { o: ReturnType<typeof useOnlineMatch> }) {
  const decimals = requireChain(ONLINE_CHAIN_ID).nativeCurrency.decimals
  if (!o.myKeyRegistered || o.keyBalance <= 0n) return null
  const amount = Number(formatUnits(o.keyBalance, decimals))
  if (amount < 0.01) return null
  return (
    <button type="button" className="btn btn-ghost" disabled={!!o.busy} onClick={() => void o.sweep()}>
      {o.busy === 'sweep' ? <Loader2 size={16} className="animate-spin" /> : null}
      Return {amount.toFixed(2)} USDC from the helper key
    </button>
  )
}

function StatusLine({ stage, iShoot, busy, usingKey }: { stage: string; iShoot: boolean; busy: string | null; usingKey: boolean }) {
  let text = ''
  if (busy === 'commit') text = usingKey ? 'Locking in your move...' : 'Confirm in your wallet to lock in your move...'
  else if (busy === 'reveal') text = 'Revealing your move...'
  else if (busy === 'claim') text = 'Settling the match...'
  else if (stage === 'choose') text = iShoot ? 'You are the shooter. Pick where to shoot.' : 'You are the goalkeeper. Pick where to dive.'
  else if (stage === 'committed') text = 'Move locked in. Waiting for your opponent to commit...'
  else if (stage === 'reveal') text = usingKey ? 'Both moves are locked. Revealing yours...' : 'Both moves are locked. Reveal yours to continue.'
  else if (stage === 'revealed') text = 'Revealed. Waiting for your opponent to reveal...'
  else if (stage === 'deadline') text = 'Deadline reached. Confirming on the chain...'
  else if (stage === 'expired-win' || stage === 'expired-late' || stage === 'expired-none') text = 'Deadline passed.'
  return (
    <p className="min-h-[18px] text-[13px] font-semibold" aria-live="polite">
      {text}
    </p>
  )
}

function Notice({ text, busy, action, onAction }: { text: string; busy?: boolean; action?: string; onAction?: () => void }) {
  return (
    <div className="panel space-y-3 p-5 text-center">
      <p className="flex items-center justify-center gap-2 text-sm">
        {busy && <Loader2 size={15} className="animate-spin" />}
        {text}
      </p>
      {action && onAction && (
        <button type="button" className="btn btn-primary" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  )
}

function Shell({ children, onExit, muted, onMute, badge }: { children: React.ReactNode; onExit: () => void; muted: boolean; onMute: () => void; badge: string }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-2 px-4 pb-3 pt-1">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onExit} className="flex min-h-[40px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          <ArrowLeft size={16} /> Leave
        </button>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--lime)' }}>
          {badge}
        </span>
        <button type="button" onClick={onMute} aria-label={muted ? 'Unmute' : 'Mute'} className="flex h-10 w-10 items-center justify-center" style={{ color: 'var(--muted)' }}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>
      {children}
    </div>
  )
}

