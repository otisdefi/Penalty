import { User } from 'lucide-react'
import { useI18n } from '@/i18n'
import { openAuthDialog, useAuth } from './account'

/** Header button: "Sign in" for guests, the username when signed in. */
export function AccountChip() {
  const { t } = useI18n()
  const auth = useAuth()
  const signedIn = auth.status === 'in' && auth.user
  return (
    <button
      type="button"
      onClick={() => openAuthDialog()}
      aria-label={signedIn ? t('auth.chip.account', { name: auth.user!.username }) : t('auth.chip.signin')}
      className="btn btn-ghost"
      style={{ width: 'auto', minHeight: 40, padding: '0 12px', maxWidth: 140 }}
    >
      <User size={16} aria-hidden />
      <span className="truncate text-sm">{signedIn ? auth.user!.username : t('auth.chip.signin')}</span>
    </button>
  )
}
