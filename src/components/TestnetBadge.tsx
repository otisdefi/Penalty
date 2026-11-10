import { useI18n } from '@/i18n'
import { useNetwork, type NetworkConfig } from '@/networks'

/** Small label that keeps it clear which test network the game is on (test funds only). */
export function TestnetBadge({ network }: { network?: NetworkConfig }) {
  const { t } = useI18n()
  const selected = useNetwork()
  const net = network ?? selected
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em]"
      style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${net.accent}66`, color: net.accent }}
      title={t('net.gas', { token: net.gasSymbol })}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: net.accent }} aria-hidden />
      {net.name}
    </span>
  )
}
