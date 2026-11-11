import { EyeIcon, EyeOffIcon, KeyRoundIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
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

/** Replaces every character of a key with a bullet. */
export const maskKey = (key: string): string => '•'.repeat(key.length)

export type DockKeyCardProps = {
  /** null until the key is read or generated on the client */
  dockKey: string | null
  revealed: boolean
  onRevealedChange: (revealed: boolean) => void
  onRegenerate: () => void
}

/** Shows the dock key (masked by default) with reveal and a confirmed regenerate. */
export const DockKeyCard = ({
  dockKey,
  revealed,
  onRevealedChange,
  onRegenerate,
}: DockKeyCardProps) => {
  const [confirming, setConfirming] = useState(false)

  const shownKey = dockKey === null ? 'Generating…' : revealed ? dockKey : maskKey(dockKey)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" />
          Dock key
        </CardTitle>
        <CardDescription>
          Generated in this browser and saved here, so reopening this page builds the same URLs.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* MVP-SHORTCUT(MVP-05): this single key is the only auth for the dock, marks and channel */}
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>This key is the dock's password — don't show it on stream</AlertTitle>
          <AlertDescription>
            Anyone with the key, or a URL that contains it, can read your events and change your
            marks.
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-muted min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-sm">
            {shownKey}
          </code>
          <Button
            type="button"
            variant="outline"
            onClick={() => onRevealedChange(!revealed)}
            disabled={dockKey === null}
            aria-pressed={revealed}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
            {revealed ? 'Hide' : 'Reveal'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirming(true)}
            disabled={dockKey === null || confirming}
          >
            <RefreshCwIcon />
            Regenerate
          </Button>
        </div>
        {confirming && (
          <Alert variant="destructive">
            <RefreshCwIcon />
            <AlertTitle>Regenerate the dock key?</AlertTitle>
            <AlertDescription>
              <p>
                A new key starts empty marks and a new channel. Your current dock and connection
                URLs stop working until you paste the new ones.
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onRegenerate()
                    setConfirming(false)
                  }}
                >
                  Regenerate key
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
