import { useHydrated } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'

import {
  CHANNEL_ID_PATTERN,
  createChannel,
  OWNER_KEY_PATTERN,
  rotateChannelCredential,
  SUBSCRIBE_TOKEN_PATTERN,
} from '@features/channel'
import type { ChannelRole, CreatedChannel } from '@features/channel'
import { parseStoredValue, useLocalStorage } from '@hooks'

/** localStorage key holding this browser's channel ID, owner key and subscribe token */
export const CHANNEL_CREDENTIALS_STORAGE_KEY = 'ddobs:v2:setup:channel'

/** localStorage key of the pre-FGC-6 dock key; removed on sight, it no longer works */
export const LEGACY_DOCK_KEY_STORAGE_KEY = 'ddobs:v1:setup:key'

export const channelCredentialsSchema: z.ZodType<CreatedChannel> = z.object({
  channelId: z.string().regex(CHANNEL_ID_PATTERN),
  ownerKey: z.string().regex(OWNER_KEY_PATTERN),
  subscribeToken: z.string().regex(SUBSCRIBE_TOKEN_PATTERN),
})

const storedCredentialsSchema = channelCredentialsSchema.nullable()

/** Parses stored credentials; null when missing, not JSON or malformed. */
export const parseStoredCredentials = (raw: string | null): CreatedChannel | null =>
  parseStoredValue(raw, storedCredentialsSchema, null)

/** Credentials with the owner key or subscribe token replaced; throws on a malformed credential. */
export const withRotatedCredential = (
  credentials: CreatedChannel,
  role: ChannelRole,
  credential: string
): CreatedChannel =>
  channelCredentialsSchema.parse(
    role === 'owner'
      ? { ...credentials, ownerKey: credential }
      : { ...credentials, subscribeToken: credential }
  )

const ROLE_PREFIX = /^(own|sub)_/

/** Masks a secret with bullets, keeping its `own_`/`sub_` prefix visible. */
export const maskSecret = (secret: string): string => {
  const prefix = ROLE_PREFIX.exec(secret)?.[0] ?? ''
  return prefix + '•'.repeat(secret.length - prefix.length)
}

/** Replaces every occurrence of each secret in `text` with its mask. */
export const maskSecrets = (text: string, secrets: readonly string[]): string =>
  secrets.reduce(
    (masked, secret) => (secret ? masked.replaceAll(secret, maskSecret(secret)) : masked),
    text
  )

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback

const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const removeStorage = (key: string) => {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Storage blocked: nothing to clean up
  }
}

/** Creation in flight, shared so StrictMode's double effect creates only one channel. */
let pendingCreation: Promise<CreatedChannel> | null = null

const createChannelOnce = (): Promise<CreatedChannel> => {
  pendingCreation ??= createChannel()
    .then((created) => channelCredentialsSchema.parse(created))
    .finally(() => {
      pendingCreation = null
    })
  return pendingCreation
}

export type ChannelCredentialsStatus = 'loading' | 'ready' | 'error'

export type ChannelCredentialsState = {
  /** null on the server, until read from storage, and while the first channel is created */
  credentials: CreatedChannel | null
  status: ChannelCredentialsStatus
  /** Why creating the channel failed, when `status` is 'error' */
  error?: string
  /** Tries creating the channel again after an error */
  retry: () => void
  /** Replaces the owner key or subscribe token; rejects with a readable message on failure */
  rotate: (role: ChannelRole) => Promise<void>
  /** Replaces the channel with a fresh one (empty marks); rejects with a readable message on failure */
  startNewChannel: () => Promise<void>
}

/**
 * This browser's channel credentials, persisted in localStorage so reopening setup builds the
 * same URLs. The first visit creates a channel on the server after hydration, never during SSR.
 */
export const useChannelCredentials = (): ChannelCredentialsState => {
  const hydrated = useHydrated()
  const [credentials, setCredentials] = useLocalStorage(
    CHANNEL_CREDENTIALS_STORAGE_KEY,
    storedCredentialsSchema,
    null
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    removeStorage(LEGACY_DOCK_KEY_STORAGE_KEY)
  }, [])

  useEffect(() => {
    if (!hydrated || credentials !== null || error !== undefined) return
    // Storage is the source of truth; a channel stored before this render is never replaced
    if (parseStoredCredentials(readStorage(CHANNEL_CREDENTIALS_STORAGE_KEY)) !== null) return

    let cancelled = false
    createChannelOnce().then(
      (created) => {
        if (cancelled) return
        setCredentials((previous) => previous ?? created)
        if (parseStoredCredentials(readStorage(CHANNEL_CREDENTIALS_STORAGE_KEY)) === null) {
          setError("This browser blocked local storage, so the channel can't be saved.")
        }
      },
      (reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason, 'Could not create a channel'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [hydrated, credentials, error, attempt, setCredentials])

  const retry = useCallback(() => {
    setError(undefined)
    setAttempt((previous) => previous + 1)
  }, [])

  const rotate = useCallback(
    async (role: ChannelRole) => {
      if (credentials === null) throw new Error('No channel to rotate yet')
      const { channelId, ownerKey } = credentials
      const { credential } = await rotateChannelCredential({
        data: { channelId, ownerKey, role },
      }).catch((reason: unknown) => {
        throw new Error(errorMessage(reason, 'Could not rotate the credential'), { cause: reason })
      })
      setCredentials((previous) =>
        previous?.channelId === channelId
          ? withRotatedCredential(previous, role, credential)
          : previous
      )
    },
    [credentials, setCredentials]
  )

  const startNewChannel = useCallback(async () => {
    const created = await createChannel()
      .then((channel) => channelCredentialsSchema.parse(channel))
      .catch((reason: unknown) => {
        throw new Error(errorMessage(reason, 'Could not create a channel'), { cause: reason })
      })
    setCredentials(created)
    setError(undefined)
  }, [setCredentials])

  const status: ChannelCredentialsStatus =
    credentials !== null ? 'ready' : error !== undefined ? 'error' : 'loading'

  return {
    credentials,
    status,
    error: credentials === null ? error : undefined,
    retry,
    rotate,
    startNewChannel,
  }
}
