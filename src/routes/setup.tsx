import { createFileRoute } from '@tanstack/react-router'

import { SetupPage } from '@features/setup'

export const Route = createFileRoute('/setup')({
  head: () => ({ meta: [{ title: 'Setup · DonorDrive OBS Dashboard' }] }),
  component: SetupPage,
})
