import { useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound } from 'lucide-react'
import { useI18n, type MessageKey } from '@/i18n'
import { PASSWORD_MAX, PASSWORD_MIN, TURNSTILE_SITE_KEY } from './config'
import { passwordStrength } from './rules'
import { Turnstile, type TurnstileHandle } from './Turnstile'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      {children}
      {hint}
    </label>
  )
}

export const inputClass = 'h-11 w-full rounded-xl border bg-transparent px-3 text-base'

const STRENGTH_COLORS = ['var(--bad)', 'var(--bad)', 'var(--yellow)', 'var(--good)'] as const

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  showStrength = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  showStrength?: boolean
}) {
  const { t } = useI18n()
  const [shown, setShown] = useState(false)
  const level = passwordStrength(value)
  return (
    <Field
      label={label}
      hint={
        showStrength && value.length > 0 ? (
          <span className="flex items-center gap-2 pt-1" role="status">
            <span className="flex flex-1 gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: level > i ? STRENGTH_COLORS[level] : 'rgba(255,255,255,0.14)' }} />
              ))}
            </span>
            <span className="text-[11px] font-semibold" style={{ color: STRENGTH_COLORS[level] }}>
              {t(`auth.strength.${level}` as MessageKey)}
            </span>
          </span>
        ) : undefined
      }
    >
      <span className="relative block">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          className={`${inputClass} pr-12`}
          style={{ borderColor: 'var(--line)' }}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? t('auth.hide') : t('auth.show')}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full"
          style={{ color: 'var(--muted)' }}
        >
          {shown ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </span>
    </Field>
  )
}

export function ErrorLine({ error }: { error: MessageKey | null }) {
  const { t } = useI18n()
  if (!error) return null
  return (
    <p className="text-sm font-semibold" style={{ color: 'var(--bad)' }} role="alert">
      {t(error)}
    </p>
  )
}

/** The one-time recovery code, with the warning. The caller decides when the player may continue. */
export function RecoveryCodeBox({ code, onSaved, intro }: { code: string; onSaved: () => void; intro?: MessageKey }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState<MessageKey | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setNote(null)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setNote('auth.recovery.copyFailed')
    }
  }

  return (
    <div className="space-y-3">
      {intro && <p className="text-sm font-semibold text-pretty">{t(intro)}</p>}
      <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(255,210,63,0.1)', boxShadow: 'inset 0 0 0 2px var(--yellow)' }}>
        <p className="mono select-all break-all text-2xl font-bold tracking-[0.08em]" aria-label={t('auth.recovery.codeAria')}>
          {code}
        </p>
      </div>
      <p className="flex items-start gap-2 text-sm font-bold text-pretty" style={{ color: 'var(--yellow)' }} role="alert">
        <KeyRound size={16} className="mt-0.5 shrink-0" aria-hidden /> {t('auth.recovery.warning')}
      </p>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {t('auth.recovery.once')}
      </p>
      <button type="button" className="btn btn-primary" onClick={() => void copy()}>
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t('auth.recovery.copied') : t('auth.recovery.copy')}
      </button>
      {note && <p className="text-xs" style={{ color: 'var(--bad)' }}>{t(note)}</p>}
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
        <span>{t('auth.recovery.saved')}</span>
      </label>
      <button type="button" className="btn btn-ghost" disabled={!confirmed} onClick={onSaved}>
        {t('auth.recovery.continue')}
      </button>
    </div>
  )
}

/** Cloudflare Turnstile, when a site key is set. Returns the token state and a reset function. */
export function useCaptcha() {
  const [token, setToken] = useState<string | null>(null)
  const ref = useRef<TurnstileHandle>(null)
  const required = TURNSTILE_SITE_KEY !== ''
  return {
    token: token ?? undefined,
    ready: !required || token !== null,
    reset: () => ref.current?.reset(),
    widget: <Turnstile ref={ref} onToken={setToken} />,
  }
}

