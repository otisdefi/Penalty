import type { Dir } from './logic'
import { randomDir } from './logic'
import type { Habits } from './storage'

const DECAY = 0.9
const RANDOMNESS = 0.2

function sample(weights: number[]): Dir {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i as Dir
  }
  return 1
}

/** Learn from the player's shot (the bot was the keeper). */
export function learnShot(h: Habits, dir: Dir): Habits {
  const shots = h.shots.map((v) => v * DECAY) as Habits['shots']
  shots[dir] += 1
  const trans = h.trans.map((row) => [...row]) as Habits['trans']
  if (h.lastShot !== null) trans[h.lastShot][dir] += 1
  return { ...h, shots, trans, lastShot: dir }
}

/** Learn from the player's dive (the bot was the shooter). */
export function learnDive(h: Habits, dir: Dir): Habits {
  const dives = h.dives.map((v) => v * DECAY) as Habits['dives']
  dives[dir] += 1
  return { ...h, dives }
}

/** Bot keeper: dive towards where the player tends to shoot, using frequency plus the previous shot. */
export function botDive(h: Habits): Dir {
  if (Math.random() < RANDOMNESS) return randomDir()
  const w = h.shots.map((v, i) => {
    const t = h.lastShot !== null ? h.trans[h.lastShot][i] : 0
    return Math.pow(1 + v + t * 0.8, 2)
  })
  return sample(w)
}

/** Bot shooter: aim where the player dives least. */
export function botShoot(h: Habits): Dir {
  if (Math.random() < RANDOMNESS) return randomDir()
  const w = h.dives.map((v) => Math.pow(1 / (1 + v), 1.5))
  return sample(w)
}
