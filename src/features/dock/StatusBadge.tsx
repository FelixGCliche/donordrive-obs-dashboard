import { Badge, cn } from '@components'

export type DockStatus = 'live' | 'paused' | 'retrying' | 'offline' | 'error'

const statusStyles: Record<DockStatus, { label: string; dot: string }> = {
  live: { label: 'Live', dot: 'bg-emerald-500' },
  paused: { label: 'Paused', dot: 'bg-amber-500' },
  retrying: { label: 'Retrying', dot: 'bg-amber-500 motion-safe:animate-pulse' },
  offline: { label: 'Offline', dot: 'bg-zinc-400' },
  error: { label: 'Error', dot: 'bg-red-500' },
}

type StatusBadgeProps = {
  status: DockStatus
  className?: string
}

export const StatusBadge = ({ status, className }: StatusBadgeProps) => {
  const { label, dot } = statusStyles[status]

  return (
    <Badge
      variant="outline"
      role="status"
      className={cn('h-5 gap-1.5 px-1.5 text-[11px] text-muted-foreground', className)}
    >
      <span className="relative flex size-1.5" aria-hidden>
        {status === 'live' && (
          <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
        )}
        <span className={cn('relative size-1.5 rounded-full', dot)} />
      </span>
      {label}
    </Badge>
  )
}
