import { useState } from 'react'
import { LanguageButton } from '@/components/LanguageButton'
import { useT } from '@/i18n'
import { displayName } from '@/cosmetics/identity'
import { resolveKits } from '@/cosmetics/kits'
import { ConnectKitButton } from 'connectkit'
import { Menu } from '@/components/Menu'
import { MatchScreen } from '@/components/MatchScreen'
import { FriendLobby } from '@/components/FriendLobby'
import { Leaderboard } from '@/components/Leaderboard'
import { OnlineHome, type Invite } from '@/online/OnlineHome'
import { OnlineMatchScreen } from '@/online/OnlineMatchScreen'
import { isBytes32 } from '@/online/helpers'
import { isRoomId, type FriendLink } from '@/game/peer'
import type { Jersey } from '@/game/storage'
import { CustomizeScreen } from '@/cosmetics/CustomizeScreen'
import { useCosmetics } from '@/cosmetics/store'
import type { StadiumId } from '@/cosmetics/types'
import { TestnetBadge } from '@/components/TestnetBadge'
import { setMuted } from '@/game/audio'
import { isMuted, unlockAudio } from '@/lib/whistle'
import type { Team } from '@/game/logic'

type Screen =
  | { name: 'menu' }
  | { name: 'onlineHome' }
  | { name: 'customize' }
  | { name: 'online'; id: bigint }
  | { name: 'lobby'; role: 'host' | 'guest'; room: string | null }
  | {
      name: 'match'
      id: number
      mode: 'bot' | 'friend'
      ranked: boolean
      myTeam: Team
      kits: Record<Team, Jersey>
      link: FriendLink | null
      /** Display name of each team's player. */
      names: Record<Team, string>
      /** The guest's shirt colour was switched because it matched the host's. */
      recolored: boolean
      /** The host's stadium, shown to both players in friend matches. */
      stadium?: StadiumId
    }

const BOT_COLORS = ['#3a86ff', '#ffd23f', '#06d6a0', '#ff4d9d']

function distinct(mine: Jersey, theirs: Jersey): Jersey {
  if (mine.color.toLowerCase() !== theirs.color.toLowerCase()) return theirs
  const alt = BOT_COLORS.find((c) => c.toLowerCase() !== mine.color.toLowerCase()) ?? '#3a86ff'
  return { ...theirs, color: alt }
}

function readInvite(): string | null {
  const room = new URLSearchParams(window.location.search).get('room')
  return isRoomId(room) ? room : null
}

// One remembered mute choice drives both the whistle and the crowd sounds.
function readOnlineInvite(): Invite | null {
  const idText = new URLSearchParams(window.location.search).get('match')
  const code = window.location.hash.slice(1)
  if (!idText || !/^\d{1,18}$/.test(idText) || !isBytes32(code)) return null
  return { id: BigInt(idText), code }
}

setMuted(isMuted())
// The first tap anywhere unlocks audio for browsers that block it until a gesture.
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true })

export default function App() {
  const t = useT()
  const [onlineInvite, setOnlineInvite] = useState<Invite | null>(readOnlineInvite)
  const [screen, setScreen] = useState<Screen>(() => (readOnlineInvite() ? { name: 'onlineHome' } : { name: 'menu' }))
  const cosmetics = useCosmetics()
  const jersey = cosmetics.jersey
  const [invite, setInvite] = useState<string | null>(readInvite)
  const [counter, setCounter] = useState(0)

  const startBot = (ranked: boolean) => {
    const rival = distinct(jersey, { color: '#3a86ff', number: 7 })
    const mine = { ...jersey, tag: displayName(jersey.tag) }
    setCounter((c) => c + 1)
    setScreen({
      name: 'match',
      id: counter + 1,
      mode: 'bot',
      ranked,
      myTeam: 'red',
      kits: { red: mine, blue: rival },
      link: null,
      names: { red: mine.tag, blue: t('rival.bot') },
      recolored: false,
    })
  }

  const startFriend = (role: 'host' | 'guest', link: FriendLink, theirs: Jersey, hostStadium?: StadiumId) => {
    const mine = { ...jersey, tag: displayName(jersey.tag) }
    const myTeam: Team = role === 'host' ? 'red' : 'blue'
    // The host keeps their colour; if both picked the same one, the guest is shown in a contrasting colour.
    const { host, guest, recolored } = role === 'host' ? resolveKits(mine, theirs) : resolveKits(theirs, mine)
    const theirName = theirs.tag || t('rival.friend')
    setCounter((c) => c + 1)
    setScreen({
      name: 'match',
      id: counter + 1,
      mode: 'friend',
      ranked: false,
      myTeam,
      kits: { red: host, blue: guest },
      link,
      names: myTeam === 'red' ? { red: mine.tag, blue: theirName } : { red: theirName, blue: mine.tag },
      recolored,
      stadium: role === 'guest' ? hostStadium : undefined,
    })
  }

  const clearInvite = () => {
    setInvite(null)
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
  }

  const toMenu = () => {
    if (screen.name === 'match') screen.link?.close()
    setScreen({ name: 'menu' })
  }

  const leaveOnline = () => {
    if (onlineInvite && window.location.search) window.history.replaceState(null, '', window.location.pathname)
    setOnlineInvite(null)
    setScreen({ name: 'menu' })
  }

  if (screen.name === 'customize') {
    return <CustomizeScreen onBack={() => setScreen({ name: 'menu' })} />
  }

  if (screen.name === 'online') {
    return <OnlineMatchScreen key={screen.id.toString()} matchId={screen.id} onExit={() => setScreen({ name: 'onlineHome' })} />
  }

  if (screen.name === 'match') {
    return (
      <MatchScreen
        key={screen.id}
        mode={screen.mode}
        ranked={screen.ranked}
        myTeam={screen.myTeam}
        kits={screen.kits}
        link={screen.link}
        names={screen.names}
        recolored={screen.recolored}
        stadium={screen.stadium}
        onExit={toMenu}
      />
    )
  }

  return (
    <div className="relative min-h-dvh overflow-hidden" style={{ background: 'radial-gradient(120% 80% at 50% -10%, #12306b 0%, #060d1f 60%)' }}>
      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-12 pt-4">
        <header className="mb-6 flex items-center justify-between">
          <TestnetBadge />
          <div className="flex items-center gap-2">
          <LanguageButton />
          <ConnectKitButton.Custom>
            {({ isConnected, show, truncatedAddress }) => (
              <button type="button" onClick={show} className="btn btn-ghost" style={{ width: 'auto', minHeight: 44 }}>
                {isConnected ? truncatedAddress : t('app.connect')}
              </button>
            )}
          </ConnectKitButton.Custom>
          </div>
        </header>

        {screen.name === 'onlineHome' ? (
          <OnlineHome
            invite={onlineInvite}
            onEnter={(id) => {
              setOnlineInvite(null)
              if (window.location.search || window.location.hash) window.history.replaceState(null, '', window.location.pathname)
              setScreen({ name: 'online', id })
            }}
            onBack={leaveOnline}
          />
        ) : screen.name === 'lobby' ? (
          <FriendLobby
            key={`${screen.role}-${screen.room ?? 'host'}`}
            role={screen.role}
            room={screen.room}
            jersey={jersey}
            onReady={(link, theirs, hostStadium) => {
              if (screen.role === 'guest') clearInvite()
              startFriend(screen.role, link, theirs, hostStadium)
            }}
            onCancel={() => {
              if (screen.role === 'guest') clearInvite()
              setScreen({ name: 'menu' })
            }}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="mx-auto w-full max-w-md lg:mx-0">
              <Menu
                jersey={jersey}
                onCustomize={() => setScreen({ name: 'customize' })}
                invited={invite !== null}
                onRanked={() => startBot(true)}
                onPractice={() => startBot(false)}
                onHost={() => setScreen({ name: 'lobby', role: 'host', room: null })}
                onOnline={() => setScreen({ name: 'onlineHome' })}
                onJoinInvite={() => invite && setScreen({ name: 'lobby', role: 'guest', room: invite })}
                onJoinCode={(room) => setScreen({ name: 'lobby', role: 'guest', room })}
              />
            </div>
            <div className="mx-auto w-full max-w-md lg:mx-0">
              <Leaderboard />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
