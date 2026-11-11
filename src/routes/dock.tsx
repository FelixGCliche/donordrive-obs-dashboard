import { createFileRoute } from '@tanstack/react-router'

import { Dock, dockSearchSchema, useDashboard } from '@features/dock'

const DockRoute = () => {
  const props = useDashboard(Route.useSearch())
  return <Dock {...props} />
}

export const Route = createFileRoute('/dock')({
  // The dock reads localStorage and opens a WebSocket; it renders in the browser only
  ssr: false,
  validateSearch: dockSearchSchema,
  head: () => ({ meta: [{ title: 'Dock · DonorDrive OBS Dashboard' }] }),
  component: DockRoute,
})
