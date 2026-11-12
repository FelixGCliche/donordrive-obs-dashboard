import { LoaderCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Badge, cn, Tabs, TabsContent, TabsList, TabsTrigger, TooltipProvider } from '@components'

import { ActivityTab } from './ActivityTab'
import { isMarksBlockingAlert, type DockAlert } from './dockAlert'
import { DockAlerts } from './DockAlerts'
import { DockFooter } from './DockFooter'
import { DockHeader } from './DockHeader'
import type { DockSearch } from './dockSearch'
import { GoalCard } from './GoalCard'
import { IncentivesTab } from './IncentivesTab'
import type { DashboardModel } from './model'
import type { DockStatus } from './StatusBadge'
import { DockDarkContext, useIsDarkDock } from './useDockTheme'

export type DockHandlers = {
  onTogglePause?: () => void
  onRefresh?: () => void
  onToggleSandbox?: () => void
  /** Called with the next read state of the donation */
  onToggleRead?: (donationId: string, isRead: boolean) => void
  onMarkAllRead?: () => void
  /** Marks one incentive redemption (a donation) as done */
  onMarkFulfilled?: (donationId: string) => void
}

export type DockProps = DockHandlers & {
  /** Undefined until the first snapshot arrives */
  model: DashboardModel | undefined
  status: DockStatus
  alerts?: DockAlert[]
  search: Pick<DockSearch, 'theme' | 'density' | 'interval'>
  isPaused?: boolean
  isRefreshing?: boolean
  isSandboxOpen?: boolean
  /** Sandbox panel, shown while `isSandboxOpen` */
  sandboxSlot?: ReactNode
  /** Blocks mark changes; defaults to true when an alert says marks can't be saved */
  isMarksReadOnly?: boolean
}

type DockTab = 'activity' | 'incentives'

const TabCount = ({ count, label, tone }: { count: number; label: string; tone: string }) =>
  count > 0 ? (
    <Badge variant="secondary" className={cn('h-4 min-w-4 px-1 text-[10px] tabular-nums', tone)}>
      {count}
      <span className="sr-only"> {label}</span>
    </Badge>
  ) : null

/** The OBS browser dock: status, goal, activity and incentives. Purely props-driven. */
export const Dock = ({
  model,
  status,
  alerts = [],
  search,
  isPaused = false,
  isRefreshing = false,
  isSandboxOpen = false,
  sandboxSlot,
  isMarksReadOnly,
  onTogglePause,
  onRefresh,
  onToggleSandbox,
  onToggleRead,
  onMarkAllRead,
  onMarkFulfilled,
}: DockProps) => {
  const [tab, setTab] = useState<DockTab>('activity')
  const isDark = useIsDarkDock(search.theme)
  const isReadOnly = isMarksReadOnly ?? alerts.some(isMarksBlockingAlert)

  return (
    <TooltipProvider>
      <DockDarkContext.Provider value={isDark}>
        <div
          data-density={search.density}
          className={cn(
            'group/dock flex h-screen w-full min-w-0 flex-col overflow-hidden bg-background text-foreground antialiased',
            isDark && 'dark'
          )}
          style={{ colorScheme: isDark ? 'dark' : 'light' }}
        >
          <DockHeader
            participant={model?.participant}
            status={status}
            isPaused={isPaused}
            isRefreshing={isRefreshing}
            isSandboxOpen={isSandboxOpen}
            onTogglePause={onTogglePause}
            onRefresh={onRefresh}
            onToggleSandbox={onToggleSandbox}
          />

          <main className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-w-0 shrink-0 flex-col gap-2 px-2 pt-2 group-data-[density=compact]/dock:gap-1.5 group-data-[density=compact]/dock:pt-1.5">
              {alerts.length > 0 && <DockAlerts alerts={alerts} />}

              {isSandboxOpen && sandboxSlot && (
                <section
                  aria-label="Sandbox"
                  className="max-h-[40vh] min-w-0 overflow-y-auto rounded-lg border border-dashed border-amber-500/50"
                >
                  {sandboxSlot}
                </section>
              )}

              {model && <GoalCard goal={model.goal} />}
            </div>

            {model ? (
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as DockTab)}
                className="min-h-0 flex-1 gap-0"
              >
                <TabsList className="mx-2 mt-2 w-auto self-stretch group-data-[density=compact]/dock:mt-1.5 group-data-[density=compact]/dock:h-8">
                  <TabsTrigger value="activity" className="min-w-0 text-xs">
                    <span className="truncate">Activity</span>
                    <TabCount
                      count={model.unreadCount}
                      label="unread"
                      tone="bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    />
                  </TabsTrigger>
                  <TabsTrigger value="incentives" className="min-w-0 text-xs">
                    <span className="truncate">Incentives</span>
                    <TabCount
                      count={model.pendingCount}
                      label="pending"
                      tone="bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    />
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="activity" className="mt-2 flex min-h-0 flex-col border-t">
                  <ActivityTab
                    items={model.activity}
                    unreadCount={model.unreadCount}
                    isReadOnly={isReadOnly}
                    onToggleRead={onToggleRead}
                    onMarkAllRead={onMarkAllRead}
                  />
                </TabsContent>
                <TabsContent value="incentives" className="mt-2 flex min-h-0 flex-col border-t">
                  <IncentivesTab
                    model={model}
                    isReadOnly={isReadOnly}
                    onMarkFulfilled={onMarkFulfilled}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              alerts.length === 0 && (
                <div
                  className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-xs"
                  role="status"
                >
                  <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
                  Loading donations…
                </div>
              )
            )}
          </main>

          <DockFooter updatedAt={model?.fetchedAt} interval={search.interval} isPaused={isPaused} />
        </div>
      </DockDarkContext.Provider>
    </TooltipProvider>
  )
}
