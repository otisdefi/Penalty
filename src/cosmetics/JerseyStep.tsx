import Pitch from '@/components/Pitch'
import { useI18n } from '@/i18n'
import { JerseyEditor } from './JerseyEditor'
import { displayName } from './identity'
import { useCosmetics } from './store'
import { DEFAULT_LOOK, type Jersey } from './types'

const RIVAL: Jersey = { color: '#3a86ff', number: 7, pattern: 'solid', secondary: '#f1f5f9', tag: '' }

/** "Your jersey": a live preview of the match view and the shirt and name editor. */
export function JerseyStep({ address, disabled = false }: { address?: string; disabled?: boolean }) {
  const { t } = useI18n()
  const mine = useCosmetics()
  const look = { ...DEFAULT_LOOK, ball: mine.ball, trail: mine.trail, stadium: mine.stadium }
  const names = { red: displayName(mine.jersey.tag, address), blue: t('rival.opponent') }
  return (
    <div className="space-y-3 text-left">
      <h3 className="display text-xl font-extrabold">{t('ready.yourJersey')}</h3>
      <div
        className="relative mx-auto overflow-hidden rounded-3xl"
        style={{ border: '1px solid var(--line)', aspectRatio: '320 / 360', width: 'min(100%, calc(28dvh * 320 / 360))' }}
      >
        <Pitch kick={null} kits={{ red: mine.jersey, blue: RIVAL }} pick={null} role="shoot" shooterTeam="red" myTeam="red" names={names} look={look} />
      </div>
      <JerseyEditor disabled={disabled} />
    </div>
  )
}
