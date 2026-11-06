import { COLORS } from './catalog'
import type { MessageKey } from '../i18n/types'
import type { Jersey } from './types'

/** Translation key for a shirt colour's name, or null for a colour that is not in the list. */
export const colorLabelKey = (hex: string): MessageKey | null => COLORS.find((c) => c.id === hex.toLowerCase())?.labelKey ?? null

const rgb = (hex: string): [number, number, number] => {
  const v = hex.replace('#', '')
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

/** Rough perceptual distance between two shirt colours (0 = identical, about 440 = black vs white). */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  const rm = (r1 + r2) / 2
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}

/** Shirts closer than this are hard to tell apart on the pitch. */
const TOO_CLOSE = 140

/** The offered colour that looks most different from `against`, so the two players are easy to tell apart. */
export function contrastingColor(against: string): string {
  let best = COLORS[0].id
  let bestDistance = -1
  for (const c of COLORS) {
    const d = colorDistance(c.id, against)
    if (d > bestDistance) {
      best = c.id
      bestDistance = d
    }
  }
  return best
}

export interface ResolvedKits {
  host: Jersey
  guest: Jersey
  /** True when the guest's shirt colour was switched because it matched the host's. */
  recolored: boolean
}

/**
 * Both players pick their own shirt. If the two main colours match (or are too close), the guest is
 * shown in a contrasting colour on the pitch. The host never changes, so both screens agree.
 */
export function resolveKits(host: Jersey, guest: Jersey): ResolvedKits {
  if (colorDistance(host.color, guest.color) >= TOO_CLOSE) return { host, guest, recolored: false }
  const color = contrastingColor(host.color)
  // Avoid a sash or stripes in the same colour as the new main colour.
  const secondary = guest.secondary && colorDistance(guest.secondary, color) < TOO_CLOSE ? contrastingColor(color) : guest.secondary
  return { host, guest: { ...guest, color, secondary }, recolored: true }
}
