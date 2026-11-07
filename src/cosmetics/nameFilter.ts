import type { MessageKey } from '../i18n/types'

/** Longest player name. */
export const NAME_MAX = 12
/** Older name for the same limit. */
export const TAG_MAX = NAME_MAX

/** Letters (any language), digits, space and basic punctuation. Everything else is dropped. */
const DISALLOWED = /[^\p{L}\p{N} .,'!?_-]/gu

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '!': 'i' }
const FOLD: Record<string, string> = { ı: 'i', ß: 'ss', ø: 'o', ł: 'l', đ: 'd' }

/*
 * Blocklists for the languages the game speaks. Roots match anywhere in the name once it has been
 * normalised (accents removed, look-alike digits mapped, repeats collapsed), so they are kept long
 * enough to avoid blocking ordinary words. Short words only block when they stand alone.
 */
const BLOCKED_ROOTS = [
  // English
  'fuck', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'penis', 'vagina', 'pussy', 'asshole', 'bastard', 'nigg', 'fagg',
  'retard', 'nazi', 'hitler', 'porn', 'sexy', 'suicide', 'molest', 'pedo', 'twat', 'wank',
  // Turkish
  'orospu', 'siktir', 'yarrak', 'amcik', 'sikik', 'gotveren', 'pezevenk', 'kahpe', 'gavat',
  // Spanish
  'mierda', 'cabron', 'pendejo', 'joder', 'gilipollas', 'maricon', 'chingad', 'culero', 'zorra',
  // Portuguese
  'caralho', 'buceta', 'fodase', 'foder', 'viado', 'merda', 'cacete', 'filhodaputa', 'arrombad',
  // Russian (accents and й/ё are folded away before matching)
  'блят', 'бляд', 'пизд', 'ебан', 'ебат', 'ебал', 'ебуч', 'залуп', 'мудак', 'мудил', 'пидор', 'пидар', 'гондон', 'шлюх', 'дроч', 'хуил', 'хуев', 'хуи',
]
const BLOCKED_WORDS = new Set([
  'ass', 'sex', 'cum', 'tit', 'tits', 'fck', 'wtf', 'kkk', 'dik', 'dick', 'cock', 'rape', 'kill', 'nude', 'hoe', 'fag', 'pimp',
  'amk', 'ibne', 'puta', 'puto', 'verga', 'pinche', 'cono', 'сука', 'хуй', 'хуи', 'бля', 'ебать', 'пидр',
])

const LINK_PATTERNS = [/https?/i, /www/i, /:\/\//, /@/, /\.(com|net|org|io|xyz|gg|me|app|co|ly|eth|link|info|biz|ru|cn|tk|tr|es|br)\b/i, /(discord|telegram|t\.me|bit\.ly|wa\.me)/i]

const collapse = (s: string) => s.replace(/(.)\1+/gu, '$1')

/** Lowercase, remove accents and map look-alike characters so "Ｆüçk" and "f.u.c.k" are caught. */
function fold(s: string): string {
  const base = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  return Array.from(base, (ch) => FOLD[ch] ?? LEET[ch] ?? ch).join('')
}

const lettersOnly = (s: string) => collapse(fold(s).replace(/[^\p{L}]/gu, ''))

export type TagProblem = 'link' | 'word' | null

/** True when the text contains a word from the profanity lists (any supported language). */
export function hasBlockedWord(raw: string): boolean {
  const flat = lettersOnly(raw)
  if (BLOCKED_ROOTS.some((w) => flat.includes(collapse(fold(w))))) return true
  const tokens = raw
    .split(/[\s._,'!?-]+/u)
    .map((t) => fold(t).replace(/[^\p{L}]/gu, '').replace(/(.)\1{2,}/gu, '$1$1'))
    .filter(Boolean)
  return tokens.some((t) => BLOCKED_WORDS.has(t) || BLOCKED_WORDS.has(collapse(t)))
}

/** Returns why a raw name is not allowed, or null when it is fine. */
export function tagProblem(raw: string): TagProblem {
  if (LINK_PATTERNS.some((p) => p.test(raw))) return 'link'
  return hasBlockedWord(raw) ? 'word' : null
}

/** Strips unsupported characters and enforces the length limit. Does not judge the content. */
export function trimTag(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(DISALLOWED, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, NAME_MAX)
}

/** Final, safe name: empty when anything about it is not allowed. Used for stored and received names. */
export function safeTag(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = trimTag(raw).trim()
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return ''
  return tagProblem(raw) || tagProblem(trimmed) ? '' : trimmed
}

export function tagMessage(problem: TagProblem): MessageKey | null {
  if (problem === 'link') return 'tag.link'
  if (problem === 'word') return 'tag.word'
  return null
}
