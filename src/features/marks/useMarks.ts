import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useChannel } from '@features/channel'
import type { ChannelStatus, Marks, MarksOp, UseChannelResult } from '@features/channel'

import { getMarks, updateMarks } from './marksApi'
import { applyMarksOp, shouldReplaceMarks } from './marksOps'

export const marksQueryKey = (key: string | undefined) => ['marks', key] as const

export type UseMarksOptions = {
  /** Dock key; marks are disabled while it is undefined */
  key: string | undefined
  /** Ids of the donations the dock shows, newest first */
  donationIds: string[]
  /**
   * The dock's already-open channel (from `useChannel({ key })`). Pass it whenever the caller
   * opens the channel itself, so the dock keeps a single socket. Without it, useMarks opens
   * its own channel for `key`.
   */
  channel?: UseChannelResult
}

export type UseMarksResult = {
  /** Server marks state (with optimistic changes); undefined until loaded or without a key */
  marks: Marks | undefined
  isLoading: boolean
  /** Message of the last failed load or write, for an inline alert */
  error: string | undefined
  /** Status of the channel the marks sync through */
  channelStatus: ChannelStatus
  /** false without a key, before marks load or while the channel is not open; writes are ignored then */
  canWrite: boolean
  isRead: (id: string) => boolean
  isFulfilled: (id: string) => boolean
  toggleRead: (id: string) => void
  markAllRead: () => void
  setFulfilled: (id: string, fulfilled: boolean) => void
}

type MutationContext = { previous: Marks | undefined; optimistic: Marks | undefined }

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Could not update marks'

/**
 * Loads the dock's marks, applies read/fulfilled changes optimistically and keeps them in sync
 * with every other dock through `{ kind: 'marks' }` channel frames.
 */
export const useMarks = ({ key, donationIds, channel }: UseMarksOptions): UseMarksResult => {
  const queryClient = useQueryClient()
  const queryKey = marksQueryKey(key)
  const [writeError, setWriteError] = useState<string>()

  // Hooks can't be called conditionally, so the fallback channel always runs but gets no key
  // (and opens no socket) when the caller passed its own channel.
  const ownChannel = useChannel({ key: channel ? undefined : key })
  const { status: channelStatus, subscribe } = channel ?? ownChannel

  const query = useQuery({
    queryKey,
    queryFn: () => getMarks({ data: { key: key ?? '' } }),
    enabled: Boolean(key),
    // Channel frames keep the cache fresh; the channel resends full marks on every (re)connect
    staleTime: Number.POSITIVE_INFINITY,
  })

  useEffect(() => {
    if (!key) return
    const frameQueryKey = marksQueryKey(key)
    return subscribe((frame) => {
      if (frame.kind !== 'marks') return
      const cached = queryClient.getQueryData<Marks>(frameQueryKey)
      if (shouldReplaceMarks(cached, frame.marks)) {
        queryClient.setQueryData(frameQueryKey, frame.marks)
      }
    })
  }, [key, queryClient, subscribe])

  const mutation = useMutation<Marks, Error, MarksOp, MutationContext>({
    mutationFn: (op) => updateMarks({ data: { key: key ?? '', op } }),
    onMutate: async (op) => {
      setWriteError(undefined)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Marks>(queryKey)
      const optimistic = previous && applyMarksOp(previous, op)
      if (optimistic) queryClient.setQueryData(queryKey, optimistic)
      return { previous, optimistic }
    },
    onError: (error, _op, context) => {
      setWriteError(errorMessage(error))
      // Roll back only if nothing replaced our optimistic state in the meantime
      if (context?.previous && queryClient.getQueryData(queryKey) === context.optimistic) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSuccess: (marks) => {
      // A newer channel frame may already be cached
      if (shouldReplaceMarks(queryClient.getQueryData<Marks>(queryKey), marks)) {
        queryClient.setQueryData(queryKey, marks)
      }
    },
  })

  const marks = query.data
  const canWrite = Boolean(key) && marks !== undefined && channelStatus === 'open'
  const { mutate } = mutation

  const readIds = useMemo(() => new Set(marks?.read), [marks?.read])
  const fulfilledIds = useMemo(() => new Set(marks?.fulfilled), [marks?.fulfilled])

  const isRead = useCallback((id: string) => readIds.has(id), [readIds])
  const isFulfilled = useCallback((id: string) => fulfilledIds.has(id), [fulfilledIds])

  const toggleRead = useCallback(
    (id: string) => {
      if (!canWrite) return
      mutate({ op: readIds.has(id) ? 'unread' : 'read', ids: [id] })
    },
    [canWrite, mutate, readIds]
  )

  const markAllRead = useCallback(() => {
    if (!canWrite) return
    const ids = donationIds.filter((id) => !readIds.has(id))
    if (ids.length > 0) mutate({ op: 'read', ids })
  }, [canWrite, donationIds, mutate, readIds])

  const setFulfilled = useCallback(
    (id: string, fulfilled: boolean) => {
      if (!canWrite) return
      mutate({ op: fulfilled ? 'fulfill' : 'unfulfill', ids: [id] })
    },
    [canWrite, mutate]
  )

  const loadError = query.error ? errorMessage(query.error) : undefined

  return {
    marks,
    isLoading: query.isLoading,
    error: writeError ?? loadError,
    channelStatus,
    canWrite,
    isRead,
    isFulfilled,
    toggleRead,
    markAllRead,
    setFulfilled,
  }
}
