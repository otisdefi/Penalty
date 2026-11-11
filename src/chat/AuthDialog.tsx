import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, ShieldCheck, X } from 'lucide-react'
import { useI18n, type MessageKey } from '@/i18n'
import { AccountView } from './AccountView'
import { closeAuthDialog, resetPassword, setAuthView, signIn, signUp, useAuth, useAuthDialog, usernameAvailable } from './account'
import { ErrorLine, Field, PasswordField, RecoveryCodeBox, inputClass, useCaptcha } from './AuthParts'
import { CHAT_CONFIGURED, PASSWORD_MIN, USERNAME_MAX } from './config'
import { isRecoveryCode, usernameProblem } from './rules'

/* ---------- the forms ---------- */

function SignInForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const captcha = useCaptcha()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await signIn(username.trim(), password, captcha.token)
    setBusy(false)
    captcha.reset()
    if (result.ok) onDone()
    else setError(result.error)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <Field label={t('auth.username')}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          className={inputClass}
          style={{ borderColor: 'var(--line)' }}
        />
      </Field>
      <PasswordField label={t('auth.password')} value={password} onChange={setPassword} autoComplete="current-password" />
      {captcha.widget}
      <ErrorLine error={error} />
      <button type="submit" className="btn btn-primary" disabled={busy || !captcha.ready || !username || password.length < PASSWORD_MIN} style={{ minHeight: 48 }}>
        {busy && <Loader2 size={16} className="animate-spin" />} {busy ? t('auth.working') : t('auth.submit.signin')}
      </button>
      <div className="flex flex-col gap-1 text-sm">
        <button type="button" className="min-h-[40px] text-left font-semibold underline" style={{ color: 'var(--lime)' }} onClick={() => setAuthView('signup')}>
          {t('auth.toSignup')}
        </button>
        <button type="button" className="min-h-[40px] text-left font-semibold underline" style={{ color: 'var(--muted)' }} onClick={() => setAuthView('reset')}>
          {t('auth.forgot')}
        </button>
      </div>
    </form>
  )
}

function PrivacyNote() {
  const { t } = useI18n()
  return (
    <div className="space-y-1.5 rounded-2xl p-3 text-xs text-pretty" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--muted)' }}>
      <p className="flex items-center gap-1.5 font-bold" style={{ color: 'var(--ink)' }}>
        <ShieldCheck size={14} aria-hidden /> {t('auth.privacy.title')}
      </p>
      <ul className="list-disc space-y-1 pl-4">
        <li>{t('auth.privacy.noEmail')}</li>
        <li>{t('auth.privacy.public')}</li>
        <li>{t('auth.privacy.password')}</li>
        <li>{t('auth.privacy.delete')}</li>
        <li>{t('auth.privacy.picture')}</li>
      </ul>
    </div>
  )
}

function SignUpForm({ onCreated }: { onCreated: (code: string) => void }) {
  const { t } = useI18n()
  const captcha = useCaptcha()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [available, setAvailable] = useState<'checking' | 'free' | 'taken' | null>(null)

  const problem = username.length === 0 ? null : usernameProblem(username)

  // Ask the database whether the name is free, a moment after the player stops typing.
  useEffect(() => {
    if (!username || usernameProblem(username) !== null || !CHAT_CONFIGURED) return
    let cancelled = false
    const timer = setTimeout(() => {
      setAvailable('checking')
      void usernameAvailable(username).then((free) => {
        if (!cancelled) setAvailable(free === null ? null : free ? 'free' : 'taken')
      })
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [username])

  const unameHint: MessageKey | null = problem
    ? (`auth.uname.${problem}` as MessageKey)
    : username && available === 'taken'
      ? 'auth.uname.taken'
      : username && available === 'free'
        ? 'auth.uname.free'
        : username && available === 'checking'
          ? 'auth.uname.checking'
          : null
  const bad = problem !== null || (username !== '' && available === 'taken')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await signUp(username, password, captcha.token)
    setBusy(false)
    captcha.reset()
    if (result.ok) onCreated(result.recoveryCode)
    else setError(result.error)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <Field
        label={t('auth.username')}
        hint={
          <span className="block text-[11px]" style={{ color: bad ? 'var(--bad)' : available === 'free' && !problem ? 'var(--good)' : 'var(--subtle)' }} role="status">
            {unameHint ? t(unameHint) : t('auth.usernameHint')}
          </span>
        }
      >
        <input
          type="text"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            setAvailable(null)
          }}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          aria-invalid={bad}
          className={inputClass}
          style={{ borderColor: bad ? 'var(--bad)' : 'var(--line)' }}
        />
      </Field>
      <PasswordField label={t('auth.password')} value={password} onChange={setPassword} autoComplete="new-password" showStrength />
      <PrivacyNote />
      {captcha.widget}
      <ErrorLine error={error} />
      <button type="submit" className="btn btn-primary" disabled={busy || !captcha.ready || username === '' || problem !== null || available === 'taken' || password.length < PASSWORD_MIN} style={{ minHeight: 48 }}>
        {busy && <Loader2 size={16} className="animate-spin" />} {busy ? t('auth.working') : t('auth.submit.signup')}
      </button>
      <button type="button" className="min-h-[40px] text-left text-sm font-semibold underline" style={{ color: 'var(--lime)' }} onClick={() => setAuthView('signin')}>
        {t('auth.toSignin')}
      </button>
    </form>
  )
}

function ResetForm({ onReset }: { onReset: (code: string) => void }) {
  const { t } = useI18n()
  const captcha = useCaptcha()
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await resetPassword(username.trim(), code, password, captcha.token)
    setBusy(false)
    captcha.reset()
    if (result.ok) onReset(result.recoveryCode)
    else setError(result.error)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <p className="text-sm text-pretty" style={{ color: 'var(--muted)' }}>
        {t('auth.reset.intro')}
      </p>
      <Field label={t('auth.username')}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          className={inputClass}
          style={{ borderColor: 'var(--line)' }}
        />
      </Field>
      <Field label={t('auth.reset.code')}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className={`${inputClass} mono`}
          style={{ borderColor: 'var(--line)' }}
        />
      </Field>
      <PasswordField label={t('auth.newPassword')} value={password} onChange={setPassword} autoComplete="new-password" showStrength />
      {captcha.widget}
      <ErrorLine error={error} />
      <button type="submit" className="btn btn-primary" disabled={busy || !captcha.ready || !username || !isRecoveryCode(code) || password.length < PASSWORD_MIN} style={{ minHeight: 48 }}>
        {busy && <Loader2 size={16} className="animate-spin" />} {busy ? t('auth.working') : t('auth.submit.reset')}
      </button>
      <button type="button" className="min-h-[40px] text-left text-sm font-semibold underline" style={{ color: 'var(--lime)' }} onClick={() => setAuthView('signin')}>
        {t('auth.backSignin')}
      </button>
    </form>
  )
}

/* ---------- the dialog ---------- */

type Pending = { code: string; intro: MessageKey; next: 'close' | 'signin' } | null

/** Sign up, sign in, password reset and account management. One instance sits at the top of the app. */
export function AuthDialog() {
  const { t } = useI18n()
  const dialog = useAuthDialog()
  const auth = useAuth()
  const [pending, setPending] = useState<Pending>(null)

  const locked = pending !== null // the recovery code must be saved before the dialog can close
  const close = () => {
    if (locked) return
    closeAuthDialog()
  }

  useEffect(() => {
    if (!dialog.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) closeAuthDialog()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog.open, locked])

  if (!dialog.open) return null

  const view = auth.status === 'in' && dialog.view !== 'account' && !pending ? 'account' : dialog.view
  const title: MessageKey = pending ? 'auth.title.recovery' : (`auth.title.${view}` as MessageKey)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-black/70 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="auth-title" className="panel relative max-h-[94dvh] w-full max-w-sm space-y-4 overflow-y-auto p-5" style={{ background: '#0b1630' }}>
        <div className="flex items-center justify-between gap-2">
          <h2 id="auth-title" className="display text-2xl font-extrabold">
            {t(title)}
          </h2>
          {!locked && (
            <button type="button" onClick={close} aria-label={t('auth.close')} className="flex h-10 w-10 items-center justify-center rounded-full" style={{ color: 'var(--muted)' }}>
              <X size={20} />
            </button>
          )}
        </div>

        {!CHAT_CONFIGURED ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {t('chat.notConfigured')}
          </p>
        ) : pending ? (
          <RecoveryCodeBox
            code={pending.code}
            intro={pending.intro}
            onSaved={() => {
              const next = pending.next
              setPending(null)
              if (next === 'signin') setAuthView('signin')
              else closeAuthDialog()
            }}
          />
        ) : view === 'account' ? (
          <AccountView onNewCode={(code) => setPending({ code, intro: 'auth.account.newCodeIntro', next: 'close' })} onClose={closeAuthDialog} />
        ) : view === 'signup' ? (
          <SignUpForm onCreated={(code) => setPending({ code, intro: 'auth.recovery.created', next: 'close' })} />
        ) : view === 'reset' ? (
          <ResetForm onReset={(code) => setPending({ code, intro: 'auth.reset.done', next: 'signin' })} />
        ) : (
          <SignInForm onDone={closeAuthDialog} />
        )}
      </div>
    </div>
  )
}
