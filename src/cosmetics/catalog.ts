import type { MessageKey } from '../i18n/types'
import type { BallDesign, PatternId, StadiumId, TrailId } from './types'

export interface Item<T extends string> {
  id: T
  labelKey: MessageKey
}

export interface ColorItem {
  id: string
  labelKey: MessageKey
}

/** Shirt colours (also used for the secondary colour). */
export const COLORS: readonly ColorItem[] = [
  { id: '#e5383b', labelKey: 'color.red' },
  { id: '#fb5607', labelKey: 'color.orange' },
  { id: '#ffb703', labelKey: 'color.amber' },
  { id: '#c6ff3d', labelKey: 'color.lime' },
  { id: '#06d6a0', labelKey: 'color.green' },
  { id: '#2ec4b6', labelKey: 'color.teal' },
  { id: '#38bdf8', labelKey: 'color.sky' },
  { id: '#3a86ff', labelKey: 'color.blue' },
  { id: '#4f46e5', labelKey: 'color.indigo' },
  { id: '#8338ec', labelKey: 'color.purple' },
  { id: '#ff4d9d', labelKey: 'color.pink' },
  { id: '#f1f5f9', labelKey: 'color.white' },
  { id: '#9b1c31', labelKey: 'color.crimson' },
  { id: '#d4a017', labelKey: 'color.gold' },
  { id: '#94a3b8', labelKey: 'color.silver' },
  { id: '#111827', labelKey: 'color.obsidian' },
]

export const PATTERNS: readonly Item<PatternId>[] = [
  { id: 'solid', labelKey: 'pattern.solid' },
  { id: 'stripes', labelKey: 'pattern.stripes' },
  { id: 'hoops', labelKey: 'pattern.hoops' },
  { id: 'half', labelKey: 'pattern.half' },
  { id: 'sash', labelKey: 'pattern.sash' },
]

export const BALLS: readonly Item<BallDesign>[] = [
  { id: 'classic', labelKey: 'ball.classic' },
  { id: 'retro', labelKey: 'ball.retro' },
  { id: 'night', labelKey: 'ball.night' },
  { id: 'neon', labelKey: 'ball.neon' },
  { id: 'gold', labelKey: 'ball.gold' },
  { id: 'camo', labelKey: 'ball.camo' },
]

export const TRAILS: readonly Item<TrailId>[] = [
  { id: 'none', labelKey: 'trail.none' },
  { id: 'sparks', labelKey: 'trail.sparks' },
  { id: 'smoke', labelKey: 'trail.smoke' },
  { id: 'rainbow', labelKey: 'trail.rainbow' },
]

export const STADIUMS: readonly Item<StadiumId>[] = [
  { id: 'day', labelKey: 'stadium.day' },
  { id: 'night', labelKey: 'stadium.night' },
  { id: 'rain', labelKey: 'stadium.rain' },
  { id: 'sunset', labelKey: 'stadium.sunset' },
  { id: 'snow', labelKey: 'stadium.snow' },
]

export const isKnownColor = (id: string) => COLORS.some((c) => c.id.toLowerCase() === id.toLowerCase())
