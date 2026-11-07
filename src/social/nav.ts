import type { ChallengeMode, Challenge } from './api'

/*
 * A tiny bridge between the social parts (profile card, challenge notifications) and the screens in App.
 * The social parts ask for things ("open my profile", "start a challenge"); App decides how to show them.
 */

export type SocialEvent =
  | { type: 'openMyProfile' }
  | { type: 'startChallenge'; username: string; mode: ChallengeMode }

const listeners = new Set<(e: SocialEvent) => void>()

export const onSocialEvent = (fn: (e: SocialEvent) => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = (e: SocialEvent) => listeners.forEach((fn) => fn(e))

export const openMyProfile = () => emit({ type: 'openMyProfile' })
export const startChallenge = (username: string, mode: ChallengeMode) => emit({ type: 'startChallenge', username, mode })

/** What App tells the challenge notifications about the current screen. */
export const appBridge: {
  /** True while a match is being played: new invites are answered "busy" and cannot be accepted. */
  busy: boolean
  /** Opens the room for an accepted challenge. */
  onAccepted: (challenge: Challenge) => void
} = {
  busy: false,
  onAccepted: () => undefined,
}
