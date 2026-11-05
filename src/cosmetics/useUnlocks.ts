import { useEffect, useMemo } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { LEADERBOARD_ADDRESS, LEADERBOARD_CHAIN_ID, leaderboardAbi } from '@/contract'
import { penaltyMatchAbi } from '@/online/abi'
import { MATCH_ADDRESS, ONLINE_CHAIN_ID } from '@/online/config'
import type { UnlockStats } from './catalog'
import { applyUnlocks, useCosmetics, useLocalStats } from './store'
import type { Cosmetics } from './types'

const CACHE_KEY = 'tb:unlock-cache:v1'
const ZERO = '0x0000000000000000000000000000000000000000'

type Cache = Record<string, { wins: number; best: number }>

function readCache(address: string): { wins: number; best: number } | null {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache
    const entry = all[address.toLowerCase()]
    return entry && Number.isFinite(entry.wins) && Number.isFinite(entry.best) ? entry : null
  } catch {
    return null
  }
}

function writeCache(address: string, value: { wins: number; best: number }): void {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache
    all[address.toLowerCase()] = value
    localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

export interface UnlockInfo extends UnlockStats {
  /** True when the numbers include the connected wallet's onchain record. */
  fromChain: boolean
}

/**
 * Unlock progress = the better of what this browser counted and what the connected wallet has
 * onchain (offline leaderboard plus verified online record). A wallet keeps its unlocks on any device.
 * The offline leaderboard is self-reported, so unlocks are cosmetic rewards only.
 */
export function useUnlockStats(): UnlockInfo {
  const { address } = useAccount()
  const local = useLocalStats()

  const offline = useReadContract({
    address: LEADERBOARD_ADDRESS,
    abi: leaderboardAbi,
    functionName: 'getRecord',
    args: [address ?? ZERO],
    chainId: LEADERBOARD_CHAIN_ID,
    query: { enabled: !!address && LEADERBOARD_ADDRESS !== ZERO, staleTime: 60_000 },
  })
  const online = useReadContract({
    address: MATCH_ADDRESS,
    abi: penaltyMatchAbi,
    functionName: 'getRecord',
    args: [address ?? ZERO],
    chainId: ONLINE_CHAIN_ID,
    query: { enabled: !!address && !!MATCH_ADDRESS, staleTime: 60_000 },
  })

  const chainWins = Number(offline.data?.[0] ?? 0) + Number(online.data?.[0] ?? 0)
  const chainBest = Math.max(Number(offline.data?.[3] ?? 0), Number(online.data?.[3] ?? 0))
  const loaded = !!address && (offline.isSuccess || online.isSuccess)

  useEffect(() => {
    if (address && loaded) writeCache(address, { wins: chainWins, best: chainBest })
  }, [address, loaded, chainWins, chainBest])

  return useMemo(() => {
    const cached = address && !loaded ? readCache(address) : null
    const wins = loaded ? chainWins : (cached?.wins ?? 0)
    const best = loaded ? chainBest : (cached?.best ?? 0)
    return {
      wins: Math.max(local.wins, wins),
      bestStreak: Math.max(local.best, best),
      fromChain: loaded || !!cached,
    }
  }, [address, loaded, chainWins, chainBest, local.wins, local.best])
}

/** The player's saved choices with anything they have not unlocked swapped for free defaults. */
export function useEffectiveCosmetics(): Cosmetics {
  const raw = useCosmetics()
  const unlock = useUnlockStats()
  return useMemo(() => applyUnlocks(raw, unlock), [raw, unlock])
}
