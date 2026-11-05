import type { BallDesign, PatternId, StadiumId, TrailId } from './types'

/** What it takes to use an item. Basic items are free; the rest unlock with ranked results. */
export type Requirement = { kind: 'free' } | { kind: 'wins'; n: number } | { kind: 'streak'; n: number }

export interface UnlockStats {
  wins: number
  bestStreak: number
}

const FREE: Requirement = { kind: 'free' }
const wins = (n: number): Requirement => ({ kind: 'wins', n })
const streak = (n: number): Requirement => ({ kind: 'streak', n })

export function isUnlocked(req: Requirement, stats: UnlockStats): boolean {
  if (req.kind === 'free') return true
  return req.kind === 'wins' ? stats.wins >= req.n : stats.bestStreak >= req.n
}

export function requirementLabel(req: Requirement): string {
  if (req.kind === 'free') return 'Free'
  return req.kind === 'wins' ? `${req.n} ranked ${req.n === 1 ? 'win' : 'wins'}` : `${req.n}-win streak`
}

export interface Item<T extends string> {
  id: T
  label: string
  req: Requirement
}

export interface ColorItem {
  id: string
  label: string
  req: Requirement
}

/** Shirt colours (also used for the secondary colour). */
export const COLORS: readonly ColorItem[] = [
  { id: '#e5383b', label: 'Red', req: FREE },
  { id: '#fb5607', label: 'Orange', req: FREE },
  { id: '#ffb703', label: 'Amber', req: FREE },
  { id: '#c6ff3d', label: 'Lime', req: FREE },
  { id: '#06d6a0', label: 'Green', req: FREE },
  { id: '#2ec4b6', label: 'Teal', req: FREE },
  { id: '#38bdf8', label: 'Sky', req: FREE },
  { id: '#3a86ff', label: 'Blue', req: FREE },
  { id: '#4f46e5', label: 'Indigo', req: FREE },
  { id: '#8338ec', label: 'Purple', req: FREE },
  { id: '#ff4d9d', label: 'Pink', req: FREE },
  { id: '#f1f5f9', label: 'White', req: FREE },
  { id: '#9b1c31', label: 'Crimson', req: FREE },
  { id: '#d4a017', label: 'Gold', req: wins(3) },
  { id: '#94a3b8', label: 'Silver', req: streak(5) },
  { id: '#111827', label: 'Obsidian', req: wins(10) },
]

export const PATTERNS: readonly Item<PatternId>[] = [
  { id: 'solid', label: 'Solid', req: FREE },
  { id: 'stripes', label: 'Stripes', req: FREE },
  { id: 'hoops', label: 'Hoops', req: FREE },
  { id: 'half', label: 'Half and half', req: wins(3) },
  { id: 'sash', label: 'Sash', req: wins(10) },
]

export const BALLS: readonly Item<BallDesign>[] = [
  { id: 'classic', label: 'Classic', req: FREE },
  { id: 'retro', label: 'Retro', req: FREE },
  { id: 'night', label: 'Night', req: FREE },
  { id: 'neon', label: 'Neon', req: wins(3) },
  { id: 'gold', label: 'Gold', req: wins(10) },
  { id: 'camo', label: 'Camo', req: streak(5) },
]

export const TRAILS: readonly Item<TrailId>[] = [
  { id: 'none', label: 'None', req: FREE },
  { id: 'sparks', label: 'Sparks', req: FREE },
  { id: 'smoke', label: 'Smoke', req: wins(3) },
  { id: 'rainbow', label: 'Rainbow', req: streak(5) },
]

export const STADIUMS: readonly Item<StadiumId>[] = [
  { id: 'day', label: 'Day grass', req: FREE },
  { id: 'night', label: 'Night lights', req: FREE },
  { id: 'rain', label: 'Rainy', req: wins(3) },
  { id: 'sunset', label: 'Sunset', req: wins(10) },
  { id: 'snow', label: 'Snow', req: streak(5) },
]

export const reqOf = <T extends string>(list: readonly Item<T>[], id: T): Requirement => list.find((i) => i.id === id)?.req ?? FREE
export const colorReq = (id: string): Requirement => COLORS.find((c) => c.id.toLowerCase() === id.toLowerCase())?.req ?? FREE
export const isKnownColor = (id: string) => COLORS.some((c) => c.id.toLowerCase() === id.toLowerCase())
