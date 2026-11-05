import { useEffect, useRef, useState } from 'react'
import type { DataConnection, Peer } from 'peerjs'
import type { Jersey, StadiumId } from '@/cosmetics/types'
import { isStadium, parseJersey } from '@/cosmetics/validate'

interface Args {
  matchId: bigint
  /** 1 = home player (match creator), 2 = away player, 0 = not a player. */
  seat: 0 | 1 | 2
  selfAddress: string | undefined
  rivalAddress: string | undefined
  jersey: Jersey
  stadium: StadiumId
  /** Turn on once both players are in the match. */
  enabled: boolean
}

export interface SyncedLook {
  /** The opponent's shirt, or null until it arrives (the game then uses a default). */
  rival: Jersey | null
  /** The home player's stadium, or null until it arrives. */
  homeStadium: StadiumId | null
}

const RETRY_MS = 3000
const MAX_TRIES = 25

/** Both wallets can work out each other's peer id from the match id and public addresses. */
const peerId = (matchId: bigint, seat: 1 | 2, address: string) => `tbm${matchId.toString()}-${seat}-${address.slice(2, 10).toLowerCase()}`

/**
 * Shares looks (shirt colour, pattern, number, name tag and the home stadium) over a direct
 * peer-to-peer link, because the match contract only stores moves. Everything received is
 * validated and only used for drawing. If the link cannot be made, defaults are used.
 */
export function useCosmeticSync({ matchId, seat, selfAddress, rivalAddress, jersey, stadium, enabled }: Args): SyncedLook {
  const [rival, setRival] = useState<Jersey | null>(null)
  const [homeStadium, setHomeStadium] = useState<StadiumId | null>(null)
  const mine = useRef({ jersey, stadium })

  useEffect(() => {
    mine.current = { jersey, stadium }
  })

  useEffect(() => {
    if (!enabled || (seat !== 1 && seat !== 2) || !selfAddress || !rivalAddress) return
    const rivalSeat = seat === 1 ? 2 : 1
    let cancelled = false
    let received = false
    let tries = 0
    let peer: Peer | null = null
    let timer: ReturnType<typeof setInterval> | undefined

    const payload = () => ({ t: 'look', jersey: mine.current.jersey, stadium: seat === 1 ? mine.current.stadium : undefined })

    const wire = (conn: DataConnection) => {
      conn.on('open', () => {
        void conn.send(payload())
      })
      conn.on('data', (raw) => {
        if (!raw || typeof raw !== 'object') return
        const msg = raw as Record<string, unknown>
        if (msg.t !== 'look') return
        const theirs = parseJersey(msg.jersey)
        if (!theirs) return
        received = true
        setRival(theirs)
        if (rivalSeat === 1 && isStadium(msg.stadium)) setHomeStadium(msg.stadium)
      })
      conn.on('error', () => undefined)
    }

    void (async () => {
      try {
        const { Peer: PeerCtor } = await import('peerjs')
        if (cancelled) return
        const p = new PeerCtor(peerId(matchId, seat, selfAddress), { debug: 0 })
        peer = p
        p.on('connection', wire)
        p.on('error', () => undefined) // unreachable broker or taken id: play with default looks
        p.on('open', () => {
          const dial = () => {
            if (cancelled || received || tries >= MAX_TRIES) return
            tries += 1
            wire(p.connect(peerId(matchId, rivalSeat, rivalAddress), { reliable: true, serialization: 'json' }))
          }
          dial()
          timer = setInterval(dial, RETRY_MS)
        })
      } catch {
        /* peer-to-peer unavailable: defaults are used */
      }
    })()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      peer?.destroy()
    }
  }, [enabled, matchId, rivalAddress, seat, selfAddress])

  return { rival, homeStadium }
}
