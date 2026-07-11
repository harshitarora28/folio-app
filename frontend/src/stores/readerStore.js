import { create } from 'zustand'

export const useReaderStore = create((set, get) => ({
  bookId:       null,
  bookTitle:    '',
  bookAuthor:   '',
  coverColor:   '#2D3561',

  currentCfi:   null,
  progress:     0,
  chapterTitle: '',

  theme:        'dark',
  fontSize:     17,

  // Start hidden — text fills screen immediately, tap to show controls
  showControls: false,

  selection: { text: '', cfi: null },

  setBook: (meta) => set({
    bookId:     meta.id,
    bookTitle:  meta.title,
    bookAuthor: meta.author,
    coverColor: meta.coverColor,
  }),

  setPosition: (cfi, pct) => set({ currentCfi: cfi, progress: pct }),

  setChapter: (title) => set({ chapterTitle: title }),

  setTheme: (theme) => set({ theme }),

  setFontSize: (fontSize) => set({ fontSize }),

  toggleControls: () => set((s) => ({ showControls: !s.showControls })),

  setSelection: (text, cfi) => set({ selection: { text, cfi } }),

  clearSelection: () => set({ selection: { text: '', cfi: null } }),

  leaveReader: () => set({
    bookId:       null,
    currentCfi:   null,
    progress:     0,
    chapterTitle: '',
    selection:    { text: '', cfi: null },
    showControls: false,
  }),
}))
