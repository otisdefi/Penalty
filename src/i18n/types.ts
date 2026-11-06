import type en from './locales/en'

/** Every text key in the game. English is the source of truth; other languages may leave keys out. */
export type MessageKey = keyof typeof en.messages

export type Params = Record<string, string | number>

/** The shape of a translation file in `src/i18n/locales/`. Add a language by adding one file. */
export interface Locale {
  /** Short code shown on the language button, for example "tr". Also matched against the browser language. */
  code: string
  /** The language's own name, shown in the list. */
  name: string
  messages: Partial<Record<MessageKey, string>>
}
