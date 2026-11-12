import { TanStackDevtools } from '@tanstack/react-devtools'
import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'

import appCss from '../styles.css?url'

type RouterContext = {
  queryClient: QueryClient
}

const Devtools = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // The OBS dock is a tiny embedded browser; keep it free of devtools
  if (pathname.startsWith('/dock')) return null

  return (
    <TanStackDevtools
      config={{ position: 'bottom-right' }}
      plugins={[{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> }]}
    />
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'DonorDrive OBS Dashboard' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: ({ children }: { children: React.ReactNode }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {import.meta.env.DEV && <Devtools />}
        <Scripts />
      </body>
    </html>
  ),
})
