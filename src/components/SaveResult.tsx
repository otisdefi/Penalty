import { useEffect, useState } from 'react'
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { LEADERBOARD_ADDRESS, LEADERBOARD_CHAIN_ID, leaderboardAbi } from '@/contract'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { isUserRejection, parseOnchainError } from '@/lib/errors'

interface Props {
  won: boolean
  onSaved: () => void
}

export function SaveResult({ won, onSaved }: Props) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: confirming, isSuccess, isError: receiptFailed } = useWaitForTransactionReceipt({ hash })
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuccess) return
    void queryClient.invalidateQueries()
    onSaved()
  }, [isSuccess, queryClient, onSaved])

  const save = async () => {
    setError(null)
    try {
      if (chainId !== LEADERBOARD_CHAIN_ID) await switchChainAsync({ chainId: LEADERBOARD_CHAIN_ID })
      await writeContractAsync({
        address: LEADERBOARD_ADDRESS,
        abi: leaderboardAbi,
        functionName: 'recordMatch',
        args: [won],
        chainId: LEADERBOARD_CHAIN_ID,
      })
    } catch (e) {
      if (isUserRejection(e)) return
      const message = parseOnchainError(e)
      setError(message)
      toast.error(message)
    }
  }

  const busy = switching || isPending || confirming
  const label = switching
    ? 'Switching network...'
    : isPending
      ? 'Confirm in your wallet...'
      : confirming
        ? 'Saving to Arc Testnet...'
        : `Save ${won ? 'win' : 'loss'} to leaderboard`

  if (isSuccess && hash) {
    return (
      <div className="space-y-1 text-center">
        <p className="text-sm font-bold" style={{ color: 'var(--good)' }}>
          Result saved to the leaderboard.
        </p>
        <a
          href={buildTxExplorerUrl(LEADERBOARD_CHAIN_ID, hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold underline"
          style={{ color: 'var(--lime)' }}
        >
          View transaction <ExternalLink size={12} />
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {!isConnected ? (
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button type="button" onClick={show} className="btn btn-primary">
              Connect wallet to save
            </button>
          )}
        </ConnectKitButton.Custom>
      ) : (
        <button type="button" onClick={() => void save()} disabled={busy || !address} className="btn btn-primary">
          {busy && <Loader2 size={16} className="animate-spin" />}
          {label}
        </button>
      )}
      <p className="text-center text-xs text-pretty" style={{ color: 'var(--subtle) ' }}>
        {won ? 'Saving a win adds to your streak and ranking.' : 'Saving a loss resets your streak. Skip it and your record stays as is.'}
      </p>
      {(error || receiptFailed) && (
        <p className="text-center text-xs" style={{ color: 'var(--bad)' }}>
          {error ?? 'The transaction failed onchain. Please try again.'}
        </p>
      )}
    </div>
  )
}
