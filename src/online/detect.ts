import { createPublicClient, http, type Hex } from 'viem'
import { penaltyMatchAbi } from './abi'
import { STATUS, parseMatch, roomCodeHash, type OnchainMatch } from './helpers'
import { NETWORK_LIST, type NetworkConfig, type NetworkId } from '../networks'

/**
 * Match numbers repeat on every network, so an invite must say which network it is for. Links carry ?net=...; a
 * challenge invite does not, so the receiver looks for the network where match #id is open AND was created with
 * this room code. The code is a 32-byte secret hashed with the creator's address, so exactly one network can match.
 */
export function matchesInvite(m: OnchainMatch, code: Hex): boolean {
  return m.status === STATUS.Open && roomCodeHash(m.p1, code).toLowerCase() === m.codeHash.toLowerCase()
}

export type ReadMatch = (net: NetworkConfig, id: bigint) => Promise<OnchainMatch | null>

const defaultRead: ReadMatch = async (net, id) => {
  if (!net.matchAddress) return null
  const client = createPublicClient({ chain: net.chain, transport: http() })
  const raw = await client.readContract({ address: net.matchAddress, abi: penaltyMatchAbi, functionName: 'getMatch', args: [id] })
  return parseMatch(raw)
}

/** The network an invite belongs to, or null if no network has such an open match. Never throws. */
export async function detectInviteNetwork(id: bigint, code: Hex, read: ReadMatch = defaultRead): Promise<NetworkId | null> {
  const results = await Promise.all(
    NETWORK_LIST.map(async (net) => {
      try {
        const m = await read(net, id)
        return m && matchesInvite(m, code) ? net.id : null
      } catch {
        return null
      }
    }),
  )
  return results.find((r) => r !== null) ?? null
}
