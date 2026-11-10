import type { NetworkConfig } from '../networks'

/** Mirrors the contract constants. */
export const STEP_TIMEOUT_S = 20
export const QUEUE_TTL_S = 90

/** Rough gas budget per helper-key transaction and number of transactions to pre-fund. */
export const GAS_PER_TX = 400_000n
export const FUNDED_TXS = 26n

/** How much native coin to put on the helper key: enough transactions at today's gas price, with a safety factor. */
export const fundingFor = (net: NetworkConfig, gasPrice: bigint): bigint => gasPrice * GAS_PER_TX * FUNDED_TXS * net.fundingFactor
