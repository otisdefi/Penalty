import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useI18n } from '@/i18n'
import type { MessageKey } from '@/i18n/types'
import { useAuth } from '../chat/account'
import { Avatar } from './Avatar'
import { removeMyAvatar, uploadAvatar } from './api'
import { DEFAULT_CROP, MAX_INPUT_BYTES, drawSquare, encodeAvatar, inspectFile, type Crop, type ImageError, type Inspected } from './processImage'
import { refreshAvatar, useAvatarEntry } from './store'

const IMAGE_ERRORS: Record<ImageError, MessageKey> = {
  empty: 'avatar.img.empty',
  too_big: 'avatar.img.tooBig',
  unsupported: 'avatar.img.unsupported',
  animated: 'avatar.img.animated',
  not_image: 'avatar.img.notImage',
  too_small: 'avatar.img.tooSmall',
  too_large: 'avatar.img.tooLarge',
  no_canvas: 'avatar.img.noCanvas',
  encode_failed: 'avatar.img.encodeFailed',
}
const STATUS_TEXT: Record<'none' | 'pending' | 'approved' | 'rejected', MessageKey> = {
  none: 'avatar.status.none',
  pending: 'avatar.status.pending',
  approved: 'avatar.status.approved',
  rejected: 'avatar.status.rejected',
}

type Notice = { kind: 'ok' | 'err'; key: MessageKey; detail?: string }

/** "Profile picture" section of My profile: choose, crop, save, and remove. Nothing here asks for personal details. */
export function AvatarUpload() {
  const { t } = useI18n()
  const auth = useAuth()
  const user = auth.status === 'in' ? auth.user : null
  const entry = useAvatarEntry(user?.username)
  const [picked, setPicked] = useState<Inspected | null>(null)
  const [crop, setCrop] = useState<Crop>(DEFAULT_CROP)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [askRemove, setAskRemove] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Redraw the live preview whenever the crop changes.
  useEffect(() => {
    if (picked && canvasRef.current) drawSquare(canvasRef.current, picked, crop)
  }, [picked, crop])
  // Free the decoded picture when it is replaced or the screen closes.
  useEffect(() => () => picked?.close(), [picked])

  if (!user) return null
  const status = entry.info?.status ?? 'none'

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // the same file can be chosen again
    if (!file) return
    setNotice(null)
    setAskRemove(false)
    const res = await inspectFile(file)
    if (!res.ok) {
      setPicked(null)
      setNotice({ kind: 'err', key: IMAGE_ERRORS[res.error] })
      return
    }
    setCrop(DEFAULT_CROP)
    setPicked(res.image)
  }

  const save = async () => {
    if (!picked || !canvasRef.current || busy) return
    setBusy('save')
    setNotice(null)
    try {
      if (!drawSquare(canvasRef.current, picked, crop)) {
        setNotice({ kind: 'err', key: 'avatar.img.noCanvas' })
        return
      }
      const enc = await encodeAvatar(canvasRef.current)
      if (!enc.ok) {
        setNotice({ kind: 'err', key: IMAGE_ERRORS[enc.error] })
        return
      }
      const up = await uploadAvatar(user.id, enc.encoded.blob, enc.encoded.type)
      if (!up.ok) {
        setNotice({ kind: 'err', key: up.error, detail: up.detail })
        return
      }
      setPicked(null)
      setNotice({ kind: 'ok', key: 'avatar.saved' })
      refreshAvatar(user.username)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy('remove')
    setNotice(null)
    const res = await removeMyAvatar(user.id)
    setBusy(null)
    setAskRemove(false)
    if (!res.ok) {
      setNotice({ kind: 'err', key: res.error })
      return
    }
    setNotice({ kind: 'ok', key: 'avatar.removed' })
    refreshAvatar(user.username)
  }

  const slider = (id: string, label: MessageKey, value: number, min: number, max: number, step: number, on: (v: number) => void) => (
    <label className="block" htmlFor={id}>
      <span className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
        {t(label)}
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => on(Number(e.target.value))}
        className="mt-1 h-8 w-full"
        style={{ accentColor: '#ffd23f' }}
      />
    </label>
  )

  return (
    <section className="panel space-y-3 p-4">
      <h2 className="display text-xl">{t('avatar.title')}</h2>

      <div className="flex items-center gap-3">
        <Avatar username={user.username} size={72} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold">{user.username}</p>
          <p className="break-words text-xs" style={{ color: status === 'rejected' ? 'var(--bad)' : 'var(--muted)' }}>
            {t(STATUS_TEXT[status])}
          </p>
        </div>
      </div>

      {picked ? (
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
            {t('avatar.preview')}
          </p>
          <div className="mx-auto w-48 overflow-hidden rounded-full" style={{ boxShadow: '0 0 0 2px rgba(255,255,255,0.2)' }}>
            <canvas ref={canvasRef} className="block h-48 w-48" aria-label={t('avatar.preview')} />
          </div>
          {slider('av-zoom', 'avatar.zoom', crop.zoom, 1, 4, 0.05, (zoom) => setCrop((c) => ({ ...c, zoom })))}
          {slider('av-x', 'avatar.moveX', crop.x, -1, 1, 0.02, (x) => setCrop((c) => ({ ...c, x })))}
          {slider('av-y', 'avatar.moveY', crop.y, -1, 1, 0.02, (y) => setCrop((c) => ({ ...c, y })))}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy !== null}>
              {busy === 'save' ? t('avatar.saving') : t('avatar.save')}
            </button>
            <button className="btn btn-ghost" onClick={() => setPicked(null)} disabled={busy !== null}>
              {t('avatar.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => void onFile(e)} aria-hidden="true" />
          <button className="btn btn-primary w-full" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
            {t(status === 'none' || status === 'rejected' ? 'avatar.choose' : 'avatar.change')}
          </button>
          {status !== 'none' &&
            (askRemove ? (
              <div className="space-y-2">
                <p className="text-center text-sm">{t('avatar.removeAsk')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-ghost" onClick={() => void remove()} disabled={busy !== null} style={{ color: 'var(--bad)' }}>
                    {busy === 'remove' ? t('avatar.saving') : t('avatar.removeYes')}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setAskRemove(false)} disabled={busy !== null}>
                    {t('avatar.removeNo')}
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost w-full" onClick={() => setAskRemove(true)} disabled={busy !== null}>
                {t('avatar.remove')}
              </button>
            ))}
        </div>
      )}

      {notice && (
        <div role="status" className="space-y-1 text-center">
          <p className="break-words text-sm" style={{ color: notice.kind === 'ok' ? 'var(--good)' : 'var(--bad)' }}>
            {t(notice.key)}
          </p>
          {notice.detail && (
            <p className="select-text break-all text-[11px] leading-snug" lang="en" style={{ color: 'var(--muted)' }}>
              {t('avatar.details')}: {notice.detail}
            </p>
          )}
        </div>
      )}

      <p className="break-words text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        {t('avatar.rules')}
      </p>
      <p className="break-words text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        {t('avatar.howItWorks', { mb: MAX_INPUT_BYTES / (1024 * 1024) })}
      </p>
    </section>
  )
}
