# Channel protocol

Third-party apps (overlays, bots, games) can subscribe to a dock's donation events over a WebSocket. The app only listens; it never needs to send anything. The schemas live in `src/features/channel/protocol.ts`.

## Connecting

```
wss://<origin>/api/channel/<key>
```

- `<key>` is the dock key shown on the setup page. The URL has no query string. Use `ws://` for a local `http` origin.
- To resume after a disconnect, add `?since=<eventId>` with the `id` of the last event you handled. The replay then holds only newer events.
- Messages sent by the client are ignored.

> **The key is a secret.** It is the only credential: anyone with the URL can read events, publish fake events and change the dock's marks. Share it only with apps you trust (see MVP-05 in `docs/mvp-shortcuts.md`).

## Server → client frames

Every message is a JSON object with a `kind`:

| `kind`   | Payload                   | When                                                                                                                                         |
| -------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`  | `key: string`             | First frame after connecting.                                                                                                                |
| `replay` | `events: RelayEvent[]`    | Right after `hello`. The newest events (up to 50), oldest first; with `since`, only those after it (the whole window if `since` is unknown). |
| `event`  | `event: RelayEvent`       | Each new event, live.                                                                                                                        |
| `marks`  | `marks: { version, ... }` | Dock read/fulfilled state. Internal to the dock: **consumers should ignore it.**                                                             |

Ignore any `kind` you don't recognise.

## RelayEvent

```ts
{
  v: 1,                          // protocol version
  id: string,                    // `${type}:${data.donationId}`
  type: 'donation.created' | 'incentive.redeemed',
  ts: string,                    // ISO 8601 timestamp
  test: boolean,                 // true for sandbox events sent from the dock
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

- **Dedupe by `id`.** The same event can arrive twice (replay after reconnect, several docks publishing). An `id` is stable for a given donation and type.
- **Handle `test`.** Sandbox events have `test: true`; show them in a preview or drop them, as fits your app.
- **Filter incentives yourself.** Every redeemed incentive is broadcast. Keep the incentive IDs your app cares about in your own settings and match them against `data.incentiveId`; the setup page lists the participant's incentive IDs. Any answer to the incentive is the raw donor `message`, so parse it yourself.
- **Keep your own state.** The channel stores nothing for consumers beyond the replay window.
