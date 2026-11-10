import { encodeAbiParameters, encodePacked, keccak256 } from 'viem'
import type { Hex } from 'viem'
import type { Kick, Team } from '@/game/logic'

export const STATUS = { None: 0, Open: 1, Active: 2, Finished: 3, Cancelled: 4 } as const
export const PHASE = { Committing: 0, Revealing: 1 } as const

export interface OnchainMatch {
  p1: `0x${string}`
  p2: `0x${string}`
  key1: `0x${string}`
  key2: `0x${string}`
  codeHash: Hex
  commit1: Hex
  commit2: Hex
  revealed1: boolean
  revealed2: boolean
  deadline: number
  createdAt: number
  createdBlock: bigint
  kicks: number
  score1: number
  score2: number
  goalBits: bigint
  lastShot: number
  lastDive: number
  lastGoal: boolean
  ranked: boolean
  status: number
  phase: number
  winner: `0x${string}`
}

const ZERO_HASH = `0x${'0'.repeat(64)}`
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const isZeroHash = (h: string) => h === ZERO_HASH
export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** Normalise the raw getMatch tuple into plain numbers. */
export function parseMatch(r: {
  p1: `0x${string}`
  p2: `0x${string}`
  key1: `0x${string}`
  key2: `0x${string}`
  codeHash: Hex
  commit1: Hex
  commit2: Hex
  revealed1: boolean
  revealed2: boolean
  deadline: bigint
  createdAt: bigint
  createdBlock: bigint
  kicks: number
  score1: number
  score2: number
  goalBits: bigint
  lastShot: number
  lastDive: number
  lastGoal: boolean
  ranked: boolean
  status: number
  phase: number
  winner: `0x${string}`
}): OnchainMatch {
  return { ...r, deadline: Number(r.deadline), createdAt: Number(r.createdAt) }
}

/** Matches the contract: keccak256(abi.encodePacked(id, kick, player, dir, salt)), with the MAIN wallet as player. */
export function commitHash(id: bigint, kick: number, player: `0x${string}`, dir: number, salt: Hex): Hex {
  return keccak256(encodePacked(['uint256', 'uint16', 'address', 'uint8', 'bytes32'], [id, kick, player, dir, salt]))
}

/** Matches the contract: keccak256(abi.encode(creator, roomCode)). */
export function roomCodeHash(creator: `0x${string}`, code: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [creator, code]))
}

export function randomBytes32(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export const isBytes32 = (v: string | null | undefined): v is Hex => !!v && /^0x[0-9a-f]{64}$/i.test(v)

/** Seat 1 plays red and shoots first; seat 2 plays blue. */
export const teamOfKick = (kickIndex: number): Team => (kickIndex % 2 === 0 ? 'red' : 'blue')

export function lastKickOf(m: OnchainMatch): Kick | null {
  if (m.kicks === 0) return null
  return {
    shooter: teamOfKick(m.kicks - 1),
    shot: m.lastShot as 0 | 1 | 2,
    dive: m.lastDive as 0 | 1 | 2,
    goal: m.lastGoal,
  }
}

/** Per-kick goal flags for each team, rebuilt from goalBits. */
export function kickFlags(m: OnchainMatch): { red: boolean[]; blue: boolean[] } {
  const red: boolean[] = []
  const blue: boolean[] = []
  for (let i = 0; i < m.kicks; i++) {
    const goal = ((m.goalBits >> BigInt(i)) & 1n) === 1n
    if (i % 2 === 0) red.push(goal)
    else blue.push(goal)
  }
  return { red, blue }
}

export function slotsFor(kicks: number): number {
  return kicks >= 10 ? Math.floor(kicks / 2) + 1 : 5
}

/** Estimates can come in a little low on some RPCs, so every transaction gets 50% headroom. */
export const padGas = (estimate: bigint): bigint => (estimate * 3n) / 2n + 30_000n
