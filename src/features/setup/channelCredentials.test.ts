import { describe, expect, test } from 'bun:test'

import { serializeValue } from '@hooks'

import {
  CHANNEL_CREDENTIALS_STORAGE_KEY,
  LEGACY_DOCK_KEY_STORAGE_KEY,
  maskSecret,
  maskSecrets,
  parseStoredCredentials,
  withRotatedCredential,
} from './channelCredentials'

const CHANNEL_ID = 'AbCdEfGhIjKlMnOpQrSt_-'
const OWNER_KEY = `own_${'a'.repeat(43)}`
const SUBSCRIBE_TOKEN = `sub_${'b'.repeat(43)}`
const NEW_OWNER_KEY = `own_${'c'.repeat(43)}`
const NEW_SUBSCRIBE_TOKEN = `sub_${'d'.repeat(43)}`

const credentials = { channelId: CHANNEL_ID, ownerKey: OWNER_KEY, subscribeToken: SUBSCRIBE_TOKEN }

describe('storage keys', () => {
  test('use the v2 channel key and remember the legacy v1 key', () => {
    expect(CHANNEL_CREDENTIALS_STORAGE_KEY).toBe('ddobs:v2:setup:channel')
    expect(LEGACY_DOCK_KEY_STORAGE_KEY).toBe('ddobs:v1:setup:key')
  })
})

describe('parseStoredCredentials', () => {
  test('round-trips stored credentials', () => {
    expect(parseStoredCredentials(serializeValue(credentials))).toEqual(credentials)
  })

  test('returns null when nothing is stored', () => {
    expect(parseStoredCredentials(null)).toBeNull()
    expect(parseStoredCredentials('null')).toBeNull()
  })

  test('returns null for invalid JSON', () => {
    expect(parseStoredCredentials('{not json')).toBeNull()
  })

  test('returns null for a legacy dock key string', () => {
    expect(parseStoredCredentials(serializeValue(CHANNEL_ID))).toBeNull()
  })

  test.each([
    ['channel ID', { ...credentials, channelId: 'short' }],
    ['owner key', { ...credentials, ownerKey: SUBSCRIBE_TOKEN }],
    ['subscribe token', { ...credentials, subscribeToken: OWNER_KEY }],
    ['missing field', { channelId: CHANNEL_ID, ownerKey: OWNER_KEY }],
  ])('returns null for a malformed %s', (_, value) => {
    expect(parseStoredCredentials(serializeValue(value))).toBeNull()
  })
})

describe('withRotatedCredential', () => {
  test('replaces only the owner key', () => {
    expect(withRotatedCredential(credentials, 'owner', NEW_OWNER_KEY)).toEqual({
      ...credentials,
      ownerKey: NEW_OWNER_KEY,
    })
  })

  test('replaces only the subscribe token', () => {
    expect(withRotatedCredential(credentials, 'subscriber', NEW_SUBSCRIBE_TOKEN)).toEqual({
      ...credentials,
      subscribeToken: NEW_SUBSCRIBE_TOKEN,
    })
  })

  test('rejects a credential of the wrong role', () => {
    expect(() => withRotatedCredential(credentials, 'owner', NEW_SUBSCRIBE_TOKEN)).toThrow()
    expect(() => withRotatedCredential(credentials, 'subscriber', NEW_OWNER_KEY)).toThrow()
  })
})

describe('maskSecret', () => {
  test('keeps the role prefix and masks the rest', () => {
    expect(maskSecret(OWNER_KEY)).toBe(`own_${'•'.repeat(43)}`)
    expect(maskSecret(SUBSCRIBE_TOKEN)).toBe(`sub_${'•'.repeat(43)}`)
  })

  test('masks a value without a prefix entirely', () => {
    expect(maskSecret('abc')).toBe('•••')
  })
})

describe('maskSecrets', () => {
  test('masks every secret in a URL and leaves the rest', () => {
    const url = `https://x.dev/dock?channel=${CHANNEL_ID}&key=${OWNER_KEY}&token=${SUBSCRIBE_TOKEN}`
    expect(maskSecrets(url, [OWNER_KEY, SUBSCRIBE_TOKEN])).toBe(
      `https://x.dev/dock?channel=${CHANNEL_ID}&key=${maskSecret(OWNER_KEY)}&token=${maskSecret(SUBSCRIBE_TOKEN)}`
    )
  })

  test('ignores empty secrets', () => {
    expect(maskSecrets('https://x.dev/', [''])).toBe('https://x.dev/')
  })
})
