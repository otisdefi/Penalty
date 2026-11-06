import type { ReactNode } from 'react'

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
      {children}
    </p>
  )
}

/** One selectable item. */
export function Choice({
  selected,
  label,
  onClick,
  className = '',
  children,
}: {
  selected: boolean
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl p-2 text-center transition active:scale-95 ${className}`}
      style={{
        background: selected ? 'rgba(198,255,61,0.12)' : 'rgba(255,255,255,0.05)',
        boxShadow: selected ? '0 0 0 2px var(--lime)' : 'inset 0 0 0 1px rgba(255,255,255,0.1)',
        cursor: 'pointer',
        minHeight: 44,
      }}
    >
      {children}
      <span className="text-[11px] font-semibold leading-tight">{label}</span>
    </button>
  )
}

export function Swatch({ color, label, selected, onClick }: { color: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative flex h-11 w-11 items-center justify-center rounded-full transition active:scale-95"
      style={{
        background: color,
        cursor: 'pointer',
        boxShadow: selected ? '0 0 0 2px var(--bg), 0 0 0 4px var(--lime)' : '0 0 0 1px rgba(255,255,255,0.25)',
      }}
    />
  )
}
