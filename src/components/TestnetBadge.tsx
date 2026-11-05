/** Small label that keeps it clear the game runs on Arc Testnet (test funds only). */
export function TestnetBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em]"
      style={{ background: 'rgba(198,255,61,0.1)', border: '1px solid rgba(198,255,61,0.35)', color: 'var(--lime)' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--lime)' }} aria-hidden />
      Arc Testnet
    </span>
  )
}
