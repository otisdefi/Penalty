import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { formatUnits } from 'viem'
import type { Hex } from 'viem'
import { ArrowLeft, KeyRound, Loader2, Play, Swords, Users } from 'lucide-react'
import { penaltyMatchAbi } from './abi'
import { MATCH_ADDRESS, ONLINE_CHAIN_ID, STEP_TIMEOUT_S } from './config'
import { STATUS, parseMatch } from './helpers'
import { useOnlineEntry } from './useOnlineEntry'
import { requireChain } from '@/onchain-facts'
import { unlockAudioTap } from './audioTap'

export interface Invite {
  id: bigint
  code: Hex
}

interface Props {
  invite: Invite | null
  onEnter: (id: bigint) => void
  onBack: () => void
}

export function OnlineHome({ invite, onEnter, onBack }: Props) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: ONLINE_CHAIN_ID })
  const { busy, error, create, join, quick, quoteFunding } = useOnlineEntry()
  const [useKey, setUseKey] = useState(true)
  const decimals = requireChain(ONLINE_CHAIN_ID).nativeCurrency.decimals

  const funding = useQuery({
    queryKey: ['pm-funding'],
    enabled: !!publicClient && useKey,
    queryFn: quoteFunding,
    staleTime: 20_000,
  })

  const resume = useQuery({
    queryKey: ['pm-current', address],
    enabled: !!publicClient && !!MATCH_ADDRESS && !!address,
    refetchInterval: 5000,
    queryFn: async () => {
      if (!publicClient || !MATCH_ADDRESS || !address) return null
      const id = await publicClient.readContract({ address: MATCH_ADDRESS, abi: penaltyMatchAbi, functionName: 'currentMatch', args: [address] })
      if (id === 0n) return null
      const raw = await publicClient.readContract({ address: MATCH_ADDRESS, abi: penaltyMatchAbi, functionName: 'getMatch', args: [id] })
      return { id, status: parseMatch(raw).status }
    },
  })

  const room = useQuery({
    queryKey: ['pm-invite', invite?.id.toString()],
    enabled: !!publicClient && !!MATCH_ADDRESS && !!invite,
    refetchInterval: 4000,
    queryFn: async () => {
      if (!publicClient || !MATCH_ADDRESS || !invite) return null
      const raw = await publicClient.readContract({ address: MATCH_ADDRESS, abi: penaltyMatchAbi, functionName: 'getMatch', args: [invite.id] })
      return parseMatch(raw)
    },
  })

  const go = async (fn: () => Promise<bigint | null>) => {
    unlockAudioTap()
    const id = await fn()
    if (id !== null) onEnter(id)
  }

  const fundingText = funding.data ? `about ${Number(formatUnits(funding.data, decimals)).toFixed(2)} USDC` : 'a small amount of USDC'
  const working = busy !== null
  const roomOpen = room.data?.status === STATUS.Open && !room.data.ranked
  const resumable = resume.data && (resume.data.status === STATUS.Open || resume.data.status === STATUS.Active)

  return (
    <section className="mx-auto w-full max-w-md space-y-4">
      <button type="button" onClick={onBack} className="flex min-h-[44px] items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={16} /> Menu
      </button>
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--lime)' }}>
          Two wallets, onchain
        </p>
        <h1 className="display text-5xl font-extrabold leading-[0.9]">Online match</h1>
        <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Every kick is a hidden, committed move that both players reveal, so neither side can cheat. {STEP_TIMEOUT_S} seconds per step; a player who stalls forfeits.
        </p>
      </div>

      {!MATCH_ADDRESS && (
        <div className="panel p-4 text-sm" style={{ color: 'var(--bad)' }}>
          Online play is not configured. Set VITE_MATCH_ADDRESS to the PenaltyMatch contract address.
        </div>
      )}

      {MATCH_ADDRESS && !isConnected && (
        <div className="panel space-y-3 p-4">
          <p className="text-sm">Connect a wallet with some Arc Testnet USDC to play. Gas is paid in USDC.</p>
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button type="button" onClick={show} className="btn btn-primary">
                Connect wallet
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      )}

      {MATCH_ADDRESS && isConnected && (
        <>
          {resumable && resume.data && (
            <div className="panel space-y-2 p-4" style={{ borderColor: 'rgba(198,255,61,0.4)' }}>
              <p className="text-sm font-semibold">
                You have {resume.data.status === STATUS.Open ? 'an open room' : 'a match in progress'} (#{resume.data.id.toString()}).
              </p>
              <button type="button" className="btn btn-primary" onClick={() => onEnter(resume.data!.id)}>
                <Play size={16} /> Resume match
              </button>
            </div>
          )}

          {invite && (
            <div className="panel space-y-2 p-4">
              <p className="text-sm font-semibold">Your friend invited you to match #{invite.id.toString()}</p>
              {room.isLoading && <p className="text-xs" style={{ color: 'var(--muted)' }}>Checking the room...</p>}
              {room.data && !roomOpen && (
                <p className="text-xs" style={{ color: 'var(--bad)' }}>
                  This room is no longer open{room.data.status === STATUS.Active ? ' (a match is already being played)' : ''}.
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!roomOpen || working}
                onClick={() => void go(() => join(invite.id, invite.code, useKey))}
              >
                {busy === 'join' ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
                {busy === 'join' ? 'Joining...' : 'Join this match'}
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
                  <KeyRound size={14} /> Sign once with a helper key
                </span>
                <span className="block text-xs text-pretty" style={{ color: 'var(--muted)' }}>
                  {useKey
                    ? `Your wallet sends ${fundingText} to a one-time key stored in this browser. It signs your moves automatically, and you can return the leftover after the match.`
                    : 'Your wallet will ask you to confirm every commit and reveal (two prompts per kick).'}
                </span>
              </span>
            </button>
          </div>

          <div className="space-y-2">
            <button type="button" className="btn btn-primary" disabled={working || !address} onClick={() => void go(() => quick(useKey))}>
              {busy === 'quick' ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
              {busy === 'quick' ? 'Entering the queue...' : 'Quick match (ranked)'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={working || !address} onClick={() => void go(() => create(useKey))}>
              {busy === 'create' ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
              {busy === 'create' ? 'Creating room...' : 'Create a private room'}
            </button>
            <p className="text-center text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
              Quick matches are ranked and update the verified leaderboard. Private rooms are unranked and use a link only your friend has.
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
