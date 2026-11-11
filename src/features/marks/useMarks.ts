import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import type { Marks, MarksOp } from '@features/channel'

import { getMarks, updateMarks } from './marksApi'
import { applyMarksOp } from './marksOps'

export const marksQueryKey = (key: string | undefined) => ['marks', key] as const

export type UseMarksOptions = {
  /** Dock key; marks are disabled while it is undefined */
  key: string | undefined
  /** Ids of the donations the dock shows, newest first */
  donationIds: string[]
}

export type UseMarksResult = {
  /** Server marks state (with optimistic changes); undefined until loaded or without a key */
  marks: Marks | undefined
  isLoading: boolean
  /** Message of the last failed load or write, for an inline alert */
  error: string | undefined
  /** false without a key or before marks load; writes are ignored then */
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

/** Loads the dock's marks and applies read/fulfilled changes optimistically. */
export const useMarks = ({ key, donationIds }: UseMarksOptions): UseMarksResult => {
  const queryClient = useQueryClient()
  const queryKey = marksQueryKey(key)
  const [writeError, setWriteError] = useState<string>()

  const query = useQuery({
    queryKey,
    queryFn: () => getMarks({ data: { key: key ?? '' } }),
    enabled: Boolean(key),
  })

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
      queryClient.setQueryData(queryKey, marks)
    },
  })

  const marks = query.data
  const canWrite = Boolean(key) && marks !== undefined
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
    canWrite,
    isRead,
    isFulfilled,
    toggleRead,
    markAllRead,
    setFulfilled,
  }
}
