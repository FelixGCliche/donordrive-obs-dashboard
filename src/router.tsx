import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

export const getRouter = () => {
  // A fresh QueryClient per router keeps SSR requests isolated
  const queryClient = new QueryClient()

  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Let TanStack Query own data freshness
    defaultPreloadStaleTime: 0,
    context: { queryClient },
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
