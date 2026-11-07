import { useState } from 'react'
import { ChevronDown, MessageCircle } from 'lucide-react'
import { useI18n, type MessageKey } from '@/i18n'
import { ChatPanel } from './ChatPanel'

/** A small chat that stays closed until the player opens it, for friend rooms and online matches. */
export function InlineChat({ channel, title }: { channel: string; title: MessageKey }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setOpen(true)}>
        <MessageCircle size={16} /> {t('chat.open')}
      </button>
    )
  }
  return (
    <div className="space-y-2">
      <ChatPanel channel={channel} title={t(title)} height={150} />
      <button type="button" className="mx-auto flex min-h-[40px] items-center gap-1 text-xs font-bold" style={{ color: 'var(--muted)' }} onClick={() => setOpen(false)}>
        <ChevronDown size={14} /> {t('chat.hide')}
      </button>
    </div>
  )
}
