import { useState } from 'react'
import { JerseyDot } from '@/cosmetics/art'
import { COLORS } from '@/cosmetics/catalog'
import { useI18n } from '@/i18n'
import type { AvatarInfo } from './api'
import { avatarImageFailed, useAvatarEntry } from './store'

/** Same pick every time for the same name, so a guest sees a steady colour for each player. */
function hashColor(name: string): string {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length].id
}

/** The default avatar: the player's jersey colours, pattern and number, drawn as SVG (no outside images). */
export function DefaultAvatar({ info, name, size }: { info: AvatarInfo | null; name: string; size: number }) {
  if (info) {
    const jersey = { color: info.jerseyColor, secondary: info.jerseySecondary, pattern: info.jerseyPattern, number: info.jerseyNumber }
    return (
      <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">
        <JerseyDot jersey={jersey} number={info.jerseyNumber} r={11.2} fontSize={info.jerseyNumber > 9 ? 10 : 12} />
      </svg>
    )
  }
  // Unknown player (a guest is looking, or the name is not an account): a plain coloured circle with the first letter.
  const color = hashColor(name || '?')
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">
      <circle r="11.2" fill={color} />
      <text textAnchor="middle" y="4.2" fontSize="12" fontWeight="800" fill="#0a1530" fontFamily="inherit">
        {(name.trim()[0] ?? '?').toUpperCase()}
      </text>
    </svg>
  )
}

/**
 * A small round picture for a player: their approved picture when the reader may see it, else the generated default.
 * Lazy-loaded, with a fixed size so the layout never jumps.
 */
export function Avatar({ username, size = 28, className = '' }: { username: string | null | undefined; size?: number; className?: string }) {
  const { t } = useI18n()
  const entry = useAvatarEntry(username)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const name = username ?? ''
  const showImage = entry.url !== null && entry.url !== failedUrl
  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-full ${className}`}
      style={{ width: size, height: size, background: '#0b1a3a', boxShadow: '0 0 0 1px rgba(255,255,255,0.14)' }}
      role="img"
      aria-label={t('avatar.alt', { name })}
    >
      {showImage ? (
        <img
          src={entry.url ?? undefined}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => {
            setFailedUrl(entry.url)
            avatarImageFailed(name)
          }}
        />
      ) : (
        <DefaultAvatar info={entry.info} name={name} size={size} />
      )}
    </span>
  )
}
