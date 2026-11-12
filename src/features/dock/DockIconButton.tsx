import type { ComponentProps } from 'react'

import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from '@components'

import { useDockDark } from './useDockTheme'

type DockIconButtonProps = ComponentProps<typeof Button> & {
  /** Accessible name, also shown as the tooltip */
  label: string
}

/** Small ghost icon button with a tooltip. Needs a `TooltipProvider` above it. */
export const DockIconButton = ({ label, className, children, ...props }: DockIconButtonProps) => {
  const isDark = useDockDark()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className={cn('size-7 text-muted-foreground hover:text-foreground', className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={4} className={cn(isDark && 'dark')}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
