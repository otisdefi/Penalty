import { BALLS, PATTERNS, STADIUMS, TRAILS, isKnownColor } from './catalog'
import { safeTag } from './nameFilter'
import type { BallDesign, Jersey, PatternId, StadiumId, TrailId } from './types'

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

const has = <T extends string>(list: readonly { id: T }[], v: unknown): v is T => typeof v === 'string' && list.some((i) => i.id === v)

export const isPattern = (v: unknown): v is PatternId => has(PATTERNS, v)
export const isBall = (v: unknown): v is BallDesign => has(BALLS, v)
export const isTrail = (v: unknown): v is TrailId => has(TRAILS, v)
export const isStadium = (v: unknown): v is StadiumId => has(STADIUMS, v)

export const clampNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) ? Math.min(99, Math.max(1, v)) : fallback

/**
 * Parse a shirt received from another player or read from storage. Anything unexpected is
 * dropped, the name tag is re-filtered, and nothing but plain values is ever kept.
 */
export function parseJersey(raw: unknown): Jersey | null {
  if (!raw || typeof raw !== 'object') return null
  const j = raw as Record<string, unknown>
  // Only colours the game offers are accepted from other players.
  if (!isHex(j.color) || !isKnownColor(j.color)) return null
  if (typeof j.number !== 'number' || !Number.isInteger(j.number) || j.number < 1 || j.number > 99) return null
  return {
    color: j.color.toLowerCase(),
    number: j.number,
    pattern: isPattern(j.pattern) ? j.pattern : 'solid',
    secondary: isHex(j.secondary) && isKnownColor(j.secondary) ? j.secondary.toLowerCase() : '#f1f5f9',
    tag: safeTag(j.tag),
  }
}
