import { useEffect, useRef } from 'react'

import type { DashboardModel } from '@features/dock'

import { newItemEvents } from './activityEvents'
import type { RelayEvent } from './protocol'

export type UsePublishSandboxEventsOptions = {
  /** Dock key; nothing is published while it is undefined */
  key: string | undefined
  model: DashboardModel | undefined
}

const postEvent = async (key: string, event: RelayEvent): Promise<void> => {
  try {
    const response = await fetch(`/api/channel/${encodeURIComponent(key)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
export const usePublishSandboxEvents = ({ key, model }: UsePublishSandboxEventsOptions): void => {
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
    if (!key) return

    // Only sandbox test donations are published from the dock;
    // real events come from the DockChannel poller
    for (const event of events) void postEvent(key, event)
  }, [key, model])
}
