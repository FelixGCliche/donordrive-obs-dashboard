import { FlaskConical } from 'lucide-react'

import { Card, Progress } from '@components'

import { formatMoney } from './dockFormat'
import type { GoalView } from './model'

type GoalCardProps = {
  goal: GoalView
}

export const GoalCard = ({ goal }: GoalCardProps) => {
  const hasGoal = goal.goal > 0
  const pct = Math.floor(goal.pct)

  return (
    <Card className="gap-2 rounded-lg px-3 py-3 shadow-none group-data-[density=compact]/dock:gap-1.5 group-data-[density=compact]/dock:py-2">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="text-2xl leading-none font-semibold tracking-tight tabular-nums group-data-[density=compact]/dock:text-xl">
            {formatMoney(goal.raised)}
          </span>
          <span className="text-muted-foreground truncate text-xs tabular-nums">
            {hasGoal ? `of ${formatMoney(goal.goal)}` : 'raised, no goal set'}
          </span>
        </p>
        {hasGoal && (
          <span className="shrink-0 text-sm font-medium tabular-nums">
            {pct}%<span className="sr-only"> of goal</span>
          </span>
        )}
      </div>

      {hasGoal && <Progress value={goal.pct} aria-label="Progress toward goal" className="h-1.5" />}

      {goal.testSum > 0 && (
        <p className="flex min-w-0 items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <FlaskConical className="size-3 shrink-0" aria-hidden />
          <span className="truncate">includes {formatMoney(goal.testSum)} test</span>
        </p>
      )}
    </Card>
  )
}
