import { useId } from 'react'

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components'
import { useSnapshotQuery, type DonorDriveHost, type Incentive } from '@features/donordrive'

const NONE = 'none'
const LOOKUP_INTERVAL_SEC = 60

const formatAmount = (amount: number): string =>
  amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

const incentiveLabel = (incentive: Incentive): string =>
  `${incentive.description} (${formatAmount(incentive.amount)})${incentive.isActive ? '' : ' · inactive'}`

type Status = { tone: 'muted' | 'error'; text: string }

export type HeroIncentiveSelectProps = {
  host: DonorDriveHost
  /** A valid participant id, or undefined to disable the lookup */
  pid?: string
  value?: string
  onChange: (incentiveId: string | undefined) => void
}

/**
 * Optional "Hero request incentive" picker, filled from the participant's DonorDrive incentives.
 * Also shows the participant's name so the streamer can confirm the id.
 */
export const HeroIncentiveSelect = ({ host, pid, value, onChange }: HeroIncentiveSelectProps) => {
  const id = useId()
  const statusId = useId()
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

  const selected = incentives.some((incentive) => incentive.id === value) ? value : undefined

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Hero request incentive (optional)</Label>
      <Select
        value={selected ?? NONE}
        onValueChange={(next) => onChange(next === NONE ? undefined : next)}
        disabled={incentives.length === 0}
      >
        <SelectTrigger id={id} className="w-full" aria-describedby={statusId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {incentives.map((incentive) => (
            <SelectItem key={incentive.id} value={incentive.id}>
              {incentiveLabel(incentive)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p
        id={statusId}
        role="status"
        className={
          status.tone === 'error' ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'
        }
      >
        {status.text}
      </p>
    </div>
  )
}
