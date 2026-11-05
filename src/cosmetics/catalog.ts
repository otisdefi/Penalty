import type { BallDesign, PatternId, StadiumId, TrailId } from './types'

export interface Item<T extends string> {
  id: T
  label: string
}

export interface ColorItem {
  id: string
  label: string
}

/** Shirt colours (also used for the secondary colour). */
export const COLORS: readonly ColorItem[] = [
  { id: '#e5383b', label: 'Red' },
  { id: '#fb5607', label: 'Orange' },
  { id: '#ffb703', label: 'Amber' },
  { id: '#c6ff3d', label: 'Lime' },
  { id: '#06d6a0', label: 'Green' },
  { id: '#2ec4b6', label: 'Teal' },
  { id: '#38bdf8', label: 'Sky' },
  { id: '#3a86ff', label: 'Blue' },
  { id: '#4f46e5', label: 'Indigo' },
  { id: '#8338ec', label: 'Purple' },
  { id: '#ff4d9d', label: 'Pink' },
  { id: '#f1f5f9', label: 'White' },
  { id: '#9b1c31', label: 'Crimson' },
  { id: '#d4a017', label: 'Gold' },
  { id: '#94a3b8', label: 'Silver' },
  { id: '#111827', label: 'Obsidian' },
]

export const PATTERNS: readonly Item<PatternId>[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'hoops', label: 'Hoops' },
  { id: 'half', label: 'Half and half' },
  { id: 'sash', label: 'Sash' },
]

export const BALLS: readonly Item<BallDesign>[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'retro', label: 'Retro' },
  { id: 'night', label: 'Night' },
  { id: 'neon', label: 'Neon' },
  { id: 'gold', label: 'Gold' },
  { id: 'camo', label: 'Camo' },
]

export const TRAILS: readonly Item<TrailId>[] = [
  { id: 'none', label: 'None' },
  { id: 'sparks', label: 'Sparks' },
  { id: 'smoke', label: 'Smoke' },
  { id: 'rainbow', label: 'Rainbow' },
]

export const STADIUMS: readonly Item<StadiumId>[] = [
  { id: 'day', label: 'Day grass' },
  { id: 'night', label: 'Night lights' },
  { id: 'rain', label: 'Rainy' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'snow', label: 'Snow' },
]

export const isKnownColor = (id: string) => COLORS.some((c) => c.id.toLowerCase() === id.toLowerCase())
