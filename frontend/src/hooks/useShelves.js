import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../services/api.js'
import { useUIStore } from '../stores/uiStore.js'

export const shelfKeys = {
  all: () => ['shelves'],
}

// ── Query ─────────────────────────────────────────────────────────────────────

export function useShelves() {
  return useQuery({
    queryKey: shelfKeys.all(),
    queryFn:  api.getShelves,
    staleTime: 60_000,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateShelf() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  return useMutation({
    mutationFn: (name) => api.createShelf(name),

    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: shelfKeys.all() })
      const prev = qc.getQueryData(shelfKeys.all())
      const optimistic = {
        id: `opt-${Date.now()}`, name, bookIds: [],
        created_at: new Date().toISOString(),
      }
      qc.setQueryData(shelfKeys.all(), (old) => [...(old ?? []), optimistic])
      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      qc.setQueryData(shelfKeys.all(), ctx.prev)
      addToast('Failed to create shelf', 'error')
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: shelfKeys.all() })
    },
  })
}

export function useRenameShelf() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ id, name }) => api.renameShelf(id, name),

    onMutate: async ({ id, name }) => {
      await qc.cancelQueries({ queryKey: shelfKeys.all() })
      const prev = qc.getQueryData(shelfKeys.all())
      qc.setQueryData(shelfKeys.all(), (old) =>
        old?.map(s => s.id === id ? { ...s, name } : s)
      )
      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      qc.setQueryData(shelfKeys.all(), ctx.prev)
    },
  })
}

export function useDeleteShelf() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  return useMutation({
    mutationFn: (id) => api.deleteShelf(id),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: shelfKeys.all() })
      const prev = qc.getQueryData(shelfKeys.all())
      qc.setQueryData(shelfKeys.all(), (old) => old?.filter(s => s.id !== id))
      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      qc.setQueryData(shelfKeys.all(), ctx.prev)
      addToast('Failed to delete shelf', 'error')
    },
  })
}

export function useAddBookToShelf() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ shelfId, bookId }) => api.addBookToShelf(shelfId, bookId),

    onMutate: async ({ shelfId, bookId }) => {
      await qc.cancelQueries({ queryKey: shelfKeys.all() })
      const prev = qc.getQueryData(shelfKeys.all())
      qc.setQueryData(shelfKeys.all(), (old) =>
        old?.map(s => s.id === shelfId
          ? { ...s, bookIds: [...(s.bookIds ?? []), bookId] }
          : s
        )
      )
      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      qc.setQueryData(shelfKeys.all(), ctx.prev)
    },
  })
}

export function useRemoveBookFromShelf() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ shelfId, bookId }) => api.removeFromShelf(shelfId, bookId),

    onMutate: async ({ shelfId, bookId }) => {
      await qc.cancelQueries({ queryKey: shelfKeys.all() })
      const prev = qc.getQueryData(shelfKeys.all())
      qc.setQueryData(shelfKeys.all(), (old) =>
        old?.map(s => s.id === shelfId
          ? { ...s, bookIds: s.bookIds?.filter(id => id !== bookId) }
          : s
        )
      )
      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      qc.setQueryData(shelfKeys.all(), ctx.prev)
    },
  })
}
