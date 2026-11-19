/** Header that tells the DockChannel object which role the caller claims. */
export const CHANNEL_ROLE_HEADER = 'x-dock-role'

/** Header carrying the SHA-256 hash of the caller's credential. */
export const CHANNEL_CREDENTIAL_HASH_HEADER = 'x-dock-credential-hash'

/** Internal path that initializes a new channel with its credential hashes. */
export const CHANNEL_INIT_PATH = '/init'

/** Internal path that replaces a credential hash of a channel. */
export const CHANNEL_CREDENTIALS_PATH = '/credentials'

/** WebSocket close code sent when the socket's credential was rotated. */
export const CREDENTIAL_ROTATED_CLOSE_CODE = 4401

/** Placeholder origin for requests sent to a DockChannel stub; only the path and query matter. */
export const CHANNEL_ORIGIN = 'https://dock-channel.internal'
