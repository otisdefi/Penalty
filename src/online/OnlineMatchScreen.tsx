import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import { ArrowLeft, Loader2, Volume2, VolumeX } from 'lucide-react'
import Pitch from '@/components/Pitch'
import { Scoreboard } from '@/components/Scoreboard'
import { useAuth } from '../chat/account'
import { penaltyMatchAbi } from './abi'
import { STEP_TIMEOUT_S } from './config'
import { NETWORKS, explorerTxUrl, matchChannel, type NetworkConfig, type NetworkId } from '../networks'
import { coinFormat } from '@/lib/coin'
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
import { LanguageButton } from '@/components/LanguageButton'
import { InlineChat } from '@/chat/InlineChat'
import { displayName } from '@/cosmetics/identity'
import { colorLabelKey, resolveKits } from '@/cosmetics/kits'
import { useI18n, type TFunction } from '@/i18n'

interface Props {
  matchId: bigint
  /** The network this match lives on, fixed when it was opened: both players are on the same one. */
  network: NetworkId
  /** The other player's username when this match came from a challenge (so it is verified). */
  peerUsername?: string
  onExit: () => void
}

const SHOOT_LABELS = ['match.shoot.left', 'match.shoot.center', 'match.shoot.right'] as const
const KEEP_LABELS = ['match.keep.left', 'match.keep.stay', 'match.keep.right'] as const
const RIVAL_JERSEY: Jersey = { color: '#3a86ff', number: 7, pattern: 'solid', secondary: '#f1f5f9', tag: '' }

export function OnlineMatchScreen({ matchId, network, peerUsername, onExit }: Props) {
  const { t, n } = useI18n()
  const net = NETWORKS[network]
  const matchAddress = net.matchAddress
  const auth = useAuth()
  const myUsername = auth.status === 'in' ? auth.user?.username : undefined
  const o = useOnlineMatch(matchId, net)
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: net.chainId })
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
    queryKey: ['pm-forfeit', net.id, matchId.toString()],
    enabled: finished && !!publicClient && !!matchAddress && !!m,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      if (!publicClient || !matchAddress || !m) return null
      const logs = await publicClient.getContractEvents({
        address: matchAddress,
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
    queryKey: ['pm-record', net.id, address, finished],
    enabled: finished && !!m?.ranked && !!address && !!publicClient && !!matchAddress,
    queryFn: async () => {
      if (!publicClient || !matchAddress || !address) return null
      return publicClient.readContract({ address: matchAddress, abi: penaltyMatchAbi, functionName: 'getRecord', args: [address] })
    },
  })

  if (!matchAddress) {
    return <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={t('online.badge')}><Notice text={t('online.notConfiguredShort')} /></Shell>
  }
  if (!m) {
    return (
      <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={t('online.badge')}>
        <Notice text={o.loadError ? t('online.loadError') : t('online.loading')} busy={!o.loadError} />
      </Shell>
    )
  }

  const badge = `${m.ranked ? t('online.badgeRanked') : t('online.badgePrivate')} · ${net.name}`

  if (stage === 'missing') return <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={badge}><Notice text={t('online.missing')} action={t('common.back')} onAction={onExit} /></Shell>
  if (stage === 'cancelled') return <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={badge}><Notice text={t('online.cancelled')} action={t('common.back')} onAction={onExit} /></Shell>

  if (stage === 'open') {
    return (
      <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={badge}>
        <OnlineLobby
          matchId={matchId}
          net={net}
          m={m}
          roomCode={loadStored(net.id, matchId)?.roomCode}
          chainNow={o.chainNow}
          busy={o.busy}
          error={o.error}
          onCancel={() => void o.cancel().then(onExit)}
        />
        <InlineChat channel={matchChannel(net, matchId)} title="chat.title.match" />
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
  // The home player (red) keeps their colour; if both picked the same, the away player is shown in a contrasting one.
  const rivalJersey = sync.rival ?? RIVAL_JERSEY
  const resolved = o.mySeat === 2 ? resolveKits(rivalJersey, myJersey) : resolveKits(myJersey, rivalJersey)
  const kits: Record<Team, Jersey> = { red: resolved.host, blue: resolved.guest }
  const myName = displayName(myJersey.tag, address)
  const rivalName = sync.rival?.tag || (o.mySeat !== 0 && rivalAddr && rivalAddr !== ZERO_ADDRESS ? shortAddress(rivalAddr) : t('rival.opponent'))
  const names: Record<Team, string> = o.myTeam === 'red' ? { red: myName, blue: rivalName } : { red: rivalName, blue: myName }
  const guestColorKey = colorLabelKey(resolved.guest.color)
  const shooterTeam: Team = o.anim ? o.anim.shooter : o.shooterTeam
  const iShoot = shooterTeam === o.myTeam
  const labels = iShoot ? SHOOT_LABELS : KEEP_LABELS
  const canPick = stage === 'choose' && !o.anim && !o.busy
  const timerOn = stage === 'choose' || stage === 'committed' || stage === 'reveal' || stage === 'revealed'
  const myKit = kits[o.myTeam]
  const showResult = finished && !o.anim

  return (
    <Shell onExit={onExit} muted={muted} onMute={toggleMute} badge={badge}>
      <Scoreboard
        status={status}
        kicksTaken={m.kicks}
        kits={kits}
        myTeam={o.myTeam}
        names={names}
        avatars={{ [o.myTeam]: myUsername, [o.myTeam === 'red' ? 'blue' : 'red']: peerUsername }}
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
        <Pitch kick={o.anim} kits={kits} pick={o.pick} role={iShoot ? 'shoot' : 'dive'} shooterTeam={shooterTeam} myTeam={o.myTeam} names={names} look={look} />
        {o.anim && (
          <div
            key={m.kicks}
            className="banner pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 py-1.5 text-center"
            style={{ background: 'rgba(6,13,31,0.8)', borderBlock: `2px solid ${o.anim.goal ? YELLOW : '#ffffff'}` }}
            role="status"
          >
            <span className="display block truncate px-2 font-extrabold leading-none tracking-wider" style={{ color: o.anim.goal ? YELLOW : '#ffffff', fontSize: (o.anim.goal ? t('banner.goal') : t('banner.saved')).length > 6 ? 44 : 60 }}>
              {o.anim.goal ? t('banner.goal') : t('banner.saved')}
            </span>
          </div>
        )}
      </div>

      {resolved.recolored && !finished && (
        <p className="text-center text-[11px]" style={{ color: 'var(--yellow)' }} role="status">
          {t('ready.sameColor', { color: guestColorKey ? t(guestColorKey) : '' })}
        </p>
      )}

      {!showResult && !finished && (
        <div className="space-y-1.5">
          <StatusLine stage={stage} iShoot={iShoot} busy={o.busy} usingKey={o.usingKey} t={t} />
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
                  <span className="display text-[17px] font-extrabold leading-tight tracking-wide">{t(labels[d])}</span>
                </button>
              )
            })}
          </div>

          {stage === 'reveal' && !o.usingKey && (
            <button type="button" className="btn btn-primary" disabled={!!o.busy} onClick={() => void o.reveal()}>
              {o.busy === 'reveal' ? <Loader2 size={16} className="animate-spin" /> : null}
              {t('online.revealMove')}
            </button>
          )}
          {stage === 'reveal' && o.usingKey && o.error && (
            <button type="button" className="btn btn-primary" disabled={!!o.busy} onClick={() => void o.reveal()}>
              {t('online.retryReveal')}
            </button>
          )}

          {(stage === 'expired-win' || stage === 'expired-late' || stage === 'expired-none') && (
            <div className="panel space-y-2 p-3 text-center">
              <p className="text-sm font-semibold text-pretty">
                {stage === 'expired-win'
                  ? t('online.expiredWin', { s: n(STEP_TIMEOUT_S) })
                  : stage === 'expired-late'
                    ? t('online.expiredLate', { s: n(STEP_TIMEOUT_S) })
                    : t('online.expiredNone')}
              </p>
              <button type="button" className="btn btn-primary" disabled={!!o.busy} onClick={() => void o.claim()}>
                {o.busy === 'claim' ? <Loader2 size={16} className="animate-spin" /> : null}
                {stage === 'expired-win' ? t('online.claimWin') : stage === 'expired-late' ? t('online.settle') : t('online.close')}
              </button>
            </div>
          )}

          {o.error && (
            <p className="text-center text-xs" style={{ color: 'var(--bad)' }}>
              {o.error}
            </p>
          )}
          {stage === 'spectator' && <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>{t('online.watching')}</p>}
        </div>
      )}

      {showResult && (
        <div className="panel space-y-3 p-4 text-center">
          <p className="display text-4xl font-extrabold" style={{ color: draw ? 'var(--muted)' : isWinner ? 'var(--good)' : 'var(--bad)' }}>
            {draw ? t('online.noWinner') : isWinner ? t('match.youWin') : o.mySeat === 0 ? t('online.matchOver') : t('match.youLose')} {o.mySeat === 2 ? `${n(m.score2)}-${n(m.score1)}` : `${n(m.score1)}-${n(m.score2)}`}
          </p>
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--muted)' }}>
            {o.mySeat === 2 ? `${names.blue} ${n(m.score2)} - ${n(m.score1)} ${names.red}` : `${names.red} ${n(m.score1)} - ${n(m.score2)} ${names.blue}`}
          </p>
          <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            {forfeit.data?.forfeit
              ? isWinner
                ? t('online.forfeitWin')
                : t('online.forfeitEnd')
              : draw
                ? t('online.drawNote')
                : t('online.settledNote')}
          </p>
          {m.ranked && record.data && (
            <p className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
              {t('online.record', { w: n(record.data[0]), l: n(record.data[1]), s: n(record.data[2]), b: n(record.data[3]) })}
            </p>
          )}
          {forfeit.data?.tx && (
            <a href={explorerTxUrl(net, forfeit.data.tx)} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline" style={{ color: 'var(--lime)' }}>
              {t('online.viewFinal')}
            </a>
          )}
          <Sweep o={o} net={net} />
          <button type="button" className="btn btn-primary" onClick={onExit}>
            {t('online.backMenu')}
          </button>
        </div>
      )}
      <InlineChat channel={`match:${matchId.toString()}`} title="chat.title.match" />
    </Shell>
  )
}

function Sweep({ o, net }: { o: ReturnType<typeof useOnlineMatch>; net: NetworkConfig }) {
  const { t, n } = useI18n()
  const decimals = net.chain.nativeCurrency.decimals
  if (!o.myKeyRegistered || o.keyBalance <= 0n) return null
  const amount = Number(formatUnits(o.keyBalance, decimals))
  if (amount < net.minSweep) return null
  return (
    <button type="button" className="btn btn-ghost" disabled={!!o.busy} onClick={() => void o.sweep()}>
      {o.busy === 'sweep' ? <Loader2 size={16} className="animate-spin" /> : null}
      {t('online.sweep', { amount: n(amount, coinFormat(amount)), token: net.gasSymbol })}
    </button>
  )
}

function StatusLine({ stage, iShoot, busy, usingKey, t }: { stage: string; iShoot: boolean; busy: string | null; usingKey: boolean; t: TFunction }) {
  let text = ''
  if (busy === 'commit') text = usingKey ? t('online.locking') : t('online.lockingWallet')
  else if (busy === 'reveal') text = t('online.revealing')
  else if (busy === 'claim') text = t('online.settling')
  else if (stage === 'choose') text = iShoot ? t('match.promptShoot') : t('match.promptKeep')
  else if (stage === 'committed') text = t('online.committed')
  else if (stage === 'reveal') text = usingKey ? t('online.bothLockedAuto') : t('online.bothLockedManual')
  else if (stage === 'revealed') text = t('online.revealed')
  else if (stage === 'deadline') text = t('online.deadlineReached')
  else if (stage === 'expired-win' || stage === 'expired-late' || stage === 'expired-none') text = t('online.deadlinePassed')
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
  const { t } = useI18n()
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-2 px-4 pb-3 pt-1">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onExit} className="flex min-h-[40px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          <ArrowLeft size={16} /> {t('common.leave')}
        </button>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--lime)' }}>
          {badge}
        </span>
        <div className="flex items-center gap-1">
          <LanguageButton />
          <button type="button" onClick={onMute} aria-label={muted ? t('match.unmute') : t('match.mute')} className="flex h-10 w-10 items-center justify-center" style={{ color: 'var(--muted)' }}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}

