import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { formatUnits } from 'viem'
import type { Hex } from 'viem'
import { ArrowLeft, KeyRound, Loader2, Play, Swords, Users } from 'lucide-react'
import { penaltyMatchAbi } from './abi'
import { STEP_TIMEOUT_S } from './config'
import { NETWORKS, setNetwork, useNetwork, type NetworkId } from '../networks'
import { TestnetBadge } from '@/components/TestnetBadge'
import { coinFormat } from '@/lib/coin'
import { STATUS, parseMatch } from './helpers'
import { useOnlineEntry } from './useOnlineEntry'
import { unlockAudioTap } from './audioTap'
import { useI18n } from '@/i18n'
import { ChevronDown } from 'lucide-react'
import { JerseyStep } from '@/cosmetics/JerseyStep'
import { JerseyDot } from '@/cosmetics/art'
import { displayName } from '@/cosmetics/identity'
import { useCosmetics } from '@/cosmetics/store'

export interface Invite {
  id: bigint
  code: Hex
  /** The network the match lives on (from the link, or found by looking at the chains). */
  network?: NetworkId
}

interface Props {
  invite: Invite | null
  onEnter: (id: bigint) => void
  onBack: () => void
  /** A player to challenge: creating the room then also sends them the invite. */
  challengeTo?: string | null
  onChallengeRoom?: (id: bigint) => Promise<void>
}

export function OnlineHome({ invite, onEnter, onBack, challengeTo = null, onChallengeRoom }: Props) {
  const { t, n } = useI18n()
  const { address, isConnected } = useAccount()
  const net = useNetwork()
  const matchAddress = net.matchAddress
  const publicClient = usePublicClient({ chainId: net.chainId })
  const { busy, error, create, join, quick, quoteFunding } = useOnlineEntry(net)
  // An invite is for one network; both players must be on it.
  const wrongNetwork = invite?.network !== undefined && invite.network !== net.id
  const [useKey, setUseKey] = useState(true)
  const mine = useCosmetics()
  // Someone who was invited should pick their shirt before joining, so it starts open for them.
  const [editJersey, setEditJersey] = useState(invite !== null)
  const decimals = net.chain.nativeCurrency.decimals

  const funding = useQuery({
    queryKey: ['pm-funding', net.id],
    enabled: !!publicClient && useKey,
    queryFn: quoteFunding,
    staleTime: 20_000,
  })

  const resume = useQuery({
    queryKey: ['pm-current', net.id, address],
    enabled: !!publicClient && !!matchAddress && !!address,
    refetchInterval: 5000,
    queryFn: async () => {
      if (!publicClient || !matchAddress || !address) return null
      const id = await publicClient.readContract({ address: matchAddress, abi: penaltyMatchAbi, functionName: 'currentMatch', args: [address] })
      if (id === 0n) return null
      const raw = await publicClient.readContract({ address: matchAddress, abi: penaltyMatchAbi, functionName: 'getMatch', args: [id] })
      return { id, status: parseMatch(raw).status }
    },
  })

  const room = useQuery({
    queryKey: ['pm-invite', net.id, invite?.id.toString()],
    enabled: !!publicClient && !!matchAddress && !!invite && !wrongNetwork,
    refetchInterval: 4000,
    queryFn: async () => {
      if (!publicClient || !matchAddress || !invite) return null
      const raw = await publicClient.readContract({ address: matchAddress, abi: penaltyMatchAbi, functionName: 'getMatch', args: [invite.id] })
      return parseMatch(raw)
    },
  })

  const go = async (fn: () => Promise<bigint | null>, sendInvite = false) => {
    unlockAudioTap()
    const id = await fn()
    if (id === null) return
    if (sendInvite && onChallengeRoom) await onChallengeRoom(id)
    onEnter(id)
  }

  const fundingText = funding.data ? t('online.fundAbout', { amount: n(Number(formatUnits(funding.data, decimals)), coinFormat(Number(formatUnits(funding.data, decimals)))), token: net.gasSymbol }) : t('online.fundSmall', { token: net.gasSymbol })
  const working = busy !== null
  const roomOpen = room.data?.status === STATUS.Open && !room.data.ranked
  const resumable = resume.data && (resume.data.status === STATUS.Open || resume.data.status === STATUS.Active)

  return (
    <section className="mx-auto w-full max-w-md space-y-4">
      <button type="button" onClick={onBack} className="flex min-h-[44px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={16} /> {t('online.menu')}
      </button>
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--lime)' }}>
          {t('online.kicker')}
        </p>
        <h1 className="display text-5xl font-extrabold leading-[0.9] text-balance">{t('online.title')}</h1>
        <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {t('online.intro', { s: n(STEP_TIMEOUT_S) })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TestnetBadge />
        <span className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          {t('net.sameNetwork', { network: net.name })}
        </span>
      </div>

      {wrongNetwork && invite?.network && (
        <div className="panel space-y-2 p-4" style={{ borderColor: 'rgba(255,210,63,0.5)' }} role="alert">
          <p className="text-sm font-semibold text-pretty">{t('net.inviteOther', { network: NETWORKS[invite.network].name })}</p>
          <button type="button" className="btn btn-primary" onClick={() => setNetwork(invite.network!)}>
            {t('net.useNetwork', { network: NETWORKS[invite.network].name })}
          </button>
        </div>
      )}

      {!matchAddress && !wrongNetwork && (
        <div className="panel p-4 text-sm" style={{ color: 'var(--muted)' }} role="status">
          {t('net.notAvailable')}
        </div>
      )}

      {matchAddress && !wrongNetwork && !isConnected && (
        <div className="panel space-y-3 p-4">
          <p className="text-sm">{t('online.connectHint', { network: net.name, token: net.gasSymbol })}</p>
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button type="button" onClick={show} className="btn btn-primary">
                {t('app.connect')}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      )}

      {matchAddress && !wrongNetwork && isConnected && (
        <>
          {resumable && resume.data && (
            <div className="panel space-y-2 p-4" style={{ borderColor: 'rgba(198,255,61,0.4)' }}>
              <p className="text-sm font-semibold">
                {resume.data.status === STATUS.Open ? t('online.resumeOpen', { id: resume.data.id.toString() }) : t('online.resumeActive', { id: resume.data.id.toString() })}
              </p>
              <button type="button" className="btn btn-primary" onClick={() => onEnter(resume.data!.id)}>
                <Play size={16} /> {t('online.resume')}
              </button>
            </div>
          )}

          <div className="panel space-y-3 p-4">
            <button
              type="button"
              onClick={() => setEditJersey((v) => !v)}
              aria-expanded={editJersey}
              className="flex w-full items-center gap-3 text-left"
            >
              <svg viewBox="-13 -13 26 26" className="h-11 w-11 shrink-0" aria-hidden>
                <JerseyDot jersey={mine.jersey} number={mine.jersey.number} r={12} fontSize={11} />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
                  {t('ready.yourJersey')}
                </span>
                <span className="block truncate text-sm font-bold">{displayName(mine.jersey.tag, address)}</span>
              </span>
              <ChevronDown size={18} style={{ color: 'var(--muted)', transform: editJersey ? 'rotate(180deg)' : 'none' }} aria-hidden />
            </button>
            {editJersey && (
              <>
                <JerseyStep address={address} />
                <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
                  {t('online.readyHint', { s: n(STEP_TIMEOUT_S) })}
                </p>
              </>
            )}
          </div>

          {invite && (
            <div className="panel space-y-2 p-4">
              <p className="text-sm font-semibold">{t('online.invited', { id: invite.id.toString() })}</p>
              {room.isLoading && <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('online.checking')}</p>}
              {room.data && !roomOpen && (
                <p className="text-xs" style={{ color: 'var(--bad)' }}>
                  {room.data.status === STATUS.Active ? t('online.roomBusy') : t('online.roomClosed')}
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!roomOpen || working}
                onClick={() => void go(() => join(invite.id, invite.code, useKey))}
              >
                {busy === 'join' ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
                {busy === 'join' ? t('online.joining') : t('online.joinThis')}
              </button>
            </div>
          )}

          <div className="panel space-y-2 p-4">
            <button
              type="button"
              role="switch"
              aria-checked={useKey}
              onClick={() => setUseKey((v) => !v)}
              className="flex w-full items-start gap-3 text-left"
            >
              <span
                className="mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors"
                style={{ background: useKey ? 'var(--lime)' : 'rgba(255,255,255,0.15)' }}
              >
                <span className="h-5 w-5 rounded-full bg-white transition-transform" style={{ transform: useKey ? 'translateX(20px)' : 'none', background: useKey ? '#0a1530' : '#fff' }} />
              </span>
              <span className="space-y-1">
                <span className="flex items-center gap-1.5 text-sm font-bold">
                  <KeyRound size={14} /> {t('online.helperKey')}
                </span>
                <span className="block text-xs text-pretty" style={{ color: 'var(--muted)' }}>
                  {useKey ? t('online.helperOn', { amount: fundingText }) : t('online.helperOff')}
                </span>
              </span>
            </button>
          </div>

          <div className="space-y-2">
            <button type="button" className="btn btn-primary" disabled={working || !address} onClick={() => void go(() => quick(useKey))}>
              {busy === 'quick' ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
              {busy === 'quick' ? t('online.entering') : t('online.quick')}
            </button>
            <button type="button" className="btn btn-ghost" disabled={working || !address} onClick={() => void go(() => create(useKey), challengeTo !== null)}>
              {busy === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
              {busy === 'create' ? t('online.creating') : challengeTo ? t('social.online.sendTo', { name: challengeTo }) : t('online.create')}
            </button>
            <p className="text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
              {t('online.footnote')}
            </p>
          </div>

          {error && (
            <p className="text-center text-sm" style={{ color: 'var(--bad)' }}>
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
