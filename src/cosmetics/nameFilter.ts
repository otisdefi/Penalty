export const TAG_MAX = 8

/** Only letters, digits, space, dot, dash and underscore can appear in a name tag. */
const DISALLOWED = /[^A-Za-z0-9 ._-]/g

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i' }

// Roots matched anywhere in the tag after normalising (long enough to avoid false positives).
const BLOCKED_ROOTS = [
  'fuck', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'penis', 'vagina', 'pussy', 'asshole', 'bastard', 'nigg', 'fagg',
  'retard', 'nazi', 'hitler', 'porn', 'sexy', 'suicide', 'molest', 'pedo', 'whor', 'twat', 'wank',
]
// Short words only block when they are a whole word, so "class" or "title" stay fine.
const BLOCKED_WORDS = new Set(['ass', 'sex', 'cum', 'tit', 'tits', 'fck', 'wtf', 'kkk', 'dik', 'dick', 'cock', 'rape', 'kill', 'nude', 'hoe', 'fag', 'pimp'])

const LINK_PATTERNS = [/https?/i, /www/i, /:\/\//, /@/, /\.(com|net|org|io|xyz|gg|me|app|co|ly|eth|link|info|biz|ru|cn|tk)\b/i, /(discord|telegram|t\.me|bit\.ly|wa\.me)/i]

const collapse = (s: string) => s.replace(/(.)\1+/g, '$1')

function normalise(s: string): string {
  const mapped = Array.from(s.toLowerCase(), (ch) => LEET[ch] ?? ch).join('')
  return collapse(mapped.replace(/[^a-z]/g, ''))
}

export type TagProblem = 'link' | 'word' | null

/** Returns why a raw name tag is not allowed, or null when it is fine. */
export function tagProblem(raw: string): TagProblem {
  if (LINK_PATTERNS.some((p) => p.test(raw))) return 'link'
  const flat = normalise(raw)
  if (BLOCKED_ROOTS.some((w) => flat.includes(collapse(w)))) return 'word'
  const tokens = raw
    .toLowerCase()
    .split(/[\s._-]+/)
    .map((t) => Array.from(t, (ch) => LEET[ch] ?? ch).join('').replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1'))
    .filter(Boolean)
  if (tokens.some((t) => BLOCKED_WORDS.has(t))) return 'word'
  return null
}

/** Strips unsupported characters and enforces the length limit. Does not judge the content. */
export function trimTag(raw: string): string {
  return raw.replace(DISALLOWED, '').replace(/\s+/g, ' ').trimStart().slice(0, TAG_MAX)
}

/** Final, safe tag: empty when anything about it is not allowed. Used for stored and received tags. */
export function safeTag(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = trimTag(raw).trim()
  return tagProblem(raw) || tagProblem(trimmed) ? '' : trimmed
}

export function tagMessage(problem: TagProblem): string | null {
  if (problem === 'link') return 'Links and handles are not allowed in a name tag.'
  if (problem === 'word') return 'That name tag is not allowed. Try another one.'
  return null
}
