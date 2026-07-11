import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../services/api.js'
import { useUIStore } from '../stores/uiStore.js'

// ── AI explain / summarize / define ──────────────────────────────────────────

/**
 * Fire-and-forget AI text query.
 * We use useMutation (not useQuery) because it's user-triggered,
 * not a background fetch. The response is held in mutation.data.
 */
export function useAIQuery() {
  return useMutation({
    mutationFn: (params) => api.aiQuery(params),
    // No cache invalidation needed — responses are read-only
  })
}

// ── Imagine scene generation ──────────────────────────────────────────────────

/**
 * Trigger scene visualization. Heavy operation — shows loading state.
 * Result (imageUrl + description) lives in mutation.data until reset.
 */
export function useImagine() {
  const addToast = useUIStore((s) => s.addToast)

  return useMutation({
    mutationFn: (params) => api.aiImagine(params),
    onError: () => {
      addToast('Scene generation failed — please try again', 'error')
    },
  })
}

// ── Recap ─────────────────────────────────────────────────────────────────────

export function useRecap(bookId) {
  return useMutation({
    mutationFn: (data) => api.getRecap(bookId, data),
  })
}
