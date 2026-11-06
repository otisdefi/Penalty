import { useMemo, useSyncExternalStore } from 'react'
import en from './locales/en'
import type { Locale, MessageKey, Params } from './types'

export type { MessageKey, Params, Locale } from './types'

/*
 * Lightweight i18n. To add a language, add a file in `./locales/` that default-exports a Locale
 * (see `es.ts`). It is picked up automatically: no other code changes are needed.
 * Any key missing from a language falls back to English.
 */

const modules = import.meta.glob<{ default: Locale }>('./locales/*.ts', { eager: true })

export const LANGUAGES: readonly Locale[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.code.localeCompare(b.code)))

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]))
const STORAGE_KEY = 'tb:lang'
const DEFAULT_LANGUAGE = 'en'

/** Pick the first supported browser language, otherwise English. */
export function detectLanguage(preferred: readonly string[] = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language]): string {
  for (const tag of preferred) {
    if (!tag) continue
    const lower = tag.toLowerCase()
    if (byCode.has(lower)) return lower
    const base = lower.split('-')[0]
    if (base && byCode.has(base)) return base
  }
  return DEFAULT_LANGUAGE
}

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && byCode.has(saved)) return saved
  } catch {
    /* storage unavailable: fall through to detection */
  }
  return detectLanguage()
}

let current = initialLanguage()
const listeners = new Set<() => void>()

function applyDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = current
}
applyDocumentLanguage()

export const getLanguage = () => current

export function setLanguage(code: string): void {
  if (!byCode.has(code) || code === current) return
  current = code
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    /* ignore: the choice then lasts until the tab closes */
  }
  applyDocumentLanguage()
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function interpolate(text: string, params?: Params): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

/** Translate a key in the current language (English if it is missing). Safe to call outside React. */
export function translate(key: MessageKey, params?: Params, code: string = current): string {
  const text = byCode.get(code)?.messages[key] ?? en.messages[key]
  return interpolate(text, params)
}

export type TFunction = (key: MessageKey, params?: Params) => string

/** Format a number for the current language (digits, separators, decimals). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions, code: string = current): string {
  try {
    return new Intl.NumberFormat(code, options).format(value)
  } catch {
    return String(value)
  }
}

export interface I18n {
  t: TFunction
  n: (value: number, options?: Intl.NumberFormatOptions) => string
  lang: string
  setLang: (code: string) => void
  languages: readonly Locale[]
}

/** Re-renders the component when the language changes. */
export function useI18n(): I18n {
  const lang = useSyncExternalStore(subscribe, getLanguage)
  return useMemo(
    () => ({
      t: (key, params) => translate(key, params, lang),
      n: (value, options) => formatNumber(value, options, lang),
      lang,
      setLang: setLanguage,
      languages: LANGUAGES,
    }),
    [lang],
  )
}

export const useT = (): TFunction => useI18n().t
