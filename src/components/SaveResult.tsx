import { useEffect, useState } from 'react'
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { leaderboardAbi } from '@/contract'
import { explorerTxUrl, useNetwork } from '@/networks'
import { isUserRejection, parseOnchainError } from '@/lib/errors'
import { useT } from '@/i18n'

interface Props {
  won: boolean
  onSaved?: () => void
}

export function SaveResult({ won, onSaved }: Props) {
  const t = useT()
  const net = useNetwork()
  const { address, isConnected, chainId } = useAccount()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: confirming, isSuccess, isError: receiptFailed } = useWaitForTransactionReceipt({ hash, chainId: net.chainId })
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuccess) return
    void queryClient.invalidateQueries()
    onSaved?.()
  }, [isSuccess, queryClient, onSaved])

  const save = async () => {
    setError(null)
    if (!net.leaderboardAddress) return
    try {
      // Ask the wallet to move to the selected network first.
      if (chainId !== net.chainId) await switchChainAsync({ chainId: net.chainId })
      await writeContractAsync({
        address: net.leaderboardAddress,
        abi: leaderboardAbi,
        functionName: 'recordMatch',
        args: [won],
        chainId: net.chainId,
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
        ? t('save.saving', { network: net.name })
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
          href={explorerTxUrl(net, hash)}
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

  if (!net.leaderboardAddress) {
    return (
      <p className="text-center text-sm text-pretty" style={{ color: 'var(--muted)' }} role="status">
        {t('net.notAvailable')} ({net.name})
      </p>
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
