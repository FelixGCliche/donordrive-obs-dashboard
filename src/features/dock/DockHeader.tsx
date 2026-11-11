import { FlaskConical, Pause, Play, RotateCw } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage, cn } from '@components'
import type { Participant } from '@features/donordrive'

import { initials } from './dockFormat'
import { DockIconButton } from './DockIconButton'
import { StatusBadge, type DockStatus } from './StatusBadge'

export type DockHeaderProps = {
  participant: Participant | undefined
  status: DockStatus
  isPaused: boolean
  /** Spins the refresh icon while a fetch is in flight */
  isRefreshing?: boolean
  isSandboxOpen: boolean
  onTogglePause?: () => void
  onRefresh?: () => void
  onToggleSandbox?: () => void
}

export const DockHeader = ({
  participant,
  status,
  isPaused,
  isRefreshing = false,
  isSandboxOpen,
  onTogglePause,
  onRefresh,
  onToggleSandbox,
}: DockHeaderProps) => {
  const name = participant?.displayName ?? 'DonorDrive dock'

  return (
    <header className="flex min-w-0 items-center gap-2.5 border-b px-3 py-2.5 group-data-[density=compact]/dock:gap-2 group-data-[density=compact]/dock:py-1.5">
      <Avatar className="group-data-[density=compact]/dock:size-7">
        {participant?.avatarUrl && <AvatarImage src={participant.avatarUrl} alt="" />}
        <AvatarFallback className="text-xs font-semibold">{initials(name)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <h1
          className={cn(
            'truncate text-sm leading-tight font-semibold',
            !participant && 'text-muted-foreground'
          )}
          title={name}
        >
          {name}
        </h1>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <StatusBadge status={status} />
          {participant?.eventName && (
            <span className="text-muted-foreground truncate text-[11px]">
              {participant.eventName}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        <DockIconButton
          label={isPaused ? 'Resume updates' : 'Pause updates'}
          aria-pressed={isPaused}
          onClick={onTogglePause}
          disabled={!onTogglePause}
        >
          {isPaused ? <Play /> : <Pause />}
        </DockIconButton>
        <DockIconButton label="Refresh now" onClick={onRefresh} disabled={!onRefresh || isPaused}>
          <RotateCw className={cn(isRefreshing && 'motion-safe:animate-spin')} />
        </DockIconButton>
        <DockIconButton
          label={isSandboxOpen ? 'Hide sandbox' : 'Show sandbox'}
          aria-pressed={isSandboxOpen}
          onClick={onToggleSandbox}
          disabled={!onToggleSandbox}
          className={cn(isSandboxOpen && 'bg-accent text-amber-600 dark:text-amber-400')}
        >
          <FlaskConical />
        </DockIconButton>
      </div>
    </header>
  )
}
