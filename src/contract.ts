import { parseAbi } from 'viem'

/*
 * The ranked leaderboard contract is deployed once per network. Which address and chain to use comes from the
 * selected network (see src/networks.ts), so each network keeps its own, separate leaderboard.
 */

/** Version 1: the leaderboard already deployed on Arc Testnet. */
export const leaderboardAbi = parseAbi([
  'function recordMatch(bool won)',
  'function getRecord(address player) view returns (uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak)',
  'function getTopTen() view returns (address[10] players, uint32[10] wins, uint32[10] streaks, uint32[10] bestStreaks)',
  'event MatchRecorded(address indexed player, bool won, uint32 wins, uint32 streak)',
])

/**
 * Version 2: contracts/PenaltyLeaderboard.sol as it is in the repo, deployed on Base Sepolia. Reads are the same as
 * version 1; saving a result also takes a match id, and the contract refuses the same id twice for one wallet.
 */
export const leaderboardAbiV2 = parseAbi([
  'function recordMatch(bytes32 matchId, bool won)',
  'function matchRecorded(address player, bytes32 matchId) view returns (bool)',
  'function getRecord(address player) view returns (uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak)',
  'function getTopTen() view returns (address[10] players, uint32[10] wins, uint32[10] streaks, uint32[10] bestStreaks)',
  'event MatchRecorded(address indexed player, bytes32 indexed matchId, bool won, uint32 wins, uint32 streak)',
])

/** A fresh, non-zero match id. It is created once per result screen, so retrying a save can never count a result twice. */
export function newMatchId(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  if (bytes.every((b) => b === 0)) bytes[31] = 1
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

