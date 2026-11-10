import { useSyncExternalStore } from 'react'
import { isAddress, type Chain } from 'viem'
import { arcTestnet, baseSepolia } from 'viem/chains'
import type { MessageKey } from './i18n/types'
import { DEPLOYED } from './deployments'

/*
 * The test networks the game runs on. Only testnets are listed here, on purpose: there is no mainnet in this file
 * and nothing in the app can be pointed at one by an environment variable.
 *
 * Each network has its own contracts (and so its own leaderboards and its own online matches). Contract addresses
 * come from separate environment variables; the Arc Testnet ones fall back to the deployments already made, while
 * Base Sepolia stays "not available yet" until its addresses are set.
 */

export type NetworkId = 'arc' | 'baseSepolia'
/** The chain ids the wallet connection knows about for the game. */
export type GameChainId = typeof arcTestnet.id | typeof baseSepolia.id

export interface NetworkConfig {
  id: NetworkId
  /** Value used in share links (?net=...). */
  slug: 'arc' | 'base-sepolia'
  chain: Chain
  chainId: GameChainId
  /** Brand name, shown as is in every language. */
  name: string
  /** The coin that pays for gas, and whether it is the USDC "gas view" (Arc) or a normal coin (ETH). */
  gasSymbol: 'USDC' | 'ETH'
  explorerBase: string
  /** Where free test coins come from, as a translatable one-liner. */
  faucetHint: MessageKey
  /** Online match contract on this network, or undefined when none is configured. */
  matchAddress: `0x${string}` | undefined
  /** Ranked leaderboard contract on this network, or undefined when none is configured. */
  leaderboardAddress: `0x${string}` | undefined
  /** Below this much leftover on the helper key, "return it" is not offered (it would cost more than it gives back). */
  minSweep: number
  /** Safety factor when pre-funding the helper key: gas prices on some networks jump around more than on others. */
  fundingFactor: bigint
  /** Dot colour in the badge. */
  accent: string
}

/** A valid address from an environment variable, or undefined (empty, missing or malformed values are ignored). */
export function readAddress(value: string | undefined): `0x${string}` | undefined {
  const v = value?.trim()
  return v && isAddress(v) ? (v) : undefined
}

/** Arc Testnet: the new variable first, then the older one, then the address that is already deployed. */
export function arcAddress(specific: string | undefined, legacy: string | undefined, deployed: `0x${string}`): `0x${string}` {
  return readAddress(specific) ?? readAddress(legacy) ?? deployed
}

const env = import.meta.env as Record<string, string | undefined>

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  arc: {
    id: 'arc',
    slug: 'arc',
    chain: arcTestnet,
    chainId: arcTestnet.id,
    name: 'Arc Testnet',
    gasSymbol: 'USDC',
    explorerBase: 'https://testnet.arcscan.app',
    faucetHint: 'net.faucet.arc',
    matchAddress: arcAddress(env.VITE_MATCH_ADDRESS_ARC, env.VITE_MATCH_ADDRESS, DEPLOYED.matchContract),
    leaderboardAddress: arcAddress(env.VITE_LEADERBOARD_ADDRESS_ARC, env.VITE_LEADERBOARD_ADDRESS, DEPLOYED.leaderboard),
    minSweep: 0.01,
    fundingFactor: 1n,
    accent: '#c6ff3d',
  },
  baseSepolia: {
    id: 'baseSepolia',
    slug: 'base-sepolia',
    chain: baseSepolia,
    chainId: baseSepolia.id,
    name: 'Base Sepolia',
    gasSymbol: 'ETH',
    explorerBase: 'https://sepolia.basescan.org',
    faucetHint: 'net.faucet.baseSepolia',
    matchAddress: readAddress(env.VITE_MATCH_ADDRESS_BASE_SEPOLIA),
    leaderboardAddress: readAddress(env.VITE_LEADERBOARD_ADDRESS_BASE_SEPOLIA),
    minSweep: 0.000005,
    fundingFactor: 3n,
    accent: '#5b9dff',
  },
}

export const NETWORK_LIST: NetworkConfig[] = [NETWORKS.arc, NETWORKS.baseSepolia]

export function networkBySlug(slug: string | null | undefined): NetworkConfig | undefined {
  const s = slug?.trim().toLowerCase()
  return NETWORK_LIST.find((n) => n.slug === s || n.id.toLowerCase() === s)
}

export function networkByChainId(chainId: number | undefined): NetworkConfig | undefined {
  return NETWORK_LIST.find((n) => n.chainId === chainId)
}

export const explorerTxUrl = (net: NetworkConfig, hash: string) => `${net.explorerBase}/tx/${hash}`
export const explorerAddressUrl = (net: NetworkConfig, address: string) => `${net.explorerBase}/address/${address}`

/**
 * The chat channel of an online match. Match numbers repeat on every network, so other networks get their own range
 * (the database only accepts match:<digits>, up to 18 of them). Arc Testnet keeps the plain number.
 */
export const matchChannel = (net: NetworkConfig, id: bigint | string): string => {
  const base = BigInt(id)
  return 'match:' + (net.id === 'arc' ? base : base + BigInt(NETWORK_LIST.indexOf(net)) * 1_000_000_000_000n).toString()
}

/** Has this network got both contracts? (The leaderboard alone is enough for offline ranked play.) */
export const hasMatchContract = (net: NetworkConfig) => net.matchAddress !== undefined
export const hasLeaderboardContract = (net: NetworkConfig) => net.leaderboardAddress !== undefined

/* ---------------- the selected network (remembered in the browser) ---------------- */

const KEY = 'tb:network'
const DEFAULT: NetworkId = 'arc'

function fromUrl(): NetworkId | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const named = networkBySlug(params.get('net'))
    if (named) return named.id
    // Match links made before Base Sepolia existed have no ?net= and are for Arc Testnet.
    return params.has('match') ? 'arc' : null
  } catch {
    return null
  }
}

function load(): NetworkId {
  // A share link that names a network wins: both players must be on the same one.
  const fromLink = fromUrl()
  if (fromLink) return fromLink
  try {
    return networkBySlug(localStorage.getItem(KEY))?.id ?? DEFAULT
  } catch {
    return DEFAULT
  }
}

let current: NetworkId = load()
const listeners = new Set<() => void>()

export const getNetwork = (): NetworkConfig => NETWORKS[current]

export function setNetwork(id: NetworkId): void {
  if (id === current) return
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* storage unavailable: the choice lasts until the tab closes */
  }
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** The selected network; the component re-renders when it changes. */
export function useNetwork(): NetworkConfig {
  return NETWORKS[useSyncExternalStore(subscribe, () => current)]
}
