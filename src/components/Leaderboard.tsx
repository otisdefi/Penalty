import { useAccount, useReadContract } from 'wagmi'
import { Flame, Trophy } from 'lucide-react'
import { leaderboardAbi } from '@/contract'
import { useNetwork } from '@/networks'
import { shortAddress } from '@/lib/errors'
import { useI18n } from '@/i18n'

const ZERO = '0x0000000000000000000000000000000000000000'

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl px-2 py-2.5 text-center" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <p className="display text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
        {label}
      </p>
    </div>
  )
}

function MyRecord() {
  const { t, n } = useI18n()
  const net = useNetwork()
  const { address } = useAccount()
  const { data, isLoading } = useReadContract({
    address: net.leaderboardAddress,
    abi: leaderboardAbi,
    functionName: 'getRecord',
    args: address ? [address] : undefined,
    chainId: net.chainId,
    query: { enabled: !!address && !!net.leaderboardAddress },
  })
  if (!address) {
    return (
      <p className="rounded-2xl px-4 py-3 text-center text-sm" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--muted)' }}>
        {t('lb.connect')}
      </p>
    )
  }
  const [wins, losses, streak, best] = data ?? [0, 0, 0, 0]
  const v = (x: number) => (isLoading ? '-' : n(x))
  return (
    <div className="grid grid-cols-4 gap-2" aria-busy={isLoading}>
      <Stat label={t('lb.wins')} value={v(wins)} />
      <Stat label={t('lb.losses')} value={v(losses)} />
      <Stat label={t('lb.streak')} value={v(streak)} />
      <Stat label={t('lb.best')} value={v(best)} />
    </div>
  )
}

export function Leaderboard() {
  const { t, n } = useI18n()
  const net = useNetwork()
  const { address } = useAccount()
  const { data, isLoading, isError, refetch } = useReadContract({
    address: net.leaderboardAddress,
    abi: leaderboardAbi,
    functionName: 'getTopTen',
    chainId: net.chainId,
    query: { refetchInterval: 10_000, enabled: !!net.leaderboardAddress },
  })

  const rows = data
    ? data[0]
        .map((player, i) => ({ player, wins: data[1][i] ?? 0, streak: data[2][i] ?? 0 }))
        .filter((r) => r.player !== ZERO)
    : []

  return (
    <section className="panel space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={18} style={{ color: 'var(--lime)' }} />
          <h2 className="display text-2xl font-extrabold">{t('lb.title')}</h2>
        </div>
        <span className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
          {net.name}
        </span>
      </div>

      {!net.leaderboardAddress ? (
        <p className="py-6 text-center text-sm text-pretty" style={{ color: 'var(--muted)' }} role="status">
          {t('net.notAvailable')}
        </p>
      ) : (
        <>
      <MyRecord />

      {isLoading && (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
          {t('lb.loading')}
        </p>
      )}

      {isError && (
        <p className="py-4 text-center text-sm" style={{ color: 'var(--bad)' }}>
          {t('lb.error')}{' '}
          <button type="button" onClick={() => void refetch()} className="font-bold underline">
            {t('common.retry')}
          </button>
        </p>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {t('lb.empty')}
        </p>
      )}

      {rows.length > 0 && (
        <ol className="space-y-1.5">
          {rows.map((r, i) => {
            const me = address?.toLowerCase() === r.player.toLowerCase()
            return (
              <li
                key={r.player}
                className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
                style={{
                  background: me ? 'rgba(198,255,61,0.12)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${me ? 'rgba(198,255,61,0.45)' : 'transparent'}`,
                }}
              >
                <span className="display w-6 text-center text-xl font-extrabold tabular-nums" style={{ color: i === 0 ? 'var(--lime)' : 'var(--subtle)' }}>
                  {n(i + 1)}
                </span>
                <span className="mono flex-1 truncate text-xs">
                  {shortAddress(r.player)}
                  {me && (
                    <span className="ml-2 font-sans text-[11px] font-bold" style={{ color: 'var(--lime)' }}>
                      {t('you')}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-xs tabular-nums" style={{ color: 'var(--muted)' }} title={t('lb.currentStreak')}>
                  <Flame size={13} />
                  {n(r.streak)}
                </span>
                <span className="display w-12 text-right text-2xl font-extrabold tabular-nums">{n(r.wins)}</span>
              </li>
            )
          })}
        </ol>
      )}
      <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
        {t('lb.note', { network: net.name })}
      </p>
        </>
      )}
    </section>
  )
}
