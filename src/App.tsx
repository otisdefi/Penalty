import { useEffect, useState } from 'react'
import { LanguageButton } from '@/components/LanguageButton'
import { AccountChip } from '@/chat/AccountChip'
import { AuthDialog } from '@/chat/AuthDialog'
import { ChatPanel } from '@/chat/ChatPanel'
import { startAuth, useAuth } from '@/chat/account'
import { ChallengeHost } from '@/social/ChallengeHost'
import { MyProfile } from '@/social/MyProfile'
import { ProfileCardHost } from '@/social/ProfileCard'
import { appBridge, onSocialEvent } from '@/social/nav'
import { cancelOutgoing, sendChallenge } from '@/social/challenges'
import { loadStored } from '@/online/storage'
import { detectInviteNetwork } from '@/online/detect'
import { getNetwork, networkBySlug, setNetwork, type NetworkId } from '@/networks'
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
import { clearPending, type Jersey } from '@/game/storage'
import { CustomizeScreen } from '@/cosmetics/CustomizeScreen'
import { useCosmetics } from '@/cosmetics/store'
import type { StadiumId } from '@/cosmetics/types'
import { NetworkSelector } from '@/components/NetworkSelector'
import { setMuted } from '@/game/audio'
import { isMuted, unlockAudio } from '@/lib/whistle'
import type { Team } from '@/game/logic'

type Screen =
  | { name: 'menu' }
  | { name: 'onlineHome' }
  | { name: 'customize' }
  | { name: 'profile' }
  | { name: 'online'; id: bigint; network: NetworkId; peer?: string }
  | { name: 'lobby'; role: 'host' | 'guest'; room: string | null; challengeTo?: string; peer?: string }
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
      /** Chat channel of the friend room (friend matches only). */
      roomId?: string
      /** Verified account holders (known from a challenge) per team, shown as round pictures. */
      avatars?: Partial<Record<Team, string>>
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
  const params = new URLSearchParams(window.location.search)
  const idText = params.get('match')
  const code = window.location.hash.slice(1)
  if (!idText || !/^\d{1,18}$/.test(idText) || !isBytes32(code)) return null
  // ?net= names the network; links made before Base Sepolia existed have none and are for Arc Testnet.
  return { id: BigInt(idText), code, network: networkBySlug(params.get('net'))?.id ?? 'arc' }
}

setMuted(isMuted())
// Older versions kept an unsaved ranked result; it is never shown again.
clearPending()
// The first tap anywhere unlocks audio for browsers that block it until a gesture.
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true })

// Restore a saved sign-in in the background (does nothing when chat is not configured).
startAuth()

export default function App() {
  return (
    <>
      <AppScreens />
      <AuthDialog />
      <ProfileCardHost />
      <ChallengeHost />
    </>
  )
}

function AppScreens() {
  const t = useT()
  const [onlineInvite, setOnlineInvite] = useState<Invite | null>(readOnlineInvite)
  const [screen, setScreen] = useState<Screen>(() => (readOnlineInvite() ? { name: 'onlineHome' } : { name: 'menu' }))
  const cosmetics = useCosmetics()
  const jersey = cosmetics.jersey
  const [invite, setInvite] = useState<string | null>(readInvite)
  const [counter, setCounter] = useState(0)
  const [challengeTo, setChallengeTo] = useState<string | null>(null)
  /** The challenger or challenged player for an online match (verified by the database). */
  const [onlinePeer, setOnlinePeer] = useState<string | null>(null)
  const auth = useAuth()
  const myUsername = auth.status === 'in' ? auth.user?.username : undefined

  // Tell the challenge notifications whether I am in a match (new invites then hear "busy").
  const busy = screen.name === 'match' || screen.name === 'online'
  useEffect(() => {
    appBridge.busy = busy
  }, [busy])

  // Accepting a challenge opens the room for me.
  useEffect(() => {
    appBridge.onAccepted = (c) => {
      if (c.mode === 'friendly' && isRoomId(c.roomCode)) {
        setScreen({ name: 'lobby', role: 'guest', room: c.roomCode, peer: c.other })
      } else if (c.mode === 'online' && c.matchId !== null && isBytes32(c.roomCode)) {
        const { matchId, roomCode, other } = c
        // A challenge does not name the network, so look for the one where this room is open with this code.
        void detectInviteNetwork(matchId, roomCode).then((found) => {
          if (found) setNetwork(found)
          setOnlineInvite({ id: matchId, code: roomCode, network: found ?? undefined })
          setOnlinePeer(other)
          setScreen({ name: 'onlineHome' })
        })
      }
    }
  })

  // Requests from the profile card and the account dialog.
  useEffect(
    () =>
      onSocialEvent((e) => {
        if (e.type === 'openMyProfile') {
          setScreen({ name: 'profile' })
        } else if (e.mode === 'friendly') {
          setScreen({ name: 'lobby', role: 'host', room: null, challengeTo: e.username })
        } else {
          setChallengeTo(e.username)
          setOnlinePeer(e.username)
          setScreen({ name: 'onlineHome' })
        }
      }),
    [],
  )

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

  const startFriend = (role: 'host' | 'guest', link: FriendLink, theirs: Jersey, hostStadium?: StadiumId, roomId?: string, peer?: string) => {
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
      roomId,
      avatars: myUsername || peer ? { [myTeam]: myUsername, [myTeam === 'red' ? 'blue' : 'red']: peer } : undefined,
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
    setChallengeTo(null)
    setOnlinePeer(null)
    setScreen({ name: 'menu' })
  }

  if (screen.name === 'profile') {
    return <MyProfile onBack={() => setScreen({ name: 'menu' })} />
  }

  if (screen.name === 'customize') {
    return <CustomizeScreen onBack={() => setScreen({ name: 'menu' })} />
  }

  if (screen.name === 'online') {
    return <OnlineMatchScreen key={`${screen.network}-${screen.id.toString()}`} matchId={screen.id} network={screen.network} peerUsername={screen.peer} onExit={() => setScreen({ name: 'onlineHome' })} />
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
        roomId={screen.roomId}
        avatars={screen.avatars}
        onExit={toMenu}
      />
    )
  }

  return (
    <div className="relative min-h-dvh overflow-hidden" style={{ background: 'radial-gradient(120% 80% at 50% -10%, #12306b 0%, #060d1f 60%)' }}>
      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-12 pt-4">
        {/* Phones: network on the left, language and account as compact buttons on the right, the wallet button on
            its own full-width row. From 640 px up everything sits on one row. */}
        <header className="mb-6 flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <NetworkSelector className="min-w-0 flex-1" />
          <LanguageButton className="shrink-0" />
          <AccountChip />
          <div className="w-full sm:w-auto sm:shrink-0">
            <ConnectKitButton.Custom>
              {({ isConnected, show, truncatedAddress }) => (
                <button type="button" onClick={show} className="btn btn-ghost btn-nowrap" style={{ minHeight: 44, minWidth: 148 }}>
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
              setScreen({ name: 'online', id, network: getNetwork().id, peer: onlinePeer ?? undefined })
              setOnlinePeer(null)
            }}
            onBack={leaveOnline}
            challengeTo={challengeTo}
            onChallengeRoom={async (id) => {
              // The room is made; now send the invite with its code.
              const code = loadStored(getNetwork().id, id)?.roomCode
              if (challengeTo && code) await sendChallenge(challengeTo, 'online', code, id)
              setChallengeTo(null)
            }}
          />
        ) : screen.name === 'lobby' ? (
          <FriendLobby
            key={`${screen.role}-${screen.room ?? 'host'}`}
            role={screen.role}
            room={screen.room}
            jersey={jersey}
            peerUsername={screen.challengeTo ?? screen.peer}
            onRoomReady={screen.challengeTo ? (id) => void sendChallenge(screen.challengeTo!, 'friendly', id) : undefined}
            onReady={(link, theirs, hostStadium, roomId) => {
              if (screen.role === 'guest') clearInvite()
              startFriend(screen.role, link, theirs, hostStadium, roomId, screen.challengeTo ?? screen.peer)
            }}
            onCancel={() => {
              if (screen.role === 'guest') clearInvite()
              if (screen.challengeTo) void cancelOutgoing()
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
            <div className="mx-auto w-full max-w-md space-y-6 lg:mx-0">
              <Leaderboard />
              <ChatPanel channel="lobby" title={t('chat.title.lobby')} height={260} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
