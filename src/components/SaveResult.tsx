import { useEffect, useState } from 'react'
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { LEADERBOARD_ADDRESS, LEADERBOARD_CHAIN_ID, leaderboardAbi } from '@/contract'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { isUserRejection, parseOnchainError } from '@/lib/errors'
import { useT } from '@/i18n'

interface Props {
  won: boolean
  onSaved: () => void
}

export function SaveResult({ won, onSaved }: Props) {
  const t = useT()
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
    ? t('save.switching')
    : isPending
      ? t('save.confirm')
      : confirming
        ? t('save.saving')
        : won
          ? t('save.saveWin')
          : t('save.saveLoss')

  if (isSuccess && hash) {
    return (
      <div className="space-y-1 text-center">
        <p className="text-sm font-bold" style={{ color: 'var(--good)' }}>
          {t('save.saved')}
        </p>
        <a
          href={buildTxExplorerUrl(LEADERBOARD_CHAIN_ID, hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold underline"
          style={{ color: 'var(--lime)' }}
        >
          {t('common.viewTx')} <ExternalLink size={12} />
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
              {t('save.connect')}
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
        {won ? t('save.hintWin') : t('save.hintLoss')}
      </p>
      {(error || receiptFailed) && (
        <p className="text-center text-xs" style={{ color: 'var(--bad)' }}>
          {error ?? t('save.failed')}
        </p>
      )}
    </div>
  )
}
