# Channel protocol

Third-party apps (overlays, bots, games) can subscribe to a dock's donation events over a WebSocket. The app only listens; it never needs to send anything. The schemas live in `src/features/channel/protocol.ts`.

## Credentials

A channel has a public **channel ID** (22 characters, not secret) and two credentials. Both are shown on the setup page and are stored hashed on the server.

| Credential      | Format       | Role         | Use                                                        |
| --------------- | ------------ | ------------ | ---------------------------------------------------------- |
| Owner key       | `own_…` (47) | `owner`      | The dock itself. Can read, publish events and write marks. |
| Subscribe token | `sub_…` (47) | `subscriber` | Third-party apps. Read-only.                               |

Either can be rotated from the setup page (owner only). Rotating invalidates the old value immediately; there is no grace period.

> **The owner key is a secret.** Anyone with it can publish fake events and rewrite the dock's marks. Never share it or show it on stream. Give third-party apps the subscribe token. If one leaks, rotate it.

## Connecting

```
wss://<origin>/api/channel/<channelId>?token=<sub_…>&host=<host>&pid=<pid>
```

- `<channelId>` is the channel ID and `token` is the subscribe token (the owner key also works). Use `ws://` for a local `http` origin.
- `host` (`extralife` or `try`) and `pid` (the DonorDrive participant ID) are added by the setup page when they are set. The WebSocket ignores them; apps pass them on to [`/pending`](#pending-redemptions). They never change which participant the channel follows (see [Where events come from](#where-events-come-from)).
- To resume after a disconnect, add `&since=<eventId>` with the `id` of the last event you handled. The replay then holds only newer events.
- Messages sent by the client are ignored.
- A missing, invalid or rotated token is rejected with `401` before the socket opens.

> **Tokens in the query string can appear in logs.** WebSocket clients can't set headers in browsers, so the token travels in the URL, and Workers logs may record it. Treat the subscribe token as low-risk and rotate it if it leaks. Use the owner key only over the `Authorization` header.

### Rotation

When a credential is rotated, every open socket of that role is closed with code `4401` and reason `credential_rotated`. Clients **must not** reconnect with the old token: it will get `401`. Fetch the new token (from the setup page) instead.

## Where events come from

The channel polls DonorDrive itself, so events go out whether or not a dock is open.

- The dock registers the participant by connecting with its owner key and `&role=dock&host=<host>&pid=<pid>`. Only the dock sends `role=dock`; the channel ignores it on a subscribe token, so apps cannot change the participant.
- Every 15 s the channel diffs the participant's donations and publishes `donation.created` and `incentive.redeemed`. Each event is published once.
- On first registration, or when `host` or `pid` change, the first poll is a baseline: donations that already exist are never published.
- Polling stops after 24 h with no connected socket and no new donation, and resumes when the dock reconnects.
- A channel unused for 30 days (no connections, requests or donations) has its events, marks and registration deleted. Its credentials are kept.
- If a redemption's incentive isn't in the DonorDrive data yet, the channel retries for up to 6 min so both events go out together.

## Server → client frames

Every message is a JSON object with a `kind`:

| `kind`   | Payload                         | When                                                                                                                                         |
| -------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`  | `role: 'owner' \| 'subscriber'` | First frame after connecting. Tells you which role your credential has. The credential is never echoed.                                      |
| `replay` | `events: RelayEvent[]`          | Right after `hello`. The newest events (up to 50), oldest first; with `since`, only those after it (the whole window if `since` is unknown). |
| `event`  | `event: RelayEvent`             | Each new event, live.                                                                                                                        |
| `marks`  | `marks: { version, ... }`       | Dock read/fulfilled state. Internal to the dock: **consumers should ignore it.**                                                             |

Ignore any `kind` you don't recognise.

## RelayEvent

```ts
{
  v: 1,                          // protocol version
  id: string,                    // `${type}:${data.donationId}`
  type: 'donation.created' | 'incentive.redeemed',
  ts: string,                    // ISO 8601 timestamp
  test: boolean,                 // true for sandbox events published by the dock
  participantId: string,
  data: {
    donationId: string,
    displayName: string,
    amount: number | null,       // null when the donor hid the amount
    message?: string,            // the donor's raw message
    incentiveId?: string,        // set on incentive.redeemed
    incentiveDescription?: string,
  },
}
```

A donation that redeems an incentive produces both a `donation.created` and an `incentive.redeemed` event.

## Consumer rules

- **Dedupe by `id`.** The same event can arrive twice (replay after reconnect, or an app that also posts events). An `id` is stable for a given donation and type.
- **Handle `test`.** Sandbox events (`test: true`) are the only events the dock publishes itself; show them in a preview or drop them, as fits your app. Real events come from the channel's own polling.
- **Filter incentives yourself.** Every redeemed incentive is broadcast. Keep the incentive IDs your app cares about in your own settings and match them against `data.incentiveId`; the setup page lists the participant's incentive IDs. Any answer to the incentive is the raw donor `message`, so parse it yourself.
- **Keep your own state.** The channel stores nothing for consumers beyond the replay window.

## HTTP endpoints

Both endpoints live next to the WebSocket URL (`https://<origin>/api/channel/<channelId>/…`, or `http://` for a local origin) and allow cross-origin calls: responses carry `Access-Control-Allow-Origin: *`, and `OPTIONS` preflights get `204` with `Access-Control-Allow-Methods: GET, POST, OPTIONS` and `Access-Control-Allow-Headers: content-type, authorization`. Authenticate with `Authorization: Bearer <credential>` (or `?token=<credential>`). Errors carry the CORS headers too.

| Endpoint       | Subscribe token | Owner key |
| -------------- | --------------- | --------- |
| WebSocket `/`  | yes             | yes       |
| `GET /marks`   | yes             | yes       |
| `GET /pending` | yes             | yes       |
| `POST /marks`  | `403`           | yes       |
| `POST /events` | `403`           | yes       |

Common errors:

- `400` bad channel ID.
- `401` missing, invalid or rotated credential, with `WWW-Authenticate: Bearer`. An unknown channel also returns `401`.
- `403` the credential is valid but its role can't do this (a subscribe token on a write).
- `404` unknown path, `405` wrong method.
- `429` per-credential rate limit (120 requests per 60 s), with `Retry-After` (seconds).

### Pending redemptions

```
GET /api/channel/<channelId>/pending?host=<host>&pid=<pid>[&incentiveId=<id>…]
```

Returns every `incentive.redeemed` event whose donation the dock hasn't marked fulfilled, read straight from DonorDrive (not from the replay window), oldest first:

```ts
{ events: RelayEvent[] }  // only type 'incentive.redeemed', same ids and payload as live events
```

- `host` and `pid` are required. `incentiveId` is optional and repeatable (at most 10); with it, only redemptions of those incentives are returned.
- Only the newest 2000 donations are scanned (see MVP-15 in `docs/mvp-shortcuts.md`). Results are cached for 15 s per participant.
- Errors: `400` for a bad channel ID, `host`, `pid` or `incentiveId`; `404` when DonorDrive doesn't know the participant; `429` with `Retry-After` (seconds) when DonorDrive rate limits; `502` for other DonorDrive or channel failures. DonorDrive errors have a `{ error, message }` JSON body.
- Events are deduped by `id`, the same as on the WebSocket, so an app can merge them with live events safely.

### Marking redemptions fulfilled

When an app has handled a redemption, it can mark it fulfilled so it no longer counts as pending in the dock and no longer comes back from `/pending`:

```
POST /api/channel/<channelId>/marks
Authorization: Bearer <own_…>
Content-Type: application/json

{ "op": "fulfill", "ids": ["<donationId>", …] }
```

`ids` are donation IDs (`data.donationId`, or the part of the event `id` after `incentive.redeemed:`). The response is the dock's full marks state. `{ "op": "unfulfill", … }` undoes it. Every connected dock updates live.

**Marking requires the owner key.** A subscribe token gets `403`, so an app that marks redemptions fulfilled needs the owner key; keep it server-side and out of anything shared.
