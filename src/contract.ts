import { parseAbi } from 'viem'
import { arcTestnet } from 'viem/chains'
import { DEPLOYED, resolveAddress } from './deployments'

export const LEADERBOARD_CHAIN_ID = arcTestnet.id

/** VITE_LEADERBOARD_ADDRESS when set and valid, otherwise the deployed Arc Testnet leaderboard. */
export const LEADERBOARD_ADDRESS = resolveAddress(import.meta.env.VITE_LEADERBOARD_ADDRESS as string | undefined, DEPLOYED.leaderboard)

export const leaderboardAbi = parseAbi([
  'function recordMatch(bool won)',
  'function getRecord(address player) view returns (uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak)',
  'function getTopTen() view returns (address[10] players, uint32[10] wins, uint32[10] streaks, uint32[10] bestStreaks)',
  'event MatchRecorded(address indexed player, bool won, uint32 wins, uint32 streak)',
])
