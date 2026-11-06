import { useCallback, useEffect, useRef, useState } from 'react'
import { botDive, botShoot, learnDive, learnShot } from '../game/bot'
import { sfx } from '../game/audio'
import {
  CHOICE_SECONDS,
  commitInput,
  getStatus,
  makeKick,
  randomDir,
  randomMatchId,
  randomNonce,
  sha256Hex,
  shooterOf,
  type Dir,
  type Kick,
  type Team,
} from '../game/logic'
import type { FriendLink, Msg } from '../game/peer'
import { loadHabits, saveHabits } from '../game/storage'
import { playWhistle } from '../lib/whistle'
import type { MessageKey } from '../i18n'

export type Phase = 'whistle' | 'choosing' | 'waiting' | 'reveal' | 'done' | 'aborted'

const REVEAL_MS = 2100
const OPPONENT_TIMEOUT_MS = 25000

interface Options {
  mode: 'bot' | 'friend'
  myTeam: Team
  link: FriendLink | null
}

interface Mine {
  dir: Dir
  nonce: string
  round: number
  sent: boolean
}

export function useMatch({ mode, myTeam, link }: Options) {
  const [kicks, setKicks] = useState<Kick[]>([])
  const [phase, setPhaseState] = useState<Phase>('whistle')
  const [secondsLeft, setSecondsLeft] = useState(CHOICE_SECONDS)
  const [myPick, setMyPick] = useState<Dir | null>(null)
  const [anim, setAnim] = useState<Kick | null>(null)
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const [abortReason, setAbortReason] = useState<MessageKey | null>(null)
  const [matchId, setMatchId] = useState<`0x${string}`>(randomMatchId)
  const [rematchWait, setRematchWait] = useState(false)
  const [friendGone, setFriendGone] = useState(false)

  const kicksRef = useRef<Kick[]>([])
  const phaseRef = useRef<Phase>('whistle')
  const habitsRef = useRef(loadHabits())
  const deadlineRef = useRef(Number.POSITIVE_INFINITY)
  const lastSecRef = useRef(CHOICE_SECONDS)
  const mineRef = useRef<Mine | null>(null)
  const oppCommit = useRef(new Map<number, string>())
  const oppReveal = useRef(new Map<number, { d: Dir; n: string }>())
  const revealSent = useRef(-1)
  const verifying = useRef(-1)
  const resolvedRound = useRef(-1)
  const myAgain = useRef(false)
  const oppAgain = useRef(false)
  const timers = useRef<number[]>([])
  const roundToken = useRef(0)
  const aliveRef = useRef(true)

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timers.current.push(id)
    return id
  }, [])

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }, [])

  /** The referee whistles first; only then do the choice buttons open and the countdown begin. */
  const beginWhistle = useCallback(() => {
    const token = ++roundToken.current
    deadlineRef.current = Number.POSITIVE_INFINITY
    lastSecRef.current = CHOICE_SECONDS
    const open = () => {
      if (!aliveRef.current || roundToken.current !== token || phaseRef.current !== 'whistle') return
      deadlineRef.current = Date.now() + CHOICE_SECONDS * 1000
      setPhase('choosing')
    }
    // playWhistle never rejects and resolves right away if audio is muted or blocked.
    void playWhistle().then(open, open)
  }, [setPhase])

  const startRound = useCallback(() => {
    mineRef.current = null
    setSecondsLeft(CHOICE_SECONDS)
    setMyPick(null)
    setPhase('whistle')
    beginWhistle()
  }, [beginWhistle, setPhase])

  const abort = useCallback(
    (reason: MessageKey) => {
      if (phaseRef.current === 'done') return
      clearTimers()
      setAbortReason(reason)
      setPhase('aborted')
    },
    [clearTimers, setPhase],
  )

  const beginReveal = useCallback(
    (kick: Kick) => {
      clearTimers()
      setAnim(kick)
      setPhase('reveal')
      sfx.kick()
      later(() => (kick.goal ? sfx.goal() : sfx.save()), 450)
      later(() => {
        const next = [...kicksRef.current, kick]
        kicksRef.current = next
        setKicks(next)
        setAnim(null)
        const { winner } = getStatus(next)
        if (winner) {
          setPhase('done')
          const jingle = () => {
            if (!aliveRef.current) return
            if (winner === myTeam) sfx.win()
            else sfx.lose()
          }
          // Final whistle, then the result jingle.
          void playWhistle().then(jingle, jingle)
        } else {
          startRound()
        }
      }, REVEAL_MS)
    },
    [clearTimers, later, myTeam, setPhase, startRound],
  )

  const resolve = useCallback(
    (mine: Dir, theirs: Dir) => {
      const round = kicksRef.current.length
      if (resolvedRound.current === round) return
      resolvedRound.current = round
      beginReveal(makeKick(round, myTeam, mine, theirs))
    },
    [beginReveal, myTeam],
  )

  const tryAdvance = useCallback(() => {
    const m = mineRef.current
    if (!link || !m || !m.sent) return
    const r = m.round
    const theirCommit = oppCommit.current.get(r)
    if (!theirCommit) return
    if (revealSent.current !== r) {
      revealSent.current = r
      link.send({ t: 'reveal', r, d: m.dir, n: m.nonce })
    }
    const rev = oppReveal.current.get(r)
    if (!rev || verifying.current === r) return
    verifying.current = r
    void sha256Hex(commitInput(r, rev.d, rev.n)).then((hash) => {
      if (hash !== theirCommit) abort('match.abort.invalid')
      else resolve(m.dir, rev.d)
    })
  }, [abort, link, resolve])

  const submit = useCallback(
    (dir: Dir) => {
      if (phaseRef.current !== 'choosing') return
      const round = kicksRef.current.length
      const iShoot = shooterOf(round) === myTeam
      setMyPick(dir)
      sfx.pick()

      if (mode === 'bot') {
        const h = habitsRef.current
        const botPick = iShoot ? botDive(h) : botShoot(h)
        habitsRef.current = iShoot ? learnShot(h, dir) : learnDive(h, dir)
        saveHabits(habitsRef.current)
        resolve(dir, botPick)
        return
      }

      if (!link) return
      const nonce = randomNonce()
      mineRef.current = { dir, nonce, round, sent: false }
      setPhase('waiting')
      void sha256Hex(commitInput(round, dir, nonce)).then((h) => {
        const m = mineRef.current
        if (!m || m.round !== round) return
        link.send({ t: 'commit', r: round, h })
        m.sent = true
        later(() => {
          if (phaseRef.current === 'waiting') abort('match.abort.silent')
        }, OPPONENT_TIMEOUT_MS)
        tryAdvance()
      })
    },
    [abort, later, link, mode, myTeam, resolve, setPhase, tryAdvance],
  )

  const reset = useCallback(() => {
    clearTimers()
    kicksRef.current = []
    setKicks([])
    setAnim(null)
    setAbortReason(null)
    setNotice(null)
    setRematchWait(false)
    oppCommit.current.clear()
    oppReveal.current.clear()
    revealSent.current = -1
    verifying.current = -1
    resolvedRound.current = -1
    myAgain.current = false
    oppAgain.current = false
    setMatchId(randomMatchId())
    startRound()
  }, [clearTimers, startRound])

  const handleMessage = useCallback(
    (msg: Msg) => {
      const round = kicksRef.current.length
      if (msg.t === 'commit') {
        if (msg.r < round || msg.r > round + 1 || oppCommit.current.has(msg.r)) return
        oppCommit.current.set(msg.r, msg.h)
        tryAdvance()
      } else if (msg.t === 'reveal') {
        if (!oppCommit.current.has(msg.r) || oppReveal.current.has(msg.r)) return
        oppReveal.current.set(msg.r, { d: msg.d, n: msg.n })
        tryAdvance()
      } else if (msg.t === 'again') {
        oppAgain.current = true
        if (myAgain.current && phaseRef.current === 'done') reset()
      }
    },
    [reset, tryAdvance],
  )

  // Track mounting so late audio callbacks never touch a closed match.
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Opening whistle for the first round.
  useEffect(() => {
    beginWhistle()
  }, [beginWhistle])

  // Friend wiring.
  useEffect(() => {
    link?.setHandlers({
      onMessage: handleMessage,
      onClose: () => {
        if (phaseRef.current === 'done') setFriendGone(true)
        else abort('match.abort.left')
      },
    })
    return () => {
      clearTimers()
      link?.setHandlers({})
    }
  }, [link, handleMessage, abort, clearTimers])

  // Choice countdown. When it reaches zero a random direction is chosen.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (phaseRef.current !== 'choosing') return
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000))
      if (left !== lastSecRef.current) {
        lastSecRef.current = left
        setSecondsLeft(left)
        if (left > 0 && left <= 3) sfx.tick()
      }
      if (left <= 0) {
        setNotice('match.notice.timeout')
        submit(randomDir())
      }
    }, 150)
    return () => window.clearInterval(id)
  }, [submit])

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(id)
  }, [notice])

  const requestRematch = useCallback(() => {
    if (mode === 'bot') return reset()
    if (!link || friendGone) return
    myAgain.current = true
    link.send({ t: 'again' })
    if (oppAgain.current) reset()
    else setRematchWait(true)
  }, [friendGone, link, mode, reset])

  const status = getStatus(kicks)
  const round = kicks.length
  const activeShooter = anim ? anim.shooter : shooterOf(round)
  const role: 'shoot' | 'dive' = activeShooter === myTeam ? 'shoot' : 'dive'

  return {
    kicks,
    status,
    round,
    phase,
    secondsLeft,
    myPick,
    anim,
    notice,
    abortReason,
    matchId,
    role,
    rematchWait,
    friendGone,
    won: status.winner === myTeam,
    submit,
    requestRematch,
  }
}
