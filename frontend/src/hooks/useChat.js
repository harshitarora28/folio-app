import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../services/api.js'
import { useUIStore } from '../stores/uiStore.js'

export const chatKeys = {
  sessions: (bookId) => ['chats', bookId, 'sessions'],
  messages: (sessionId) => ['chats', 'messages', sessionId],
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useChatSessions(bookId) {
  return useQuery({
    queryKey: chatKeys.sessions(bookId),
    queryFn:  () => api.getChatSessions(bookId),
    enabled:  !!bookId,
    staleTime: 30_000,
  })
}

export function useChatMessages(sessionId) {
  return useQuery({
    queryKey: chatKeys.messages(sessionId),
    queryFn:  () => api.getChatMessages(sessionId),
    enabled:  !!sessionId,
    staleTime: 0,          // always fresh — messages are append-only
    gcTime:    600_000,    // but keep in cache for 10 min while browsing sessions
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateSession(bookId) {
  const qc = useQueryClient()
  const { setActiveSessionId } = useUIStore()

  return useMutation({
    mutationFn: (title) => api.createChatSession(bookId, title),

    onSuccess: (newSession) => {
      // Prepend to session list cache
      qc.setQueryData(chatKeys.sessions(bookId), (old) =>
        [newSession, ...(old ?? [])]
      )
      // Pre-seed an empty messages cache so there's no loading flash
      qc.setQueryData(chatKeys.messages(newSession.id), [])
      setActiveSessionId(newSession.id)
    },
  })
}

export function useDeleteSession(bookId) {
  const qc = useQueryClient()
  const { setActiveSessionId } = useUIStore()

  return useMutation({
    mutationFn: (sessionId) => api.deleteChatSession(sessionId),

    onMutate: async (sessionId) => {
      await qc.cancelQueries({ queryKey: chatKeys.sessions(bookId) })
      const prev = qc.getQueryData(chatKeys.sessions(bookId))
      const updated = prev?.filter(s => s.id !== sessionId) ?? []
      qc.setQueryData(chatKeys.sessions(bookId), updated)

      // Auto-select next session
      const active = useUIStore.getState().activeSessionId
      if (active === sessionId) {
        setActiveSessionId(updated[0]?.id ?? null)
      }
      return { prev }
    },

    onError: (_err, _vars, ctx) => {
      qc.setQueryData(chatKeys.sessions(bookId), ctx.prev)
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(bookId) })
    },
  })
}

/**
 * Send a message + receive AI reply.
 * Full optimistic UI:
 *  1. User message inserted immediately with a temp id.
 *  2. Typing bubble shown via isPending.
 *  3. On success: replace temp id + append AI response.
 *  4. On error: remove the optimistic message + show toast.
 */
export function useSendMessage(sessionId, bookId) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  return useMutation({
    mutationFn: (content) => api.sendChatMessage(sessionId, { content, bookId }),

    onMutate: async (content) => {
      await qc.cancelQueries({ queryKey: chatKeys.messages(sessionId) })
      const prev = qc.getQueryData(chatKeys.messages(sessionId))

      const tempId = `opt-${Date.now()}`
      const optimisticMsg = {
        id: tempId, role: 'user', content,
        created_at: new Date().toISOString(),
      }
      qc.setQueryData(chatKeys.messages(sessionId), (old) =>
        [...(old ?? []), optimisticMsg]
      )
      return { prev, tempId }
    },

    onSuccess: (res, _content, ctx) => {
      qc.setQueryData(chatKeys.messages(sessionId), (old) => {
        // Replace temp user message with confirmed one + add AI reply
        const withoutTemp = old?.filter(m => m.id !== ctx.tempId) ?? []
        const userConfirmed = {
          id: res.userMessageId ?? ctx.tempId,
          role: 'user',
          content: _content,
          created_at: new Date().toISOString(),
        }
        const aiMsg = {
          id: res.id, role: 'assistant',
          content: res.content,
          created_at: res.created_at,
        }
        return [...withoutTemp, userConfirmed, aiMsg]
      })

      // Update session preview in sidebar
      qc.setQueryData(chatKeys.sessions(bookId), (old) =>
        old?.map(s => s.id === sessionId
          ? { ...s, last_message: _content.slice(0, 60), updated_at: new Date().toISOString() }
          : s
        )
      )
    },

    onError: (_err, _content, ctx) => {
      // Roll back optimistic message
      qc.setQueryData(chatKeys.messages(sessionId), ctx.prev)
      addToast('Message failed — please try again', 'error')
    },
  })
}
