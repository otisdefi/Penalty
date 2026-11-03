import { sfx } from '@/game/audio'
import { unlockAudio } from '@/lib/whistle'

/** Call from a click so the whistle and crowd sounds are allowed to play later. */
export function unlockAudioTap(): void {
  unlockAudio()
  sfx.unlock()
}
