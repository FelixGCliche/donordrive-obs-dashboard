import { describe, expect, test } from 'bun:test'

import type { ChannelAction, ChannelRole, StoredHashes } from './channelAuth'
import {
  actionFor,
  can,
  CHANNEL_ID_PATTERN,
  CHANNEL_PERMISSIONS,
  channelRoles,
  checkAccess,
  CREDENTIAL_PATTERN,
  credentialPrefix,
  generateChannelId,
  generateCredential,
  hashCredential,
  OWNER_KEY_PATTERN,
  parseCredential,
  readRequestCredential,
  SUBSCRIBE_TOKEN_PATTERN,
  timingSafeEqualHex,
  toBase64Url,
} from './channelAuth'

const allActions: ChannelAction[] = [
  'subscribe',
  'readMarks',
  'readPending',
  'writeMarks',
  'publish',
  'rotate',
]

/** The permissions matrix from the FGC-6 plan. */
const matrix: Record<ChannelAction, Record<ChannelRole, boolean>> = {
  subscribe: { owner: true, subscriber: true },
  readMarks: { owner: true, subscriber: true },
  readPending: { owner: true, subscriber: true },
  writeMarks: { owner: true, subscriber: false },
  publish: { owner: true, subscriber: false },
  rotate: { owner: true, subscriber: false },
}

const body43 = 'A-b_'.repeat(10) + 'xyz'
const ownerKey = `own_${body43}`
const subscribeToken = `sub_${body43}`

describe('channelRoles', () => {
  test('lists owner and subscriber', () => {
    expect([...channelRoles]).toEqual(['owner', 'subscriber'])
  })
})

describe('permissions', () => {
  const cases = allActions.flatMap((action) =>
    channelRoles.map((role) => [role, action, matrix[action][role]] as const)
  )

  test.each(cases)('%s may %s: %p', (role, action, allowed) => {
    expect(can(role, action)).toBe(allowed)
    expect(CHANNEL_PERMISSIONS[role].has(action)).toBe(allowed)
  })

  test('grants no actions beyond the matrix', () => {
    expect(CHANNEL_PERMISSIONS.owner.size).toBe(allActions.length)
    expect([...CHANNEL_PERMISSIONS.subscriber].sort()).toEqual(
      (['readMarks', 'readPending', 'subscribe'] satisfies ChannelAction[]).sort()
    )
  })
})

describe('patterns', () => {
  test('CHANNEL_ID_PATTERN accepts exactly 22 url-safe characters', () => {
    expect(CHANNEL_ID_PATTERN.test('a'.repeat(22))).toBe(true)
    expect(CHANNEL_ID_PATTERN.test('A-b_'.repeat(5) + 'zz')).toBe(true)
    expect(CHANNEL_ID_PATTERN.test('a'.repeat(21))).toBe(false)
    expect(CHANNEL_ID_PATTERN.test('a'.repeat(23))).toBe(false)
    expect(CHANNEL_ID_PATTERN.test(`${'a'.repeat(21)}/`)).toBe(false)
    expect(CHANNEL_ID_PATTERN.test(`${'a'.repeat(21)}=`)).toBe(false)
  })

  test('CREDENTIAL_PATTERN accepts both prefixes with 43 characters', () => {
    expect(CREDENTIAL_PATTERN.test(ownerKey)).toBe(true)
    expect(CREDENTIAL_PATTERN.test(subscribeToken)).toBe(true)
  })

  test.each([
    ['no prefix', body43],
    ['unknown prefix', `adm_${body43}`],
    ['short body', `own_${body43.slice(1)}`],
    ['long body', `own_${body43}a`],
    ['unsafe character', `own_${body43.slice(1)}/`],
    ['upper-case prefix', `OWN_${body43}`],
    ['old 22-character dock key', 'a'.repeat(22)],
  ])('CREDENTIAL_PATTERN rejects %s', (_label, value) => {
    expect(CREDENTIAL_PATTERN.test(value)).toBe(false)
  })

  test('role patterns accept only their own prefix', () => {
    expect(OWNER_KEY_PATTERN.test(ownerKey)).toBe(true)
    expect(OWNER_KEY_PATTERN.test(subscribeToken)).toBe(false)
    expect(SUBSCRIBE_TOKEN_PATTERN.test(subscribeToken)).toBe(true)
    expect(SUBSCRIBE_TOKEN_PATTERN.test(ownerKey)).toBe(false)
  })

  test('credentialPrefix maps roles to prefixes', () => {
    expect(credentialPrefix).toEqual({ owner: 'own_', subscriber: 'sub_' })
  })
})

describe('parseCredential', () => {
  test('reads the role from the prefix', () => {
    expect(parseCredential(ownerKey)).toEqual({ role: 'owner', credential: ownerKey })
    expect(parseCredential(subscribeToken)).toEqual({
      role: 'subscriber',
      credential: subscribeToken,
    })
  })

  test.each([undefined, null, 42, '', 'a'.repeat(22), `own_${body43} `, ` sub_${body43}`])(
    'rejects %p',
    (value) => {
      expect(parseCredential(value)).toBeUndefined()
    }
  )
})

describe('readRequestCredential', () => {
  const read = (headers: HeadersInit, query = '') => {
    const url = new URL(`https://example.com/api/channel/x/marks${query}`)
    return readRequestCredential(new Request(url, { headers }), url)
  }

  test('reads a Bearer token', () => {
    expect(read({ authorization: `Bearer ${ownerKey}` })).toBe(ownerKey)
    expect(read({ authorization: `bearer ${ownerKey}` })).toBe(ownerKey)
  })

  test('prefers the Authorization header over the query', () => {
    expect(read({ authorization: `Bearer ${ownerKey}` }, `?token=${subscribeToken}`)).toBe(ownerKey)
  })

  test('falls back to the token query', () => {
    expect(read({}, `?token=${subscribeToken}`)).toBe(subscribeToken)
    expect(read({ authorization: 'Basic abc' }, `?token=${subscribeToken}`)).toBe(subscribeToken)
    expect(read({ authorization: 'Bearer ' }, `?token=${subscribeToken}`)).toBe(subscribeToken)
  })

  test('returns undefined without a credential', () => {
    expect(read({})).toBeUndefined()
    expect(read({}, '?token=')).toBeUndefined()
    expect(read({ authorization: 'Basic abc' })).toBeUndefined()
  })
})

describe('actionFor', () => {
  test.each([
    ['/', 'GET', 'subscribe'],
    ['/', 'POST', 'subscribe'],
    ['/marks', 'GET', 'readMarks'],
    ['/marks', 'POST', 'writeMarks'],
    ['/marks', 'post', 'writeMarks'],
    ['/events', 'POST', 'publish'],
    ['/pending', 'GET', 'readPending'],
    ['/marks', 'DELETE', 'method_not_allowed'],
    ['/events', 'GET', 'method_not_allowed'],
    ['/pending', 'POST', 'method_not_allowed'],
    ['/init', 'POST', undefined],
    ['/credentials', 'POST', undefined],
    ['/nope', 'GET', undefined],
    ['/constructor', 'GET', undefined],
    ['/toString', 'GET', undefined],
  ] as const)('%s %s → %p', (path, method, expected) => {
    expect(actionFor(path, method)).toBe(expected)
  })
})

describe('generators', () => {
  test('toBase64Url encodes without padding or unsafe characters', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-')
    expect(toBase64Url(new Uint8Array([1]))).toBe('AQ')
  })

  test('generateChannelId returns unique 22-character ids', () => {
    const ids = new Set(Array.from({ length: 50 }, generateChannelId))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(CHANNEL_ID_PATTERN.test(id)).toBe(true)
  })

  test('generateCredential returns prefixed credentials of the right role', () => {
    for (const role of channelRoles) {
      const credentials = new Set(Array.from({ length: 50 }, () => generateCredential(role)))
      expect(credentials.size).toBe(50)
      for (const credential of credentials) {
        expect(parseCredential(credential)?.role).toBe(role)
      }
    }
    expect(OWNER_KEY_PATTERN.test(generateCredential('owner'))).toBe(true)
    expect(SUBSCRIBE_TOKEN_PATTERN.test(generateCredential('subscriber'))).toBe(true)
  })
})

describe('hashCredential', () => {
  test('returns the SHA-256 hex digest', async () => {
    expect(await hashCredential('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  test('differs per credential and is stable', async () => {
    const a = await hashCredential(ownerKey)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashCredential(ownerKey)).toBe(a)
    expect(await hashCredential(subscribeToken)).not.toBe(a)
  })
})

describe('timingSafeEqualHex', () => {
  test('compares hex strings', () => {
    expect(timingSafeEqualHex('abc123', 'abc123')).toBe(true)
    expect(timingSafeEqualHex('ABC123', 'abc123')).toBe(true)
    expect(timingSafeEqualHex('abc123', 'abc124')).toBe(false)
    expect(timingSafeEqualHex('abc123', 'abc12')).toBe(false)
    expect(timingSafeEqualHex('abc12', 'abc123')).toBe(false)
    expect(timingSafeEqualHex('', '')).toBe(true)
    expect(timingSafeEqualHex('', 'a')).toBe(false)
  })
})

describe('checkAccess', () => {
  const ownerHash = 'a'.repeat(64)
  const subscriberHash = 'b'.repeat(64)
  const stored: StoredHashes = { owner: ownerHash, subscriber: subscriberHash }

  test('rejects every request to an uninitialized channel', () => {
    for (const action of allActions) {
      expect(checkAccess({}, 'owner', ownerHash, action)).toBe('unauthorized')
    }
  })

  test('rejects a missing role or hash', () => {
    expect(checkAccess(stored, null, ownerHash, 'subscribe')).toBe('unauthorized')
    expect(checkAccess(stored, 'owner', null, 'subscribe')).toBe('unauthorized')
    expect(checkAccess(stored, 'owner', '', 'subscribe')).toBe('unauthorized')
  })

  test('rejects an unknown role', () => {
    expect(checkAccess(stored, 'admin' as ChannelRole, ownerHash, 'subscribe')).toBe('unauthorized')
  })

  test('rejects a hash that belongs to another role', () => {
    expect(checkAccess(stored, 'owner', subscriberHash, 'subscribe')).toBe('unauthorized')
    expect(checkAccess(stored, 'subscriber', ownerHash, 'subscribe')).toBe('unauthorized')
  })

  test('rejects a rotated (stale) hash', () => {
    const rotated: StoredHashes = { ...stored, subscriber: 'c'.repeat(64) }
    expect(checkAccess(rotated, 'subscriber', subscriberHash, 'readMarks')).toBe('unauthorized')
  })

  test('rejects a role that has no stored hash', () => {
    expect(checkAccess({ owner: ownerHash }, 'subscriber', ownerHash, 'subscribe')).toBe(
      'unauthorized'
    )
  })

  const cases = allActions.flatMap((action) =>
    channelRoles.map((role) => [role, action, matrix[action][role] ? 'ok' : 'forbidden'] as const)
  )

  test.each(cases)('valid %s credential, %s → %s', (role, action, expected) => {
    const hash = role === 'owner' ? ownerHash : subscriberHash
    expect(checkAccess(stored, role, hash, action)).toBe(expected)
  })
})
