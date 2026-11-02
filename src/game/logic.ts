export type Dir = 0 | 1 | 2
export type Team = 'red' | 'blue'

export const DIRS: readonly string[] = ['LEFT', 'CENTER', 'RIGHT']
export const REGULATION = 5
export const CHOICE_SECONDS = 10

export interface Kick {
  shooter: Team
  shot: Dir
  dive: Dir
  goal: boolean
}

export interface Status {
  red: number
  blue: number
  redKicks: boolean[]
  blueKicks: boolean[]
  slots: number
  winner: Team | null
}

export const otherTeam = (t: Team): Team => (t === 'red' ? 'blue' : 'red')

/** Red kicks first, then teams alternate. kickIndex is 0-based. */
export const shooterOf = (kickIndex: number): Team => (kickIndex % 2 === 0 ? 'red' : 'blue')

export const randomDir = (): Dir => Math.floor(Math.random() * 3) as Dir

export function makeKick(kickIndex: number, myTeam: Team, mine: Dir, theirs: Dir): Kick {
  const shooter = shooterOf(kickIndex)
  const shot = shooter === myTeam ? mine : theirs
  const dive = shooter === myTeam ? theirs : mine
  return { shooter, shot, dive, goal: shot !== dive }
}

export function getStatus(kicks: Kick[]): Status {
  const redKicks = kicks.filter((k) => k.shooter === 'red').map((k) => k.goal)
  const blueKicks = kicks.filter((k) => k.shooter === 'blue').map((k) => k.goal)
  const red = redKicks.filter(Boolean).length
  const blue = blueKicks.filter(Boolean).length
  const n = kicks.length
  let winner: Team | null = null

  if (n < REGULATION * 2) {
    const redLeft = REGULATION - redKicks.length
    const blueLeft = REGULATION - blueKicks.length
    if (red > blue + blueLeft) winner = 'red'
    else if (blue > red + redLeft) winner = 'blue'
  } else if (n % 2 === 0 && red !== blue) {
    winner = red > blue ? 'red' : 'blue'
  }

  const slots = n >= REGULATION * 2 ? Math.floor(n / 2) + 1 : REGULATION
  return { red, blue, redKicks, blueKicks, slots, winner }
}

export function randomMatchId(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  bytes[0] |= 1 // never the zero id
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const commitInput = (round: number, dir: Dir, nonce: string) => `${round}:${dir}:${nonce}`
