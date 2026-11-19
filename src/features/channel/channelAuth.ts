/** Roles a channel credential can grant. */
export const channelRoles = ['owner', 'subscriber'] as const

export type ChannelRole = (typeof channelRoles)[number]

/** Every operation on a channel that needs a credential. */
export type ChannelAction =
  | 'subscribe'
  | 'readMarks'
  | 'readPending'
  | 'writeMarks'
  | 'publish'
  | 'rotate'

/** What each role may do. The owner may do everything; a subscriber may only read. */
export const CHANNEL_PERMISSIONS: Record<ChannelRole, ReadonlySet<ChannelAction>> = {
  owner: new Set<ChannelAction>([
    'subscribe',
    'readMarks',
    'readPending',
    'writeMarks',
    'publish',
    'rotate',
  ]),
  subscriber: new Set<ChannelAction>(['subscribe', 'readMarks', 'readPending']),
}

export const can = (role: ChannelRole, action: ChannelAction): boolean =>
  CHANNEL_PERMISSIONS[role].has(action)

/** Channel ID format: 16 random bytes, base64url (22 characters). Not secret. */
export const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** Any channel credential: a role prefix and 32 random bytes, base64url (43 characters). */
export const CREDENTIAL_PATTERN = /^(own|sub)_[A-Za-z0-9_-]{43}$/

/** Owner key format; the owner key may write marks, publish events and rotate credentials. */
export const OWNER_KEY_PATTERN = /^own_[A-Za-z0-9_-]{43}$/

/** Subscribe token format; read-only access for third-party apps. */
export const SUBSCRIBE_TOKEN_PATTERN = /^sub_[A-Za-z0-9_-]{43}$/

export const credentialPrefix: Record<ChannelRole, 'own_' | 'sub_'> = {
  owner: 'own_',
  subscriber: 'sub_',
}

/** A channel and the credential used to access it. */
export type ChannelAuth = {
  channelId: string
  credential: string
}

export type ParsedCredential = {
  role: ChannelRole
  credential: string
}

/** Claimed role of a well-formed credential, from its prefix. The hash is checked elsewhere. */
export const parseCredential = (value: unknown): ParsedCredential | undefined => {
  if (typeof value !== 'string' || !CREDENTIAL_PATTERN.test(value)) return undefined
  const role: ChannelRole = value.startsWith(credentialPrefix.owner) ? 'owner' : 'subscriber'
  return { role, credential: value }
}

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i

/** Credential sent with a request: `Authorization: Bearer` first, then the `?token=` query. */
export const readRequestCredential = (request: Request, url: URL): string | undefined => {
  const authorization = request.headers.get('authorization')
  const bearer = authorization ? BEARER_PATTERN.exec(authorization)?.[1] : undefined
  if (bearer) return bearer
  const token = url.searchParams.get('token')
  return token ? token : undefined
}

const actionsByPath: Record<string, Partial<Record<string, ChannelAction>>> = {
  '/marks': { GET: 'readMarks', POST: 'writeMarks' },
  '/events': { POST: 'publish' },
  '/pending': { GET: 'readPending' },
}

/**
 * Action a public channel request performs. `/` is the WebSocket subscription for any method (the
 * DO checks for the upgrade). A known path with the wrong method gives `'method_not_allowed'`; an
 * unknown path gives `undefined`. Callers answer OPTIONS before calling this.
 */
export const actionFor = (
  subPath: string,
  method: string
): ChannelAction | 'method_not_allowed' | undefined => {
  if (subPath === '/') return 'subscribe'
  if (!Object.hasOwn(actionsByPath, subPath)) return undefined
  return actionsByPath[subPath][method.toUpperCase()] ?? 'method_not_allowed'
}

/** Base64url without padding. */
export const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const CHANNEL_ID_BYTES = 16
const CREDENTIAL_BYTES = 32

const randomBase64Url = (byteLength: number): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))

/** Random channel ID (22 characters). */
export const generateChannelId = (): string => randomBase64Url(CHANNEL_ID_BYTES)

/** Random credential for `role`: its prefix and 43 base64url characters. */
export const generateCredential = (role: ChannelRole): string =>
  `${credentialPrefix[role]}${randomBase64Url(CREDENTIAL_BYTES)}`

/** SHA-256 of the credential, lowercase hex. Only hashes are stored. */
export const hashCredential = async (credential: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Compares two hex strings in time independent of where they differ. */
export const timingSafeEqualHex = (a: string, b: string): boolean => {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return diff === 0
}

/** Credential hashes a channel stores, by role. Empty until the channel is initialized. */
export type StoredHashes = Partial<Record<ChannelRole, string>>

export type AccessResult = 'ok' | 'unauthorized' | 'forbidden'

/**
 * Checks a claimed role and credential hash against the stored hashes. An uninitialized channel,
 * a missing or wrong credential all give `'unauthorized'`, so callers can't tell them apart.
 */
export const checkAccess = (
  stored: StoredHashes,
  role: ChannelRole | null,
  hash: string | null,
  action: ChannelAction
): AccessResult => {
  if (!role || !hash || !Object.hasOwn(CHANNEL_PERMISSIONS, role)) return 'unauthorized'
  const expected = stored[role]
  if (!expected || !timingSafeEqualHex(expected, hash)) return 'unauthorized'
  return can(role, action) ? 'ok' : 'forbidden'
}
