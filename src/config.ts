/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet, baseSepolia } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(baseSepolia.id, baseSepolia.rpcUrls.default.http[0])

export const config = createConfig({
  // The two game networks are test networks. mainnet is only here so wallet names (ENS) can be read; the game never uses it.
  chains: [arcTestnet, baseSepolia, mainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [baseSepolia.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
