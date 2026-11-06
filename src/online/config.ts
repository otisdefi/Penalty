import { arcTestnet } from 'viem/chains'
import { DEPLOYED, resolveAddress } from '../deployments'

export const ONLINE_CHAIN = arcTestnet
export const ONLINE_CHAIN_ID = arcTestnet.id

/** PenaltyMatch on Arc Testnet: VITE_MATCH_ADDRESS when set and valid, otherwise the deployed address. */
export const MATCH_ADDRESS: `0x${string}` | undefined = resolveAddress(import.meta.env.VITE_MATCH_ADDRESS as string | undefined, DEPLOYED.matchContract)

/** Mirrors the contract constants. */
export const STEP_TIMEOUT_S = 20
export const QUEUE_TTL_S = 90

/** Rough gas budget per helper-key transaction and number of transactions to pre-fund. */
export const GAS_PER_TX = 400_000n
export const FUNDED_TXS = 26n
