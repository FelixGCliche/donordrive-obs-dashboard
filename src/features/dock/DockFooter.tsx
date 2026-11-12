import { Settings } from 'lucide-react'

import { Button } from '@components'
import { useNow } from '@hooks'

import { formatAgo } from './dockFormat'
import type { DockInterval } from './dockSearch'

type DockFooterProps = {
  /** ISO 8601 timestamp of the last successful update */
  updatedAt?: string
  /** Poll interval, in seconds */
  interval: DockInterval
  isPaused?: boolean
}

export const DockFooter = ({ updatedAt, interval, isPaused = false }: DockFooterProps) => {
  const now = useNow()

  return (
    <footer className="text-muted-foreground flex min-w-0 items-center gap-2 border-t px-3 py-1.5 text-[11px]">
      <p className="min-w-0 flex-1 truncate tabular-nums">
        {updatedAt ? (
          <>
            Updated <time dateTime={updatedAt}>{formatAgo(updatedAt, now)}</time>
          </>
        ) : (
          'Waiting for the first update…'
        )}
        <span aria-hidden> · </span>
        {isPaused ? 'paused' : `every ${interval}s`}
      </p>
      <Button
        asChild
        variant="ghost"
        size="xs"
        className="text-muted-foreground shrink-0 text-[11px]"
      >
        <a href="/setup">
          <Settings aria-hidden />
          Setup
        </a>
      </Button>
    </footer>
  )
}
