import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { TURNSTILE_SITE_KEY } from './config'

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => {
      scriptPromise = null
      reject(new Error('turnstile_failed'))
    }
    document.head.appendChild(el)
  })
  return scriptPromise
}

export interface TurnstileHandle {
  reset: () => void
}

/** Cloudflare Turnstile. Renders nothing when no site key is set. A token works once, so reset after each submit. */
export const Turnstile = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void }>(function Turnstile({ onToken }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const callback = useRef(onToken)

  useEffect(() => {
    callback.current = onToken
  })

  useImperativeHandle(ref, () => ({
    reset: () => {
      callback.current(null)
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current)
    },
  }))

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false
    void loadScript()
      .then(() => {
        if (cancelled || !host.current || !window.turnstile) return
        widget.current = window.turnstile.render(host.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null),
        })
      })
      .catch(() => callback.current(null))
    return () => {
      cancelled = true
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
    }
  }, [])

  if (!TURNSTILE_SITE_KEY) return null
  return <div ref={host} className="flex min-h-[65px] justify-center" />
})
