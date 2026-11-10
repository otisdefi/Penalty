import { parseAbi } from 'viem'

/*
 * The ranked leaderboard contract is deployed once per network. Which address and chain to use comes from the
 * selected network (see src/networks.ts), so each network keeps its own, separate leaderboard.
 */

export const leaderboardAbi = parseAbi([
  'function recordMatch(bool won)',
  'function getRecord(address player) view returns (uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak)',
  'function getTopTen() view returns (address[10] players, uint32[10] wins, uint32[10] streaks, uint32[10] bestStreaks)',
  'event MatchRecorded(address indexed player, bool won, uint32 wins, uint32 streak)',
])
