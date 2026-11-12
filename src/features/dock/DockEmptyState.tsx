import type { ReactNode } from 'react'

type DockEmptyStateProps = {
  icon: ReactNode
  title: string
  description: string
}

export const DockEmptyState = ({ icon, title, description }: DockEmptyStateProps) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
    <span
      className="bg-muted text-muted-foreground mb-1 flex size-9 items-center justify-center rounded-full [&>svg]:size-4"
      aria-hidden
    >
      {icon}
    </span>
    <p className="text-sm font-medium">{title}</p>
    <p className="text-muted-foreground max-w-60 text-xs text-pretty">{description}</p>
  </div>
)
