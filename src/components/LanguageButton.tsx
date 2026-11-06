import { useEffect, useId, useRef, useState } from 'react'
import { Check, Globe } from 'lucide-react'
import { useI18n } from '@/i18n'

/** Small globe button with the current language code. Opens a list of languages in their own names. */
export function LanguageButton({ className = '' }: { className?: string }) {
  const { t, lang, setLang, languages } = useI18n()
  const [open, setOpen] = useState(false)
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

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('lang.change')}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-xs font-bold uppercase tracking-[0.08em]"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--line)', color: 'var(--ink)' }}
      >
        <Globe size={15} aria-hidden />
        {lang}
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('lang.title')}
          className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-2xl p-1"
          style={{ background: '#0c1a3a', border: '1px solid var(--line)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
        >
          {languages.map((l) => (
            <li key={l.code} role="option" aria-selected={l.code === lang}>
              <button
                type="button"
                lang={l.code}
                onClick={() => {
                  setLang(l.code)
                  setOpen(false)
                }}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-sm font-semibold"
                style={{ background: l.code === lang ? 'rgba(198,255,61,0.12)' : 'transparent', color: l.code === lang ? 'var(--lime)' : 'var(--ink)' }}
              >
                <span className="min-w-0 truncate">{l.name}</span>
                {l.code === lang ? <Check size={15} aria-hidden /> : <span className="text-[10px] uppercase opacity-50">{l.code}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
