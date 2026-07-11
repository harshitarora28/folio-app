import { create } from 'zustand'

/**
 * UI store — global transient state that doesn't belong in any one page.
 * Toasts, modal visibility flags, sidebar state.
 */
export const useUIStore = create((set) => ({
  // ── Toast notifications ───────────────────────────────────────────────
  toasts: [],  // [{ id, message, type }]

  addToast: (message, type = 'info') => {
    const id = Date.now()
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, 3500)
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  // ── Chat sidebar ──────────────────────────────────────────────────────
  chatSidebarOpen: true,
  setChatSidebarOpen: (open) => set({ chatSidebarOpen: open }),
  toggleChatSidebar: () => set((s) => ({ chatSidebarOpen: !s.chatSidebarOpen })),

  // ── Active chat session id (so Reader can pre-select it) ──────────────
  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),
}))
