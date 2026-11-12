import { useHydrated } from '@tanstack/react-router'
import { useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@components'

import { buildChannelUrl, buildDockUrl } from './buildDockUrl'
import { useDockKey } from './dockKey'
import { DockKeyCard, maskKey } from './DockKeyCard'
import { SetupForm, isValidPid } from './SetupForm'
import { UrlOutput } from './UrlOutput'
import { useSetupConfig } from './useSetupConfig'

// Shown during SSR, before the browser's origin is known
const PLACEHOLDER_ORIGIN = 'https://your-dashboard.example'

/** Setup page: dock settings, dock key, the OBS dock URL and the connection URL for third-party apps. */
export const SetupPage = () => {
  const hydrated = useHydrated()
  const origin = hydrated ? window.location.origin : PLACEHOLDER_ORIGIN
  const { key, regenerate } = useDockKey()
  const [config, setConfig] = useSetupConfig()
  const [revealed, setRevealed] = useState(false)

  const pid = isValidPid(config.pid) ? config.pid : undefined

  const mask = (url: string) => (key && !revealed ? url.replaceAll(key, maskKey(key)) : url)

  const dockUrl = buildDockUrl(origin, {
    pid,
    host: config.host,
    interval: config.interval,
    theme: config.theme,
    density: config.density,
    key: key ?? undefined,
  })
  const channelUrl = buildChannelUrl(origin, key ?? '…')

  return (
    <main className="mx-auto grid max-w-[720px] gap-6 px-4 py-10">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">DonorDrive OBS dock setup</h1>
        <p className="text-muted-foreground">
          Pick your settings, then paste the dock URL into OBS. Third-party apps can use the
          connection URL.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Dock settings</CardTitle>
          <CardDescription>Saved in this browser.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <SetupForm values={config} onChange={setConfig} />
        </CardContent>
      </Card>

      <DockKeyCard
        dockKey={key}
        revealed={revealed}
        onRevealedChange={setRevealed}
        onRegenerate={regenerate}
      />

      <Card>
        <CardHeader>
          <CardTitle>URLs</CardTitle>
          <CardDescription>
            Both contain the dock key. Copy them off stream, and never show them on screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <UrlOutput
            label="Dock URL"
            value={dockUrl}
            displayValue={mask(dockUrl)}
            disabled={!pid || !key}
            description={
              pid
                ? 'In OBS: Docks → Custom Browser Docks, name the dock, paste this URL and click Apply.'
                : 'Enter a valid participant ID to build the dock URL.'
            }
          />
          <UrlOutput
            label="Connection URL for third-party apps"
            value={channelUrl}
            displayValue={mask(channelUrl)}
            disabled={!key}
            description={
              <>
                Apps that react to donations and incentives subscribe to this WebSocket URL. See{' '}
                <code>docs/channel-protocol.md</code> for the event format.
              </>
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OBS steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid list-decimal gap-2 pl-5 text-sm">
            <li>Copy the dock URL above.</li>
            <li>
              In OBS, open <strong>Docks → Custom Browser Docks</strong>.
            </li>
            <li>
              Enter a name (e.g. <em>Donations</em>), paste the URL and click <strong>Apply</strong>
              .
            </li>
            <li>
              Keep the dock open while streaming so new donations reach apps using the connection
              URL.
            </li>
          </ol>
        </CardContent>
      </Card>
    </main>
  )
}
