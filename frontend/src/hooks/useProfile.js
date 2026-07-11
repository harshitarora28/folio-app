import { useQuery } from '@tanstack/react-query'
import * as api from '../services/api.js'

export const profileKeys = {
  me:             () => ['profile', 'me'],
  highlightCount: () => ['profile', 'highlightCount'],
}

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.me(),
    queryFn:  api.getMe,
    staleTime: 300_000,   // 5 min — profile changes rarely
    retry: false,
  })
}

export function useHighlightCount() {
  return useQuery({
    queryKey: profileKeys.highlightCount(),
    queryFn:  api.getHighlightCount,
    staleTime: 60_000,
  })
}
