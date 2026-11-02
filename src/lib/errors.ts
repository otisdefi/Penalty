export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number; message?: string; shortMessage?: string } | null
  const text = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`.toLowerCase()
  return e?.code === 4001 || text.includes('user rejected') || text.includes('user denied')
}

export function parseOnchainError(error: unknown): string {
  const e = error as { message?: string; shortMessage?: string } | null
  const text = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`.toLowerCase()
  if (isUserRejection(error)) return 'Transaction cancelled.'
  if (text.includes('insufficient funds') || text.includes('exceeds balance')) {
    return 'Not enough USDC for gas. Use Get test USDC in the sidebar, then try again.'
  }
  if (text.includes('overflow')) return 'This record is full and cannot take another result.'
  if (text.includes('reverted')) return 'The transaction was rejected by the contract.'
  if (text.includes('network') || text.includes('timeout')) {
    return 'Network issue. Check your connection and try again.'
  }
  return 'Something went wrong. Please try again.'
}

export const shortAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`
