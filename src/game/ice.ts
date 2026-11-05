import type { PeerOptions } from 'peerjs'

/** Several public STUN servers from different providers, so at least one is reachable on most networks. */
const STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
  'stun:global.stun.twilio.com:3478',
]

const env = import.meta.env as Record<string, string | undefined>

/**
 * Optional TURN relay for networks that block direct connections (strict mobile or office NATs).
 * Credentials come from environment variables, never from the code:
 *   VITE_TURN_URLS        comma separated, e.g. turn:relay.example.com:3478,turns:relay.example.com:443
 *   VITE_TURN_USERNAME
 *   VITE_TURN_CREDENTIAL
 * Anything prefixed VITE_ is visible to players in the built app, so use a relay account meant for
 * browsers (short-lived or usage-limited credentials).
 */
function turnServers(): RTCIceServer[] {
  const urls = (env.VITE_TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => /^turns?:/.test(u))
  const username = env.VITE_TURN_USERNAME
  const credential = env.VITE_TURN_CREDENTIAL
  if (urls.length === 0 || !username || !credential) return []
  return [{ urls, username, credential }]
}

export const turnConfigured = (): boolean => turnServers().length > 0

/**
 * Shared PeerJS options for every peer-to-peer link. The default matchmaking (signaling) service is
 * the free PeerJS cloud. To use your own PeerJS server instead, set VITE_PEER_HOST (and optionally
 * VITE_PEER_PORT, VITE_PEER_PATH, VITE_PEER_SECURE=false).
 */
export function peerOptions(): PeerOptions {
  const opts: PeerOptions = {
    debug: 0,
    // The signaling socket sends a heartbeat this often, so idle rooms are not dropped by the server or by mobile networks.
    pingInterval: 4000,
    config: {
      iceServers: [{ urls: STUN_URLS }, ...turnServers()],
      iceCandidatePoolSize: 4,
    },
  }
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST
    if (env.VITE_PEER_PORT && Number.isFinite(Number(env.VITE_PEER_PORT))) opts.port = Number(env.VITE_PEER_PORT)
    if (env.VITE_PEER_PATH) opts.path = env.VITE_PEER_PATH
    opts.secure = env.VITE_PEER_SECURE !== 'false'
  }
  return opts
}
