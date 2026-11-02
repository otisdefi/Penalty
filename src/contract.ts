import { parseAbi } from 'viem'
import { arcTestnet } from 'viem/chains'

export const LEADERBOARD_CHAIN_ID = arcTestnet.id

const rawAddress = import.meta.env.VITE_LEADERBOARD_ADDRESS as string | undefined

export const LEADERBOARD_ADDRESS = (rawAddress ?? '0x0000000000000000000000000000000000000000') as `0x${string}`

export const leaderboardAbi = parseAbi([
  'function recordMatch(bool won)',
  'function getRecord(address player) view returns (uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak)',
  'function getTopTen() view returns (address[10] players, uint32[10] wins, uint32[10] streaks, uint32[10] bestStreaks)',
  'event MatchRecorded(address indexed player, bool won, uint32 wins, uint32 streak)',
])
