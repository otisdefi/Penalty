import { translate } from '@/i18n'

export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number; message?: string; shortMessage?: string } | null
  const text = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`.toLowerCase()
  return e?.code === 4001 || text.includes('user rejected') || text.includes('user denied')
}

export function parseOnchainError(error: unknown): string {
  const e = error as { message?: string; shortMessage?: string } | null
  const text = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`.toLowerCase()
  if (isUserRejection(error)) return translate('err.cancelled')
  if (text.includes('insufficient funds') || text.includes('exceeds balance')) {
    return translate('err.noGas')
  }
  if (text.includes('overflow')) return translate('err.recordFull')
  if (text.includes('reverted')) return translate('err.reverted')
  if (text.includes('network') || text.includes('timeout')) {
    return translate('err.network')
  }
  return translate('err.generic')
}

export const shortAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`
