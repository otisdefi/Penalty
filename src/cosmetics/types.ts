export type PatternId = 'solid' | 'stripes' | 'hoops' | 'half' | 'sash'
export type BallDesign = 'classic' | 'neon' | 'gold' | 'night' | 'retro' | 'camo'
export type TrailId = 'none' | 'sparks' | 'smoke' | 'rainbow'
export type StadiumId = 'day' | 'night' | 'rain' | 'sunset' | 'snow'

/** A player's shirt. Extra fields are optional so older code that only knows color and number keeps working. */
export interface Jersey {
  color: string
  number: number
  pattern?: PatternId
  secondary?: string
  /** Short name tag, at most 8 characters, already filtered. */
  tag?: string
}

/** How the match view looks for the local player. */
export interface Look {
  ball: BallDesign
  trail: TrailId
  stadium: StadiumId
}

export interface Cosmetics {
  jersey: Jersey
  ball: BallDesign
  trail: TrailId
  stadium: StadiumId
}

export const DEFAULT_LOOK: Look = { ball: 'classic', trail: 'none', stadium: 'day' }

export const DEFAULT_COSMETICS: Cosmetics = {
  jersey: { color: '#e5383b', number: 10, pattern: 'solid', secondary: '#f1f5f9', tag: '' },
  ball: 'classic',
  trail: 'none',
  stadium: 'day',
}
