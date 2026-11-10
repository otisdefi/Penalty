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
      title={signedIn ? auth.user!.username : t('auth.chip.signin')}
      className="btn btn-ghost btn-nowrap max-sm:!w-11 max-sm:!min-w-0 max-sm:!px-0"
      style={{ width: 'auto', minHeight: 44, padding: '0 14px', maxWidth: 160, flexShrink: 0 }}
    >
      <User size={16} aria-hidden />
      <span className="hidden truncate text-sm sm:inline">{signedIn ? auth.user!.username : t('auth.chip.signin')}</span>
    </button>
  )
}
