import { useEffect, useRef } from 'react'

import type { DashboardModel } from '@features/dock'

import { newItemEvents } from './activityEvents'
import type { ChannelAuth } from './channelAuth'
import type { RelayEvent } from './protocol'

export type UsePublishSandboxEventsOptions = {
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
 * Publishes `donation.created` (and `incentive.redeemed`) for every sandbox test donation that
 * appears after the first model; test donations present on load (kept in localStorage) are
 * never replayed.
 */
export const usePublishSandboxEvents = ({ auth, model }: UsePublishSandboxEventsOptions): void => {
  const seenRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!model) return
    const items = model.activity.filter((item) => item.isTest)
    if (!seenRef.current) {
      seenRef.current = new Set(items.map((item) => item.id))
      return
    }

    const seen = seenRef.current
    const { newIds, events } = newItemEvents(items, model.participant.id, seen)
    for (const id of newIds) seen.add(id)
    if (!auth) return

    // Only sandbox test donations are published from the dock;
    // real events come from the DockChannel poller
    for (const event of events) void postEvent(auth, event)
  }, [auth, model])
}
