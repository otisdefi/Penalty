import { translate } from '@/i18n'
import { useCallback, useState } from 'react'
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi'
import { encodeFunctionData } from 'viem'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { penaltyMatchAbi } from './abi'
import { FUNDED_TXS, GAS_PER_TX, MATCH_ADDRESS, ONLINE_CHAIN_ID } from './config'
import { ZERO_ADDRESS, padGas, randomBytes32, roomCodeHash } from './helpers'
import { clearPendingKey, saveStored, savePendingKey } from './storage'
import { isUserRejection, parseOnchainError } from '@/lib/errors'

/** Creates, joins or queues for an onchain match and returns the new match id. */
export function useOnlineEntry() {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: ONLINE_CHAIN_ID })
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()
  const [busy, setBusy] = useState<'create' | 'join' | 'quick' | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Pre-fund amount for the helper key, from the live gas price. */
  const quoteFunding = useCallback(async (): Promise<bigint> => {
    if (!publicClient) return 0n
    const gasPrice = await publicClient.getGasPrice()
    return gasPrice * GAS_PER_TX * FUNDED_TXS
  }, [publicClient])

  const execute = useCallback(
    async (
      kind: 'create' | 'join' | 'quick',
      useHelperKey: boolean,
      build: (keyAddress: `0x${string}`, wallet: `0x${string}`) => { data: Hex; roomCode?: Hex },
    ): Promise<bigint | null> => {
      if (!publicClient || !MATCH_ADDRESS || !address) {
        setError(translate('online.err.connect'))
        return null
      }
      setError(null)
      setBusy(kind)
      try {
        let sessionKey: Hex | undefined
        let keyAddress: `0x${string}` = ZERO_ADDRESS
        let value = 0n
        if (useHelperKey) {
          sessionKey = generatePrivateKey()
          savePendingKey(address, sessionKey) // survives a crash between signing and confirmation
          keyAddress = privateKeyToAccount(sessionKey).address
          value = await quoteFunding()
        }
        const { data, roomCode } = build(keyAddress, address)
        if (chainId !== ONLINE_CHAIN_ID) await switchChainAsync({ chainId: ONLINE_CHAIN_ID })
        const gas = padGas(await publicClient.estimateGas({ account: address, to: MATCH_ADDRESS, data, value }))
        const hash = await sendTransactionAsync({ to: MATCH_ADDRESS, data, value, chainId: ONLINE_CHAIN_ID, gas })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('reverted')
        const id = await publicClient.readContract({
          address: MATCH_ADDRESS,
          abi: penaltyMatchAbi,
          functionName: 'currentMatch',
          args: [address],
        })
        if (id === 0n) throw new Error('reverted')
        saveStored({ id: id.toString(), wallet: address, sessionKey, roomCode, moves: {} })
        clearPendingKey()
        return id
      } catch (e) {
        if (!isUserRejection(e)) setError(parseOnchainError(e))
        return null
      } finally {
        setBusy(null)
      }
    },
    [address, chainId, publicClient, quoteFunding, sendTransactionAsync, switchChainAsync],
  )

  const create = useCallback(
    (useHelperKey: boolean) =>
      execute('create', useHelperKey, (keyAddress, wallet) => {
        const roomCode = randomBytes32()
        return {
          roomCode,
          data: encodeFunctionData({
            abi: penaltyMatchAbi,
            functionName: 'createMatch',
            args: [roomCodeHash(wallet, roomCode), keyAddress],
          }),
        }
      }),
    [execute],
  )

  const join = useCallback(
    (id: bigint, roomCode: Hex, useHelperKey: boolean) =>
      execute('join', useHelperKey, (keyAddress) => ({
        data: encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'joinMatch', args: [id, roomCode, keyAddress] }),
      })),
    [execute],
  )

  const quick = useCallback(
    (useHelperKey: boolean) =>
      execute('quick', useHelperKey, (keyAddress) => ({
        data: encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'quickMatch', args: [keyAddress] }),
      })),
    [execute],
  )

  return { busy, error, create, join, quick, quoteFunding }
}
