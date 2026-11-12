import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge, Button } from '@components'
import { useSnapshotQuery, type DonorDriveHost, type Incentive } from '@features/donordrive'

const LOOKUP_INTERVAL_SEC = 60
const COPIED_RESET_MS = 2000

const formatAmount = (amount: number): string =>
  amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

type Status = { tone: 'muted' | 'error'; text: string }

type CopyIdButtonProps = { incentive: Incentive }

/** Copies an incentive ID to the clipboard. */
const CopyIdButton = ({ incentive }: CopyIdButtonProps) => {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)

  useEffect(() => {
    if (copied === null) return
    const timeout = window.setTimeout(() => setCopied(null), COPIED_RESET_MS)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(incentive.id)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      aria-label={`Copy the ID of ${incentive.description}`}
    >
      {copied === 'ok' ? <CheckIcon /> : <CopyIcon />}
      {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
    </Button>
  )
}

export type IncentiveListProps = {
  host: DonorDriveHost
  /** A valid participant id, or undefined to disable the lookup */
  pid?: string
}

/**
 * The participant's DonorDrive incentives with their IDs, so they can be entered in
 * third-party apps that react to specific incentives.
 */
export const IncentiveList = ({ host, pid }: IncentiveListProps) => {
  const query = useSnapshotQuery({ host, pid, interval: LOOKUP_INTERVAL_SEC })

  // keepPreviousData shows the previous participant while a new pid loads; treat that as loading
  const loading = Boolean(pid) && (query.isPending || query.isPlaceholderData)
  const result = loading ? undefined : query.data?.result
  const snapshot = result?.ok ? result.snapshot : undefined
  const incentives = snapshot?.incentives ?? []

  const status: Status = (() => {
    if (!pid) return { tone: 'muted', text: 'Enter a valid participant ID to list incentives.' }
    if (loading) return { tone: 'muted', text: 'Looking up participant…' }
    if (query.isError) return { tone: 'error', text: 'Could not reach the server. Try again.' }
    if (result && !result.ok) {
      return result.error.kind === 'not_found'
        ? { tone: 'error', text: 'No participant with this ID on the selected site.' }
        : { tone: 'error', text: `Could not load the participant: ${result.error.message}` }
    }
    if (!snapshot) return { tone: 'muted', text: 'Looking up participant…' }
    const event = snapshot.participant.eventName ? ` · ${snapshot.participant.eventName}` : ''
    const count = incentives.length === 0 ? ' · no incentives' : ''
    return {
      tone: 'muted',
      text: `Participant: ${snapshot.participant.displayName}${event}${count}`,
    }
  })()

  return (
    <div className="grid gap-3">
      <p
        role="status"
        className={
          status.tone === 'error' ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'
        }
      >
        {status.text}
      </p>
      {incentives.length > 0 && (
        <ul className="grid divide-y rounded-md border">
          {incentives.map((incentive) => (
            <li key={incentive.id} className="flex items-center gap-3 px-3 py-2">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{incentive.description}</span>
                  {!incentive.isActive && <Badge variant="outline">Inactive</Badge>}
                </div>
                <span className="text-muted-foreground text-xs">
                  {formatAmount(incentive.amount)} ·{' '}
                  <code className="font-mono break-all">{incentive.id}</code>
                </span>
              </div>
              <CopyIdButton incentive={incentive} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
