import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ZodType } from 'zod'

type Listener = () => void

const listeners = new Set<Listener>()

const notify = () => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener) => {
  listeners.add(listener)
  // The storage event only fires in *other* tabs; same-tab writes go through notify()
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const readRaw = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    // Storage can throw when blocked (privacy mode, sandboxed iframes, OBS CEF quirks)
    return null
  }
}

const writeRaw = (key: string, raw: string | null) => {
  try {
    if (raw === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, raw)
  } catch {
    // Quota exceeded or storage blocked: keep the in-memory value as-is
  }
  notify()
}

/** Parses a raw localStorage string, falling back when it is missing, not JSON or fails the schema. */
export const parseStoredValue = <T>(raw: string | null, schema: ZodType<T>, fallback: T): T => {
  if (raw === null) return fallback
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return fallback
  }
  const result = schema.safeParse(json)
  return result.success ? result.data : fallback
}

/** Serializes a value for localStorage. */
export const serializeValue = <T>(value: T): string => JSON.stringify(value)

export type SetStoredValue<T> = (next: T | ((previous: T) => T)) => void

/**
 * Reads and writes a zod-validated JSON value in localStorage.
 * Renders `defaultValue` on the server and whenever the stored value is missing or invalid.
 * Stays in sync across hooks in the same tab and across tabs.
 * Pass a stable `schema` and `defaultValue` (module constants) to avoid needless re-parsing.
 */
export const useLocalStorage = <T>(
  key: string,
  schema: ZodType<T>,
  defaultValue: T
): [value: T, setValue: SetStoredValue<T>, removeValue: () => void] => {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null
  )

  const value = useMemo(
    () => parseStoredValue(raw, schema, defaultValue),
    [raw, schema, defaultValue]
  )

  const setValue = useCallback<SetStoredValue<T>>(
    (next) => {
      const previous = parseStoredValue(readRaw(key), schema, defaultValue)
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
      writeRaw(key, serializeValue(resolved))
    },
    [key, schema, defaultValue]
  )

  const removeValue = useCallback(() => writeRaw(key, null), [key])

  return [value, setValue, removeValue]
}
