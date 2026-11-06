import { isAddress } from 'viem'

/** The contracts deployed on Arc Testnet (chain ID 5042002). These are public addresses, not secrets. */
export const DEPLOYED = {
  matchContract: '0x8093487cdfdcb6a31e371742a400ec203794c575',
  leaderboard: '0x1df2ff3dd51acb1683781dd5d2808ca338047f4c',
} as const

/**
 * Use the environment variable when it holds a valid address, otherwise the deployed Arc Testnet
 * address. Setting the variable lets you point the app at a different deployment.
 */
export function resolveAddress(fromEnv: string | undefined, fallback: `0x${string}`): `0x${string}` {
  const value = fromEnv?.trim()
  return value && isAddress(value) ? value : fallback
}
