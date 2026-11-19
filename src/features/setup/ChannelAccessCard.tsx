import {
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useState } from 'react'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@components'
import type { ChannelRole, CreatedChannel } from '@features/channel'

import type { ChannelCredentialsStatus } from './channelCredentials'
import { maskSecret } from './channelCredentials'

/** Which secrets are shown in full; both are masked by default. */
export type RevealedSecrets = Record<ChannelRole, boolean>

type PendingAction = ChannelRole | 'new'

const roleCopy: Record<
  ChannelRole,
  { label: string; hint: string; confirmTitle: string; confirmBody: string }
> = {
  owner: {
    label: 'Owner key',
    hint: 'Full access: reads events, writes marks and publishes donations. Only the dock URL contains it.',
    confirmTitle: 'Rotate the owner key?',
    confirmBody:
      'Your current dock URL stops working until you paste the new dock URL into OBS. Do this if the dock URL leaked.',
  },
  subscriber: {
    label: 'Subscribe token',
    hint: 'Read-only: third-party apps use it to receive events. Only the connection URL contains it.',
    confirmTitle: 'Rotate the subscribe token?',
    confirmBody:
      'Third-party apps are disconnected until you give them the new connection URL. Do this to cut off an app.',
  },
}

const roleSecret = (credentials: CreatedChannel, role: ChannelRole): string =>
  role === 'owner' ? credentials.ownerKey : credentials.subscribeToken

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Something went wrong'

type ConfirmAlertProps = {
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmAlert = ({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: ConfirmAlertProps) => (
  <Alert variant="destructive">
    <TriangleAlertIcon />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>
      <p>{body}</p>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={busy}>
          {busy && <LoaderCircleIcon className="animate-spin" />}
          {confirmLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </AlertDescription>
  </Alert>
)

export type ChannelAccessCardProps = {
  credentials: CreatedChannel | null
  status: ChannelCredentialsStatus
  error?: string
  onRetry: () => void
  revealed: RevealedSecrets
  onRevealedChange: (role: ChannelRole, revealed: boolean) => void
  onRotate: (role: ChannelRole) => Promise<void>
  onStartNewChannel: () => Promise<void>
}

/** Shows the owner key and subscribe token (masked by default) with reveal and confirmed rotation. */
export const ChannelAccessCard = ({
  credentials,
  status,
  error,
  onRetry,
  revealed,
  onRevealedChange,
  onRotate,
  onStartNewChannel,
}: ChannelAccessCardProps) => {
  const [confirming, setConfirming] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState<PendingAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const run = async (action: PendingAction) => {
    setBusy(action)
    setActionError(null)
    try {
      await (action === 'new' ? onStartNewChannel() : onRotate(action))
      setConfirming(null)
    } catch (reason) {
      setActionError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const disabled = credentials === null || busy !== null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" />
          Channel access
        </CardTitle>
        <CardDescription>
          Created for this browser and saved here, so reopening this page builds the same URLs.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {status === 'loading' && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Creating your channel…
          </p>
        )}

        {status === 'error' && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Could not create your channel</AlertTitle>
            <AlertDescription>
              <p>{error ?? 'Something went wrong.'}</p>
              <div className="mt-2">
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  <RefreshCwIcon />
                  Try again
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {credentials !== null && (
          <>
            {(['owner', 'subscriber'] as const).map((role) => {
              const secret = roleSecret(credentials, role)
              const copy = roleCopy[role]
              const shown = revealed[role]
              return (
                <div key={role} className="grid gap-2">
                  <div className="grid gap-0.5">
                    <span className="text-sm font-medium">{copy.label}</span>
                    <span className="text-muted-foreground text-sm">{copy.hint}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      className="bg-muted min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-sm"
                      aria-label={copy.label}
                    >
                      {shown ? secret : maskSecret(secret)}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onRevealedChange(role, !shown)}
                      aria-pressed={shown}
                    >
                      {shown ? <EyeOffIcon /> : <EyeIcon />}
                      {shown ? 'Hide' : 'Reveal'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setActionError(null)
                        setConfirming(role)
                      }}
                      disabled={disabled || confirming !== null}
                    >
                      <RotateCwIcon />
                      Rotate
                    </Button>
                  </div>
                  {confirming === role && (
                    <ConfirmAlert
                      title={copy.confirmTitle}
                      body={copy.confirmBody}
                      confirmLabel={`Rotate ${copy.label.toLowerCase()}`}
                      busy={busy === role}
                      onConfirm={() => void run(role)}
                      onCancel={() => setConfirming(null)}
                    />
                  )}
                </div>
              )
            })}

            <div className="grid gap-2 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="grid gap-0.5">
                  <span className="text-sm font-medium">Start a new channel</span>
                  <span className="text-muted-foreground text-sm">
                    Wipes your marks and replaces the channel, owner key and subscribe token.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setActionError(null)
                    setConfirming('new')
                  }}
                  disabled={disabled || confirming !== null}
                >
                  <RefreshCwIcon />
                  Start a new channel
                </Button>
              </div>
              {confirming === 'new' && (
                <ConfirmAlert
                  title="Start a new channel?"
                  body="Your read and fulfilled marks are wiped. The dock URL and the connection URL both stop working until you paste the new ones into OBS and your apps."
                  confirmLabel="Start a new channel"
                  busy={busy === 'new'}
                  onConfirm={() => void run('new')}
                  onCancel={() => setConfirming(null)}
                />
              )}
            </div>

            {actionError !== null && (
              <Alert variant="destructive" role="alert">
                <TriangleAlertIcon />
                <AlertTitle>That didn't work</AlertTitle>
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
