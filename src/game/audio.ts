import { getLanguage, translate } from '../i18n'
let ctx: AudioContext | null = null
let muted = false
let unlocked = false
let noiseBuf: AudioBuffer | null = null
let speechTimer: number | undefined
const active = new Set<GainNode>()

export const setMuted = (m: boolean) => {
  muted = m
  if (m) stopAll()
}

/** Audio only starts after the first user tap (browsers require it, and it keeps the page quiet on load). */
function unlock() {
  if (unlocked) return
  unlocked = true
  audio()
  // Prime speech inside the gesture so later, timer-driven utterances are allowed on iOS.
  const synth = speech()
  if (synth && !muted) {
    try {
      const u = new SpeechSynthesisUtterance('')
      u.volume = 0
      synth.speak(u)
    } catch {
      /* speech unavailable: crowd noise still plays */
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { once: true, capture: true })
  window.addEventListener('keydown', unlock, { once: true, capture: true })
}

function audio(): AudioContext | null {
  if (muted || !unlocked) return null
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number } = {}) {
  const c = audio()
  if (!c) return
  const t0 = c.currentTime + (opts.delay ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, t0)
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur)
  const peak = opts.gain ?? 0.15
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/* ---------- crowd (Web Audio filtered noise) ---------- */

function noiseSource(c: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    const len = Math.floor(c.sampleRate * 3.5)
    noiseBuf = c.createBuffer(1, len, c.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  return src
}

function masterGain(c: AudioContext): GainNode {
  const g = c.createGain()
  g.gain.value = 0.0001
  g.connect(c.destination)
  active.add(g)
  return g
}

function release(master: GainNode, sources: AudioScheduledSourceNode[], endAt: number) {
  const last = sources[sources.length - 1]
  for (const s of sources) s.stop(endAt)
  if (last) {
    last.onended = () => {
      master.disconnect()
      active.delete(master)
    }
  }
}

/** Rising crowd roar that swells, holds, then fades (about 2.9 seconds). */
function crowdCheer() {
  const c = audio()
  if (!c) return
  const t0 = c.currentTime
  const master = masterGain(c)
  master.gain.setValueAtTime(0.0001, t0)
  master.gain.exponentialRampToValueAtTime(0.55, t0 + 1.1)
  master.gain.setValueAtTime(0.55, t0 + 2.0)
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.9)

  // Body of the roar: band-passed noise whose centre rises.
  const body = noiseSource(c)
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 0.7
  band.frequency.setValueAtTime(450, t0)
  band.frequency.exponentialRampToValueAtTime(1800, t0 + 1.4)
  const low = c.createBiquadFilter()
  low.type = 'highpass'
  low.frequency.value = 220
  const swell = c.createGain()
  swell.gain.value = 0.8
  body.connect(band).connect(low).connect(swell).connect(master)

  // Crowd texture: slow wobble on the level.
  const lfo = c.createOscillator()
  lfo.frequency.value = 6.5
  const lfoDepth = c.createGain()
  lfoDepth.gain.value = 0.22
  lfo.connect(lfoDepth).connect(swell.gain)

  // Airy top layer (whistles, claps).
  const air = noiseSource(c)
  const airHp = c.createBiquadFilter()
  airHp.type = 'highpass'
  airHp.frequency.value = 3500
  const airGain = c.createGain()
  airGain.gain.setValueAtTime(0.0001, t0)
  airGain.gain.exponentialRampToValueAtTime(0.18, t0 + 1.3)
  air.connect(airHp).connect(airGain).connect(master)

  body.start(t0)
  air.start(t0)
  lfo.start(t0)
  release(master, [body, air, lfo], t0 + 3)
}

/** Short, dull groan: low-passed noise that sinks in pitch and fades out. */
function crowdGroan() {
  const c = audio()
  if (!c) return
  const t0 = c.currentTime
  const master = masterGain(c)
  master.gain.setValueAtTime(0.0001, t0)
  master.gain.exponentialRampToValueAtTime(0.38, t0 + 0.12)
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4)

  const src = noiseSource(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 1.2
  lp.frequency.setValueAtTime(900, t0)
  lp.frequency.exponentialRampToValueAtTime(220, t0 + 1.3)
  const lp2 = c.createBiquadFilter()
  lp2.type = 'lowpass'
  lp2.frequency.value = 1200
  src.connect(lp).connect(lp2).connect(master)
  src.start(t0)
  release(master, [src], t0 + 1.5)
}

/* ---------- commentary (speech synthesis, optional) ---------- */

function speech(): SpeechSynthesis | null {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return null
    return window.speechSynthesis
  } catch {
    return null
  }
}

const SPEECH_LOCALE: Record<string, string> = { en: 'en-US', tr: 'tr-TR', es: 'es-ES', pt: 'pt-BR', ru: 'ru-RU' }

function pickVoice(synth: SpeechSynthesis, lang: string): SpeechSynthesisVoice | null {
  try {
    const voices = synth.getVoices()
    return voices.find((v) => v.lang.toLowerCase().startsWith(lang) && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang)) ?? null
  } catch {
    return null
  }
}

function speak(key: 'speech.goal' | 'speech.miss', o: { pitch: number; rate: number; volume: number; maxMs: number }) {
  if (muted || !unlocked) return
  const synth = speech()
  if (!synth) return
  try {
    synth.cancel()
    // Say it in the player's language when the device has a voice for it, otherwise in English.
    const language = getLanguage()
    const localVoice = pickVoice(synth, language)
    const voice = localVoice ?? pickVoice(synth, 'en')
    const u = new SpeechSynthesisUtterance(translate(key, undefined, localVoice ? language : 'en'))
    u.pitch = o.pitch
    u.rate = o.rate
    u.volume = o.volume
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    } else {
      u.lang = localVoice ? (SPEECH_LOCALE[language] ?? language) : 'en-US'
    }
    synth.speak(u)
    window.clearTimeout(speechTimer)
    speechTimer = window.setTimeout(() => {
      try {
        synth.cancel()
      } catch {
        /* ignore */
      }
    }, o.maxMs)
  } catch {
    /* speech failed: the crowd noise is still playing */
  }
}

function stopAll() {
  window.clearTimeout(speechTimer)
  try {
    speech()?.cancel()
  } catch {
    /* ignore */
  }
  for (const g of active) {
    try {
      g.gain.cancelScheduledValues(0)
      g.gain.value = 0
      g.disconnect()
    } catch {
      /* ignore */
    }
  }
  active.clear()
}

export const sfx = {
  unlock,
  stopAll,
  tick: () => tone(880, 0.06, { type: 'square', gain: 0.05 }),
  pick: () => tone(520, 0.08, { type: 'triangle', gain: 0.1 }),
  whistle: () => {
    tone(2200, 0.18, { type: 'sine', gain: 0.08 })
    tone(2400, 0.25, { type: 'sine', gain: 0.08, delay: 0.2 })
  },
  kick: () => tone(160, 0.14, { type: 'sine', gain: 0.3, slideTo: 50 }),
  /** Goal: rising crowd roar plus a stretched, excited "Goooal!". */
  goal: () => {
    crowdCheer()
    speak('speech.goal', { pitch: 1.8, rate: 0.55, volume: 1, maxMs: 2900 })
  },
  /** Miss, post or save: dull crowd groan plus a low, drawn-out "Ohhh". */
  save: () => {
    crowdGroan()
    speak('speech.miss', { pitch: 0.35, rate: 0.5, volume: 0.9, maxMs: 1800 })
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', delay: i * 0.14 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'sine', delay: i * 0.2 })),
}
