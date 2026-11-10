import { useEffect, useId, useRef, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { Check, ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n'
import { NETWORK_LIST, hasLeaderboardContract, hasMatchContract, setNetwork, useNetwork } from '@/networks'

/**
 * The network badge in the header, and a list to change it. Changing the network changes which contracts the game
 * reads and writes (leaderboards and online matches are separate on each network). The wallet is asked to move to
 * the network when it has to sign something, or right here with the "Switch wallet" button.
 */
export function NetworkSelector({ className = '' }: { className?: string }) {
  const { t } = useI18n()
  const net = useNetwork()
  const { isConnected, chainId } = useAccount()
  const { switchChainAsync, isPending } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const [switchFailed, setSwitchFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const walletElsewhere = isConnected && chainId !== net.chainId

  const switchWallet = async () => {
    setSwitchFailed(false)
    try {
      await switchChainAsync({ chainId: net.chainId })
    } catch {
      setSwitchFailed(true)
    }
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('net.change')}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[11px] font-bold uppercase tracking-[0.1em]"
        style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${net.accent}66`, color: net.accent }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: net.accent }} aria-hidden />
        <span className="max-w-[9.5rem] truncate">{net.name}</span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open && (
        <div
          className="absolute left-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl p-1"
          style={{ background: '#0c1a3a', border: '1px solid var(--line)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
        >
          <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--muted)' }}>
            {t('net.title')}
          </p>
          <ul id={listId} role="listbox" aria-label={t('net.title')}>
            {NETWORK_LIST.map((n) => {
              const none = !hasMatchContract(n) && !hasLeaderboardContract(n)
              const active = n.id === net.id
              return (
                <li key={n.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setNetwork(n.id)
                      setSwitchFailed(false)
                      setOpen(false)
                    }}
                    className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left"
                    style={{ background: active ? 'rgba(255,255,255,0.08)' : 'transparent' }}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: n.accent }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{n.name}</span>
                      <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
                        {none ? t('net.notAvailable') : t('net.gas', { token: n.gasSymbol })}
                      </span>
                    </span>
                    {active && <Check size={15} aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>
          {walletElsewhere && (
            <div className="space-y-1 border-t px-3 pb-3 pt-2" style={{ borderColor: 'var(--line)' }}>
              <p className="text-[11px] text-pretty" style={{ color: 'var(--muted)' }}>
                {t('net.walletElsewhere', { network: net.name })}
              </p>
              <button type="button" className="btn btn-primary" style={{ minHeight: 40, fontSize: 13 }} disabled={isPending} onClick={() => void switchWallet()}>
                {t('net.switchWallet', { network: net.name })}
              </button>
              {switchFailed && (
                <p className="text-[11px]" style={{ color: 'var(--bad)' }} role="alert">
                  {t('net.switchFailed')}
                </p>
              )}
            </div>
          )}
          <p className="px-3 pb-2 pt-1 text-[10px] text-pretty" style={{ color: 'var(--subtle)' }}>
            {t('net.separate')}
          </p>
        </div>
      )}
    </div>
  )
}
