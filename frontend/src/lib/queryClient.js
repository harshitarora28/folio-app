import { QueryClient } from '@tanstack/react-query'

// Single shared instance — imported by App.jsx (provider) and ProfileScreen.jsx
// (sign-out clear). Keeping it here instead of inline in App.jsx means any
// screen can clear/invalidate the cache without prop-drilling the client down.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
    mutations: {
      retry: 0,
    },
  },
})
