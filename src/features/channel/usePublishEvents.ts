import { useEffect, useRef } from 'react'

import type { DashboardModel } from '@features/dock'

import { newActivityEvents } from './activityEvents'
import type { ChannelAuth } from './channelAuth'
import type { RelayEvent } from './protocol'

export type UsePublishEventsOptions = {
  /** Channel and owner key; nothing is published while it is undefined */
  auth: ChannelAuth | undefined
  model: DashboardModel | undefined
}

const postEvent = async (auth: ChannelAuth, event: RelayEvent): Promise<void> => {
  try {
    const response = await fetch(`/api/channel/${encodeURIComponent(auth.channelId)}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${auth.credential}`,
      },
      body: JSON.stringify(event),
    })
    if (!response.ok) console.warn('[channel] event rejected', event.id, response.status)
  } catch (error) {
    console.warn('[channel] event not published', event.id, error)
  }
}

/**
 * Publishes `donation.created` (and `incentive.redeemed`) for every donation that appears
 * after the first model; donations present on load are never replayed.
 */
export const usePublishEvents = ({ auth, model }: UsePublishEventsOptions): void => {
  const seenRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!model) return
    if (!seenRef.current) {
      seenRef.current = new Set(model.activity.map((item) => item.id))
      return
    }

    const seen = seenRef.current
    const { newIds, events } = newActivityEvents(model, seen)
    for (const id of newIds) seen.add(id)
    if (!auth) return

    // MVP-SHORTCUT(MVP-04): whichever dock is open detects and publishes events; several docks rely on id dedupe
    for (const event of events) void postEvent(auth, event)
  }, [auth, model])
}
