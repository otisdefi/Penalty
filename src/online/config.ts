import { isAddress } from 'viem'
import { arcTestnet } from 'viem/chains'

export const ONLINE_CHAIN = arcTestnet
export const ONLINE_CHAIN_ID = arcTestnet.id

const raw = import.meta.env.VITE_MATCH_ADDRESS as string | undefined

/** PenaltyMatch contract on Arc Testnet. Undefined when VITE_MATCH_ADDRESS is missing or invalid. */
export const MATCH_ADDRESS: `0x${string}` | undefined = raw && isAddress(raw) ? raw : undefined

/** Mirrors the contract constants. */
export const STEP_TIMEOUT_S = 20
export const QUEUE_TTL_S = 90

/** Rough gas budget per helper-key transaction and number of transactions to pre-fund. */
export const GAS_PER_TX = 400_000n
export const FUNDED_TXS = 26n
