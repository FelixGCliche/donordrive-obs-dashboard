import { useCallback, useEffect } from 'react'
import { z } from 'zod'

import { DOCK_KEY_PATTERN } from '@features/channel'
import { useLocalStorage } from '@hooks'

/** localStorage key holding the setup page's dock key */
export const DOCK_KEY_STORAGE_KEY = 'ddobs:v1:setup:key'

const DOCK_KEY_BYTES = 16

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

/** Random 128-bit dock key, base64url-encoded (22 characters). */
export const generateDockKey = (): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(DOCK_KEY_BYTES)))

export const isDockKey = (value: unknown): value is string =>
  typeof value === 'string' && DOCK_KEY_PATTERN.test(value)

/** Keeps a valid stored key, or generates a new one. */
export const ensureDockKey = (previous: string | null): string =>
  isDockKey(previous) ? previous : generateDockKey()

const storedKeySchema = z.string().regex(DOCK_KEY_PATTERN).nullable()

export type DockKeyState = {
  /** null on the server and until the key is read or generated on the client */
  key: string | null
  /** Replaces the key; the new key starts with empty marks and a new channel */
  regenerate: () => void
}

/**
 * Dock key persisted in this browser's localStorage, so reopening setup builds the same URLs.
 * The key is generated on the client after hydration, never during SSR.
 */
export const useDockKey = (): DockKeyState => {
  const [key, setKey] = useLocalStorage(DOCK_KEY_STORAGE_KEY, storedKeySchema, null)

  useEffect(() => {
    // The updater reads storage directly, so a key stored before hydration is never overwritten
    if (key === null) setKey(ensureDockKey)
  }, [key, setKey])

  const regenerate = useCallback(() => setKey(generateDockKey()), [setKey])

  return { key, regenerate }
}
