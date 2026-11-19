import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useChannel } from '@features/channel'
import type {
  ChannelAuth,
  ChannelStatus,
  Marks,
  MarksOp,
  UseChannelResult,
} from '@features/channel'

import { getMarks, updateMarks } from './marksApi'
import { isMarksUnauthorizedError } from './marksErrors'
import { applyMarksOp, baselineOp, MAX_OP_IDS, shouldReplaceMarks } from './marksOps'

export const marksQueryKey = (channelId: string | undefined) => ['marks', channelId] as const

export type UseMarksOptions = {
  /** Channel and credential; marks are disabled while it is undefined */
  auth: ChannelAuth | undefined
  /** Ids of the donations the dock shows, newest first */
  donationIds: string[]
  /**
   * The dock's already-open channel (from `useChannel({ auth })`). Pass it whenever the caller
   * opens the channel itself, so the dock keeps a single socket. Without it, useMarks opens
   * its own channel for `auth`.
   */
  channel?: UseChannelResult
}

export type UseMarksResult = {
  /** Server marks state (with optimistic changes); undefined until loaded or without auth */
  marks: Marks | undefined
  isLoading: boolean
  /** Message of the last failed load or write, for an inline alert */
  error: string | undefined
  /** true when the last load or write failed because the credential is invalid or rotated */
  isUnauthorized: boolean
  /** Status of the channel the marks sync through */
  channelStatus: ChannelStatus
  /** false without auth, before marks load or while the channel is not open; writes are ignored then */
  canWrite: boolean
  isRead: (id: string) => boolean
  isFulfilled: (id: string) => boolean
  toggleRead: (id: string) => void
  markAllRead: () => void
  setFulfilled: (id: string, fulfilled: boolean) => void
}

/** Channels this session already sent a baseline for; the channel ignores repeats anyway. */
const baselinedChannels = new Set<string>()

type MutationContext = { previous: Marks | undefined; optimistic: Marks | undefined }

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Could not update marks'

/**
 * Loads the dock's marks, applies read/fulfilled changes optimistically and keeps them in sync
 * with every other dock through `{ kind: 'marks' }` channel frames.
 */
export const useMarks = ({ auth, donationIds, channel }: UseMarksOptions): UseMarksResult => {
  const queryClient = useQueryClient()
  const channelId = auth?.channelId
  const credential = auth?.credential
  const queryKey = marksQueryKey(channelId)
  const [writeError, setWriteError] = useState<unknown>()

  // Hooks can't be called conditionally, so the fallback channel always runs but gets no auth
  // (and opens no socket) when the caller passed its own channel.
  const ownChannel = useChannel({ auth: channel ? undefined : auth })
  const { status: channelStatus, subscribe } = channel ?? ownChannel

  const query = useQuery({
    queryKey,
    queryFn: () => getMarks({ data: { channelId: channelId ?? '', credential: credential ?? '' } }),
    enabled: Boolean(channelId && credential),
    // A rejected credential won't start working on a retry
    retry: (failureCount, error) => !isMarksUnauthorizedError(error) && failureCount < 3,
    // Channel frames keep the cache fresh; the channel resends full marks on every (re)connect
    staleTime: Number.POSITIVE_INFINITY,
  })

  // Marks are cached per channel; a new credential (say after a rotation) must load them again
  const credentialRef = useRef(credential)
  useEffect(() => {
    if (credentialRef.current === credential) return
    credentialRef.current = credential
    setWriteError(undefined)
    void queryClient.resetQueries({ queryKey: marksQueryKey(channelId) })
  }, [channelId, credential, queryClient])

  useEffect(() => {
    if (!channelId) return
    const frameQueryKey = marksQueryKey(channelId)
    return subscribe((frame) => {
      if (frame.kind !== 'marks') return
      const cached = queryClient.getQueryData<Marks>(frameQueryKey)
      if (shouldReplaceMarks(cached, frame.marks)) {
        queryClient.setQueryData(frameQueryKey, frame.marks)
      }
    })
  }, [channelId, queryClient, subscribe])

  const mutation = useMutation<Marks, Error, MarksOp, MutationContext>({
    mutationFn: (op) =>
      updateMarks({ data: { channelId: channelId ?? '', credential: credential ?? '', op } }),
    onMutate: async (op) => {
      setWriteError(undefined)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Marks>(queryKey)
      const optimistic = previous && applyMarksOp(previous, op)
      if (optimistic) queryClient.setQueryData(queryKey, optimistic)
      return { previous, optimistic }
    },
    onError: (error, _op, context) => {
      setWriteError(error)
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
  const canWrite =
    Boolean(channelId && credential) && marks !== undefined && channelStatus === 'open'
  const { mutate } = mutation

  // MVP-SHORTCUT(MVP-09): a new channel starts with every donation shown marked read (once per channel)
  useEffect(() => {
    if (!channelId || !marks || baselinedChannels.has(channelId)) return
    const op = baselineOp(marks, donationIds)
    if (!op) return
    baselinedChannels.add(channelId)
    mutate(op)
  }, [channelId, donationIds, marks, mutate])

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
    const ids = donationIds.filter((id) => !readIds.has(id)).slice(0, MAX_OP_IDS)
    if (ids.length > 0) mutate({ op: 'read', ids })
  }, [canWrite, donationIds, mutate, readIds])

  const setFulfilled = useCallback(
    (id: string, fulfilled: boolean) => {
      if (!canWrite) return
      mutate({ op: fulfilled ? 'fulfill' : 'unfulfill', ids: [id] })
    },
    [canWrite, mutate]
  )

  const failure = writeError ?? query.error ?? undefined

  return {
    marks,
    isLoading: query.isLoading,
    error: failure === undefined ? undefined : errorMessage(failure),
    isUnauthorized: isMarksUnauthorizedError(failure),
    channelStatus,
    canWrite,
    isRead,
    isFulfilled,
    toggleRead,
    markAllRead,
    setFulfilled,
  }
}
