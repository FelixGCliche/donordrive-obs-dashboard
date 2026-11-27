import {
  CircleAlert,
  KeyRound,
  SearchX,
  ShieldAlert,
  Unplug,
  Timer,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle, cn } from '@components'

import type { DockAlert } from './dockAlert'

const retryText = (retryInSec: number | undefined): string =>
  retryInSec === undefined ? 'Retrying automatically.' : `Retrying in ${Math.ceil(retryInSec)}s.`

const SetupLink = () => (
  <a
    href="/setup"
    className="text-foreground font-medium underline underline-offset-4 hover:no-underline"
  >
    Run setup
  </a>
)

type AlertContent = {
  icon: ReactNode
  /** Icon color */
  tone: string
  title: string
  description: ReactNode
}

const alertContent = (alert: DockAlert): AlertContent => {
  switch (alert.kind) {
    case 'missing_pid':
      return {
        icon: <CircleAlert />,
        tone: '[&>svg]:text-amber-500',
        title: "This dock isn't set up",
        description: (
          <p>
            The dock URL has no participant ID. <SetupLink /> and paste the new URL into OBS.
          </p>
        ),
      }
    case 'missing_channel':
      return {
        icon: <KeyRound />,
        tone: '[&>svg]:text-amber-500',
        title: 'Marks are off',
        description: (
          <p>
            This dock URL is missing its channel or uses an old format. Copy the dock URL again from
            setup. <SetupLink />.
          </p>
        ),
      }
    case 'channel_unauthorized':
      return {
        icon: <ShieldAlert />,
        tone: '[&>svg]:text-red-500',
        title: 'Owner key rejected',
        description: (
          <p>
            Your owner key was rotated or is invalid. Copy the new dock URL from setup.{' '}
            <SetupLink />.
          </p>
        ),
      }
    case 'not_found':
      return {
        icon: <SearchX />,
        tone: '[&>svg]:text-red-500',
        title: 'Participant not found',
        description: (
          <p>
            DonorDrive has no participant with this ID. <SetupLink /> to check it.
          </p>
        ),
      }
    case 'channel_disconnected':
      return {
        icon: <Unplug />,
        tone: '[&>svg]:text-amber-500',
        title: 'Reconnecting…',
        description: <p>Marks are read-only until reconnected.</p>,
      }
    case 'rate_limited':
      return {
        icon: <Timer />,
        tone: '[&>svg]:text-amber-500',
        title: 'DonorDrive is limiting requests',
        description: <p>{retryText(alert.retryInSec)}</p>,
      }
    case 'upstream':
      return {
        icon: <TriangleAlert />,
        tone: '[&>svg]:text-red-500',
        title: "Can't reach DonorDrive",
        description: (
          <p>
            {alert.message ? `${alert.message}. ` : ''}
            {retryText(alert.retryInSec)}
          </p>
        ),
      }
    case 'marks_error':
      return {
        icon: <TriangleAlert />,
        tone: '[&>svg]:text-red-500',
        title: "Couldn't save the mark",
        description: <p>{alert.message}</p>,
      }
  }
}

type DockAlertsProps = {
  alerts: DockAlert[]
}

export const DockAlerts = ({ alerts }: DockAlertsProps) => (
  <div className="flex min-w-0 flex-col gap-2">
    {alerts.map((alert) => {
      const content = alertContent(alert)
      return (
        <Alert key={alert.kind} className={cn('px-3 py-2', content.tone)}>
          {content.icon}
          <AlertTitle className="line-clamp-none text-[13px]">{content.title}</AlertTitle>
          <AlertDescription className="text-xs wrap-anywhere">
            {content.description}
          </AlertDescription>
        </Alert>
      )
    })}
  </div>
)
