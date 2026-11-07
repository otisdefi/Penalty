import { useState, type FormEvent } from 'react'
import { KeyRound, Loader2, LogOut, Trash2 } from 'lucide-react'
import { useI18n, type MessageKey } from '@/i18n'
import { changePassword, deleteAccount, newRecoveryCode, signOut, useAuth } from './account'
import { ErrorLine, PasswordField, useCaptcha } from './AuthParts'
import { PASSWORD_MIN } from './config'

/** Signed-in view: change password, new recovery code, sign out and delete the account. */
export function AccountView({ onNewCode, onClose }: { onNewCode: (code: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const captcha = useCaptcha()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState<'password' | 'code' | 'delete' | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [changed, setChanged] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')

  if (!user) return null

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('password')
    setError(null)
    setChanged(false)
    const result = await changePassword(current, next, captcha.token)
    setBusy(null)
    captcha.reset()
    if (result.ok) {
      setChanged(true)
      setCurrent('')
      setNext('')
    } else setError(result.error)
  }

  const getCode = async () => {
    setBusy('code')
    setError(null)
    const result = await newRecoveryCode()
    setBusy(null)
    if (result.ok) onNewCode(result.recoveryCode)
    else setError(result.error)
  }

  const remove = async () => {
    setBusy('delete')
    setError(null)
    const result = await deleteAccount()
    setBusy(null)
    if (result.ok) onClose()
    else setError(result.error)
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-bold">{t('auth.account.signedInAs', { name: user.username })}</p>
        <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          {t('auth.account.publicName')}
        </p>
      </div>

      <form onSubmit={(e) => void submitPassword(e)} className="space-y-3">
        <h3 className="display text-lg font-extrabold">{t('auth.account.changePassword')}</h3>
        <PasswordField label={t('auth.currentPassword')} value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label={t('auth.newPassword')} value={next} onChange={setNext} autoComplete="new-password" showStrength />
        {captcha.widget}
        {changed && (
          <p className="text-sm font-semibold" style={{ color: 'var(--good)' }} role="status">
            {t('auth.account.changed')}
          </p>
        )}
        <button type="submit" className="btn btn-ghost" disabled={busy !== null || !captcha.ready || !current || next.length < PASSWORD_MIN} style={{ minHeight: 44 }}>
          {busy === 'password' && <Loader2 size={16} className="animate-spin" />} {t('auth.account.changePassword')}
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="display text-lg font-extrabold">{t('auth.account.recoveryTitle')}</h3>
        <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          {t('auth.account.newCodeHint')}
        </p>
        <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void getCode()} style={{ minHeight: 44 }}>
          {busy === 'code' ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} {t('auth.account.newCode')}
        </button>
      </div>

      <ErrorLine error={error} />

      <button type="button" className="btn btn-ghost" onClick={() => void signOut().then(onClose)} style={{ minHeight: 44 }}>
        <LogOut size={16} /> {t('auth.account.signOut')}
      </button>

      <div className="space-y-2 rounded-2xl p-3" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,107,122,0.4)' }}>
        {!confirmDelete ? (
          <button type="button" className="flex min-h-[44px] w-full items-center justify-center gap-2 text-sm font-bold" style={{ color: 'var(--bad)' }} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} /> {t('auth.account.delete')}
          </button>
        ) : (
          <>
            <p className="text-sm font-semibold text-pretty" style={{ color: 'var(--bad)' }}>
              {t('auth.account.deleteWarn')}
            </p>
            <label className="block space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--muted)' }}>
                {t('auth.account.deleteConfirm', { name: user.username })}
              </span>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="h-11 w-full rounded-xl border bg-transparent px-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => { setConfirmDelete(false); setTyped('') }} style={{ minHeight: 44 }}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null || typed.trim().toLowerCase() !== user.username.toLowerCase()}
                onClick={() => void remove()}
                style={{ minHeight: 44, background: 'var(--bad)', color: '#2b0509' }}
              >
                {busy === 'delete' && <Loader2 size={16} className="animate-spin" />} {t('auth.account.deleteButton')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
