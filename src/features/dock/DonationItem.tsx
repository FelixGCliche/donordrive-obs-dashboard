import { Check, Gift } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage, Badge, cn } from '@components'

import { formatMoney, formatShortAge, initials } from './dockFormat'
import type { ActivityItem } from './model'

type DonationItemProps = {
  item: ActivityItem
  now: Date
  /** Called with the next read state; omitted while marks are read-only */
  onToggleRead?: (donationId: string, isRead: boolean) => void
}

export const DonationItem = ({ item, now, onToggleRead }: DonationItemProps) => {
  const isUnread = !item.isRead

  return (
    <li>
      <button
        type="button"
        data-unread={isUnread}
        disabled={!onToggleRead}
        onClick={() => onToggleRead?.(item.id, !item.isRead)}
        className="hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-ring/50 relative flex w-full min-w-0 gap-2.5 px-3 py-2.5 text-left transition-colors outline-none group-data-[density=compact]/dock:gap-2 group-data-[density=compact]/dock:py-1.5 focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-default data-[unread=true]:bg-sky-500/[0.06]"
      >
        {isUnread && (
          <span
            className="absolute top-4 left-1 size-1.5 rounded-full bg-sky-500 group-data-[density=compact]/dock:top-3"
            aria-hidden
          />
        )}

        <Avatar size="sm" className="mt-0.5">
          {item.avatarUrl && <AvatarImage src={item.avatarUrl} alt="" />}
          <AvatarFallback className="text-[10px] font-semibold">
            {initials(item.displayName)}
          </AvatarFallback>
        </Avatar>

        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            {isUnread && <span className="sr-only">Unread:</span>}
            <span
              className={cn(
                'truncate text-sm',
                isUnread ? 'font-semibold' : 'font-medium text-foreground/80'
              )}
            >
              {item.displayName}
            </span>
            {item.isTest && (
              <Badge
                variant="outline"
                className="h-4 shrink-0 border-amber-500/40 px-1 text-[10px] text-amber-700 dark:text-amber-400"
              >
                Test
              </Badge>
            )}
            <time
              dateTime={item.createdAt}
              className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
            >
              {formatShortAge(item.createdAt, now)}
            </time>
            <span
              className={cn(
                'ml-auto shrink-0 pl-1 text-sm tabular-nums',
                item.amount === null ? 'text-xs text-muted-foreground' : 'font-semibold'
              )}
            >
              {item.amount === null ? 'Hidden' : formatMoney(item.amount)}
            </span>
          </span>

          {item.message && (
            <span className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug wrap-anywhere">
              {item.message}
            </span>
          )}

          {item.incentive && (
            <Badge
              variant="outline"
              className={cn(
                'mt-1.5 h-5 max-w-full min-w-0 shrink justify-start rounded-md px-1.5 text-[11px] font-normal',
                item.incentive.isFulfilled
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-foreground/90'
              )}
            >
              {item.incentive.isFulfilled ? <Check aria-hidden /> : <Gift aria-hidden />}
              <span className="truncate">{item.incentive.description}</span>
              <span className="sr-only">
                {item.incentive.isFulfilled ? ', done' : ', not done'}
              </span>
            </Badge>
          )}
        </span>
      </button>
    </li>
  )
}
