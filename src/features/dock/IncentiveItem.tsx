import { Check } from 'lucide-react'

import { Badge, Button, cn } from '@components'

import { formatMoney } from './dockFormat'
import type { ActivityItem, IncentiveStatus, IncentiveView } from './model'

const statusStyles: Record<IncentiveStatus, { label: string; className: string }> = {
  active: {
    label: 'Active',
    className: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
  },
  upcoming: { label: 'Upcoming', className: 'border-sky-500/40 text-sky-700 dark:text-sky-400' },
  ended: { label: 'Ended', className: 'text-muted-foreground' },
  sold_out: { label: 'Sold out', className: 'text-muted-foreground' },
}

type IncentiveItemProps = {
  incentive: IncentiveView
  /** Newest redemption not marked done yet */
  nextPending?: ActivityItem
  /** Omitted while marks are read-only */
  onMarkFulfilled?: (donationId: string) => void
}

export const IncentiveItem = ({ incentive, nextPending, onMarkFulfilled }: IncentiveItemProps) => {
  const status = statusStyles[incentive.status]
  const isInactive = incentive.status === 'ended' || incentive.status === 'sold_out'

  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 group-data-[density=compact]/dock:gap-1 group-data-[density=compact]/dock:py-1.5">
      <div className="flex min-w-0 items-start gap-2">
        <p
          className={cn(
            'line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium wrap-anywhere',
            isInactive && 'text-muted-foreground'
          )}
        >
          {incentive.description}
        </p>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {formatMoney(incentive.amount)}
        </span>
      </div>

      <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Badge variant="outline" className={cn('h-5 px-1.5 text-[11px]', status.className)}>
          {status.label}
        </Badge>
        {incentive.isTest && (
          <Badge
            variant="outline"
            className="h-5 border-amber-500/40 px-1.5 text-[11px] text-amber-700 dark:text-amber-400"
          >
            Test
          </Badge>
        )}
        <span className="tabular-nums">
          {incentive.quantity === undefined
            ? `${incentive.claimed} claimed`
            : `${incentive.claimed} / ${incentive.quantity} claimed`}
        </span>
        {incentive.pending > 0 && (
          <span className="font-medium text-amber-700 tabular-nums dark:text-amber-400">
            {incentive.pending} pending
          </span>
        )}
      </div>

      {nextPending && (
        <div className="bg-muted/60 flex min-w-0 items-center gap-2 rounded-md py-1 pr-1 pl-2">
          <p className="min-w-0 flex-1 truncate text-xs">
            <span className="text-muted-foreground">Next: </span>
            <span className="font-medium">{nextPending.displayName}</span>
            {nextPending.message && (
              <span className="text-muted-foreground"> · {nextPending.message}</span>
            )}
          </p>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0"
            disabled={!onMarkFulfilled}
            onClick={() => onMarkFulfilled?.(nextPending.id)}
            aria-label={`Mark done for ${nextPending.displayName}`}
          >
            <Check aria-hidden />
            Mark done
          </Button>
        </div>
      )}
    </li>
  )
}
