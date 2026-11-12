import { CheckCheck, Inbox } from 'lucide-react'

import { Button, ScrollArea } from '@components'
import { useNow } from '@hooks'

import { DockEmptyState } from './DockEmptyState'
import { dockScrollAreaClass } from './dockStyles'
import { DonationItem } from './DonationItem'
import type { ActivityItem } from './model'

type ActivityTabProps = {
  items: ActivityItem[]
  unreadCount: number
  /** Disables marking while marks can't be saved */
  isReadOnly?: boolean
  onToggleRead?: (donationId: string, isRead: boolean) => void
  onMarkAllRead?: () => void
}

export const ActivityTab = ({
  items,
  unreadCount,
  isReadOnly = false,
  onToggleRead,
  onMarkAllRead,
}: ActivityTabProps) => {
  const now = useNow(15_000)

  if (items.length === 0) {
    return (
      <DockEmptyState
        icon={<Inbox />}
        title="No donations yet"
        description="New donations show up here as they come in. Open the sandbox to add a test one."
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b px-3 py-1">
        <span className="text-muted-foreground truncate text-xs" aria-live="polite">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground shrink-0"
          disabled={isReadOnly || unreadCount === 0 || !onMarkAllRead}
          onClick={onMarkAllRead}
        >
          <CheckCheck aria-hidden />
          Mark all read
        </Button>
      </div>

      <ScrollArea className={dockScrollAreaClass}>
        <ul className="divide-y" aria-label="Donations">
          {items.map((item) => (
            <DonationItem
              key={item.id}
              item={item}
              now={now}
              onToggleRead={isReadOnly ? undefined : onToggleRead}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}
