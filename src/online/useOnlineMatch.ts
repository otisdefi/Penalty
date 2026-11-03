import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi'
import { createWalletClient, encodeFunctionData, http } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { penaltyMatchAbi } from './abi'
import { MATCH_ADDRESS, ONLINE_CHAIN, ONLINE_CHAIN_ID, GAS_PER_TX } from './config'
import {
  PHASE,
  STATUS,
  padGas,
  commitHash,
  isZeroHash,
  lastKickOf,
  parseMatch,
  randomBytes32,
  sameAddress,
  type OnchainMatch,
} from './helpers'
import { loadStored, saveStored, type StoredMatch } from './storage'
import type { Dir, Kick, Team } from '@/game/logic'
import { sfx } from '@/game/audio'
import { playWhistle } from '@/lib/whistle'
import { isUserRejection, parseOnchainError } from '@/lib/errors'

export type Stage =
  | 'loading'
  | 'missing'
  | 'spectator'
  | 'open'
  | 'cancelled'
  | 'choose'
  | 'committed'
  | 'reveal'
  | 'revealed'
  | 'deadline'
  | 'expired-win'
  | 'expired-late'
  | 'expired-none'
  | 'finished'

type Call =
  | { fn: 'commit'; args: readonly [bigint, Hex] }
  | { fn: 'reveal'; args: readonly [bigint, number, Hex] }
  | { fn: 'claimTimeout'; args: readonly [bigint] }
  | { fn: 'cancelMatch'; args: readonly [bigint] }

function calldata(call: Call): Hex {
  switch (call.fn) {
    case 'commit':
      return encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'commit', args: call.args })
    case 'reveal':
      return encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'reveal', args: call.args })
    case 'claimTimeout':
      return encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'claimTimeout', args: call.args })
    case 'cancelMatch':
      return encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'cancelMatch', args: call.args })
  }
}

const REVEAL_ANIM_MS = 1900
/** Wait a little past the deadline so the chain clock is certainly beyond it. */
const CLAIM_MARGIN_S = 1

export function useOnlineMatch(matchId: bigint) {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: ONLINE_CHAIN_ID })
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()

  const [stored, setStored] = useState<StoredMatch | null>(() => loadStored(matchId))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localPick, setLocalPick] = useState<{ kick: number; dir: Dir } | null>(null)
  const [anim, setAnim] = useState<Kick | null>(null)
  const [nowMs, setNowMs] = useState(0)
  const revealTried = useRef('')
  const prevKicks = useRef<number | null>(null)
  const prevStatus = useRef<number | null>(null)
  const timers = useRef<number[]>([])

  const sessionKey = stored?.sessionKey
  const sessionAccount = useMemo(() => (sessionKey ? privateKeyToAccount(sessionKey) : null), [sessionKey])
  const sessionWallet = useMemo(
    () => (sessionAccount ? createWalletClient({ account: sessionAccount, chain: ONLINE_CHAIN, transport: http() }) : null),
    [sessionAccount],
  )

  const matchQuery = useQuery({
    queryKey: ['pm-match', matchId.toString()],
    enabled: !!publicClient && !!MATCH_ADDRESS,
    refetchInterval: 1500,
    queryFn: async () => {
      if (!publicClient || !MATCH_ADDRESS) throw new Error('not ready')
      const [raw, block] = await Promise.all([
        publicClient.readContract({ address: MATCH_ADDRESS, abi: penaltyMatchAbi, functionName: 'getMatch', args: [matchId] }),
        publicClient.getBlock(),
      ])
      return {
        m: parseMatch(raw),
        chainNow: Number(block.timestamp),
        fetchedAt: Date.now(),
      }
    },
  })
  const m: OnchainMatch | null = matchQuery.data?.m ?? null

  const keyQuery = useQuery({
    queryKey: ['pm-key', sessionAccount?.address],
    enabled: !!publicClient && !!sessionAccount,
    refetchInterval: 6000,
    queryFn: async () => {
      if (!publicClient || !sessionAccount) throw new Error('not ready')
      const [balance, gasPrice] = await Promise.all([publicClient.getBalance({ address: sessionAccount.address }), publicClient.getGasPrice()])
      return { balance, gasPrice }
    },
  })
  const keyBalance = keyQuery.data?.balance ?? 0n
  const keyFunded = !!keyQuery.data && keyQuery.data.balance >= keyQuery.data.gasPrice * GAS_PER_TX

  const mySeat: 0 | 1 | 2 = m && address ? (sameAddress(address, m.p1) ? 1 : sameAddress(address, m.p2) ? 2 : 0) : 0
  const myKeyRegistered =
    !!m && !!sessionAccount && mySeat !== 0 && sameAddress(sessionAccount.address, mySeat === 1 ? m.key1 : m.key2)
  const usingKey = myKeyRegistered && keyFunded
  const myTeam: Team = mySeat === 2 ? 'blue' : 'red'
  const rivalTeam: Team = myTeam === 'red' ? 'blue' : 'red'

  // Clock: chain time at fetch plus local time elapsed since, ticking twice a second.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [])
  const data = matchQuery.data
  const chainNow = data ? data.chainNow + ((nowMs || data.fetchedAt) - data.fetchedAt) / 1000 : 0
  const remaining = data && m ? m.deadline - chainNow : 0

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])
  useEffect(() => {
    const list = timers.current
    return () => list.forEach((t) => window.clearTimeout(t))
  }, [])

  // Animate each newly resolved kick, with sound in step with the GOAL / SAVED banner.
  useEffect(() => {
    if (!m) return
    const wasKicks = prevKicks.current
    const wasStatus = prevStatus.current
    prevKicks.current = m.kicks
    prevStatus.current = m.status
    if (wasKicks === null || m.kicks <= wasKicks) return
    const kick = lastKickOf(m)
    if (!kick) return
    later(() => {
      setAnim(kick)
      later(() => (kick.goal ? sfx.goal() : sfx.save()), 450)
      later(() => setAnim(null), REVEAL_ANIM_MS)
      if (wasStatus === STATUS.Active && m.status === STATUS.Finished) {
        later(() => void playWhistle(), REVEAL_ANIM_MS)
      }
    }, 0)
  }, [m, later])

  const send = useCallback(
    async (call: Call): Promise<void> => {
      if (!publicClient || !MATCH_ADDRESS) throw new Error('Online play is not configured.')
      const data = calldata(call)
      const canUseKey = usingKey && sessionWallet && sessionAccount
      let hash: Hex
      if (canUseKey) {
        const gas = padGas(await publicClient.estimateGas({ account: sessionAccount, to: MATCH_ADDRESS, data }))
        hash = await sessionWallet.sendTransaction({ account: sessionAccount, chain: ONLINE_CHAIN, to: MATCH_ADDRESS, data, gas })
      } else {
        if (chainId !== ONLINE_CHAIN_ID) await switchChainAsync({ chainId: ONLINE_CHAIN_ID })
        const gas = address ? padGas(await publicClient.estimateGas({ account: address, to: MATCH_ADDRESS, data })) : undefined
        hash = await sendTransactionAsync({ to: MATCH_ADDRESS, data, chainId: ONLINE_CHAIN_ID, gas })
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('reverted')
      await matchQuery.refetch()
    },
    [address, chainId, matchQuery, publicClient, sendTransactionAsync, sessionAccount, sessionWallet, switchChainAsync, usingKey],
  )

  const run = useCallback(async (label: string, call: Call, onFail?: () => void) => {
    setError(null)
    setBusy(label)
    try {
      await send(call)
    } catch (e) {
      onFail?.()
      if (!isUserRejection(e)) setError(parseOnchainError(e))
    } finally {
      setBusy(null)
    }
  }, [send])

  const kickNow = m?.kicks ?? 0

  const commitMove = useCallback(
    async (dir: Dir) => {
      if (!m || !address || mySeat === 0 || busy) return
      const kick = m.kicks
      const salt = randomBytes32()
      const next: StoredMatch = {
        id: matchId.toString(),
        wallet: address,
        sessionKey: stored?.sessionKey,
        roomCode: stored?.roomCode,
        moves: { ...(stored?.moves ?? {}), [String(kick)]: { dir, salt } },
      }
      saveStored(next)
      setStored(next)
      setLocalPick({ kick, dir })
      sfx.pick()
      await run('commit', { fn: 'commit', args: [matchId, commitHash(matchId, kick, address, dir, salt)] }, () => setLocalPick(null))
    },
    [address, busy, m, matchId, mySeat, run, stored],
  )

  const reveal = useCallback(async () => {
    const move = stored?.moves[String(kickNow)]
    if (!move) {
      setError('Your move for this kick was not found on this device, so it cannot be revealed. The deadline will settle the match.')
      return
    }
    await run('reveal', { fn: 'reveal', args: [matchId, move.dir, move.salt] })
  }, [kickNow, matchId, run, stored])

  const claim = useCallback(() => run('claim', { fn: 'claimTimeout', args: [matchId] }), [matchId, run])
  const cancel = useCallback(() => run('cancel', { fn: 'cancelMatch', args: [matchId] }), [matchId, run])

  // Stage derivation.
  const myCommitted = !!m && (mySeat === 1 ? !isZeroHash(m.commit1) : mySeat === 2 ? !isZeroHash(m.commit2) : false)
  const oppCommitted = !!m && (mySeat === 1 ? !isZeroHash(m.commit2) : mySeat === 2 ? !isZeroHash(m.commit1) : false)
  const myRevealed = !!m && (mySeat === 1 ? m.revealed1 : mySeat === 2 ? m.revealed2 : false)
  const oppRevealed = !!m && (mySeat === 1 ? m.revealed2 : mySeat === 2 ? m.revealed1 : false)

  let stage: Stage = 'loading'
  if (m) {
    if (m.status === STATUS.None) stage = 'missing'
    else if (m.status === STATUS.Open) stage = 'open'
    else if (m.status === STATUS.Cancelled) stage = 'cancelled'
    else if (m.status === STATUS.Finished) stage = 'finished'
    else if (mySeat === 0) stage = 'spectator'
    else if (remaining <= -CLAIM_MARGIN_S) {
      const committing = m.phase === PHASE.Committing
      const iActed = committing ? myCommitted : myRevealed
      const oppActed = committing ? oppCommitted : oppRevealed
      stage = iActed && !oppActed ? 'expired-win' : !iActed && oppActed ? 'expired-late' : 'expired-none'
    } else if (remaining <= 0) stage = 'deadline'
    else if (m.phase === PHASE.Committing) stage = myCommitted ? 'committed' : 'choose'
    else stage = myRevealed ? 'revealed' : 'reveal'
  }

  // Reveal automatically when a funded helper key is signing, so nobody is asked mid-round.
  const revealKey = `${matchId}:${kickNow}`
  const hasMove = !!stored?.moves[String(kickNow)]
  const wantsAutoReveal = stage === 'reveal' && usingKey && !busy && hasMove
  useEffect(() => {
    if (!wantsAutoReveal) return
    const t = window.setTimeout(() => {
      if (revealTried.current === revealKey) return // one automatic attempt per kick; the Retry button covers failures
      revealTried.current = revealKey
      void reveal()
    }, 0)
    return () => window.clearTimeout(t)
  }, [wantsAutoReveal, revealKey, reveal])

  const pick: Dir | null = useMemo(() => {
    if (stage !== 'committed' && stage !== 'reveal' && stage !== 'revealed' && stage !== 'choose') return null
    const saved = stored?.moves[String(kickNow)]
    if (myCommitted && saved) return saved.dir as Dir
    if (localPick && localPick.kick === kickNow) return localPick.dir
    return null
  }, [stage, stored, kickNow, myCommitted, localPick])

  const sweep = useCallback(async () => {
    if (!publicClient || !sessionWallet || !sessionAccount || !address) return
    setError(null)
    setBusy('sweep')
    try {
      const gasPrice = await publicClient.getGasPrice()
      const value = keyBalance - gasPrice * 21_000n * 3n
      if (value <= 0n) return
      const hash = await sessionWallet.sendTransaction({ account: sessionAccount, chain: ONLINE_CHAIN, to: address, value })
      await publicClient.waitForTransactionReceipt({ hash })
      await keyQuery.refetch()
    } catch (e) {
      if (!isUserRejection(e)) setError(parseOnchainError(e))
    } finally {
      setBusy(null)
    }
  }, [address, keyBalance, keyQuery, publicClient, sessionAccount, sessionWallet])

  const shooterTeam: Team = (m?.kicks ?? 0) % 2 === 0 ? 'red' : 'blue'
  const iShootNow = shooterTeam === myTeam

  return {
    m,
    stage,
    mySeat,
    myTeam,
    rivalTeam,
    shooterTeam,
    iShootNow,
    remaining,
    chainNow,
    pick,
    busy,
    error,
    anim,
    usingKey,
    keyBalance,
    myKeyRegistered,
    loadError: matchQuery.isError,
    commitMove,
    reveal,
    claim,
    cancel,
    sweep,
    oppCommitted,
    oppRevealed,
  }
}
