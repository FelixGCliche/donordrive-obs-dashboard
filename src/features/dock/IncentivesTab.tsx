import { Gift } from 'lucide-react'

import { ScrollArea } from '@components'

import { DockEmptyState } from './DockEmptyState'
import { dockScrollAreaClass } from './dockStyles'
import { IncentiveItem } from './IncentiveItem'
import type { DashboardModel } from './model'
import { newestPendingRedemption } from './selectDashboard'

type IncentivesTabProps = {
  model: DashboardModel
  /** Disables marking while marks can't be saved */
  isReadOnly?: boolean
  onMarkFulfilled?: (donationId: string) => void
}

export const IncentivesTab = ({
  model,
  isReadOnly = false,
  onMarkFulfilled,
}: IncentivesTabProps) => {
  if (model.incentives.length === 0) {
    return (
      <DockEmptyState
        icon={<Gift />}
        title="No incentives"
        description="Incentives you add on DonorDrive show up here with their redemptions."
      />
    )
  }

  return (
    <ScrollArea className={dockScrollAreaClass}>
      <ul className="divide-y" aria-label="Incentives">
        {model.incentives.map((incentive) => (
          <IncentiveItem
            key={incentive.id}
            incentive={incentive}
            nextPending={
              incentive.pending > 0 ? newestPendingRedemption(model, incentive.id) : undefined
            }
            onMarkFulfilled={isReadOnly ? undefined : onMarkFulfilled}
          />
        ))}
      </ul>
    </ScrollArea>
  )
}
