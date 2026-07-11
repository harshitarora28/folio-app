import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { File, Directory, Paths } from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import {
  getAllBooks,
  saveBook,
  saveEpub,
  epubExists,
  hashEpubFile,
  randomCoverColor,
  updateBookMeta,
} from "../utils/bookStore";
import * as api from "../services/api";
import { useUIStore } from "../stores/uiStore";

export const bookKeys = {
  all: () => ["books"],
  library: () => ["books", "library"],
  progress: (id) => ["books", id, "progress"],
  highlights: (id) => ["books", id, "highlights"],
};

// ── Queries ───────────────────────────────────────────────────────────────────

// ── useLibrary ────────────────────────────────────────────────────────────────
// LAZY SYNC: only syncs metadata on login — never downloads EPUBs here.
// EPUBs are downloaded on-demand when user taps a book (see useOpenBook).
// This means the library loads instantly on a new device with all book cards
// visible, and EPUB download only happens when the user actually wants to read.
export function useLibrary() {
  return useQuery({
    queryKey: bookKeys.library(),
    queryFn: async () => {
      const local = await getAllBooks();
      const localIds = new Set(local.map((b) => b.id));

      // ── Sync metadata from cloud (fast — no file downloads) ───────────────
      // Fetch book list from backend. Any books the user has on other devices
      // that aren't in local AsyncStorage yet get added as metadata-only entries
      // (no EPUB file). The book card shows immediately. EPUB downloads on tap.
      let cloudBooks = [];
      try {
        cloudBooks = (await api.getBooks()) ?? [];
      } catch {
        // Offline or network error — use local library only
      }

      // Add cloud books not in local storage as metadata-only stubs
      for (const b of cloudBooks) {
        if (!localIds.has(b.id)) {
          await saveBook({
            id: b.id,
            title: b.title || "Unknown Title",
            author: b.author || "Unknown Author",
            coverColor: randomCoverColor(),
            coverUri: null,
            addedAt: b.createdAt ?? new Date().toISOString(),
            cloudSynced: b.cloudSynced ?? false,
            epubReady: false, // ← marks this as metadata-only, no local EPUB
          });
          localIds.add(b.id);
        }
      }

      // Re-read after metadata sync
      const all = await getAllBooks();

      // Attach progress data and mark which books have local EPUBs
      const withProgress = await Promise.all(
        all.map(async (b) => {
          const prog = await api.getProgress(b.id).catch(() => null);
          return {
            ...b,
            progress: parseFloat(prog?.percentage ?? 0),
            cfi: prog?.cfi ?? null,
            lastRead: prog?.updatedAt ?? prog?.updated_at ?? null,
            lastReadAt: prog?.updatedAt ?? prog?.updated_at ?? b.lastReadAt ?? null,
            epubReady: b.epubReady !== false ? epubExists(b.id) : false,
          };
        }),
      );

      // Sort by lastReadAt from cloud (authoritative cross-device order),
      // fall back to local lastRead, then addedAt for unread books
      return withProgress.sort((a, b) => {
        const aTime = a.lastReadAt || a.lastRead || a.addedAt;
        const bTime = b.lastReadAt || b.lastRead || b.addedAt;
        if (!aTime && !bTime) return 0;
        if (!aTime) return 1;
        if (!bTime) return -1;
        return new Date(bTime) - new Date(aTime);
      });
    },
    staleTime: 30_000,
    gcTime: 300_000,
  });
}

// ── useOpenBook ───────────────────────────────────────────────────────────────
// Call this before navigating to ReaderScreen.
// If EPUB exists locally → resolves immediately.
// If EPUB is cloud-synced but not downloaded → downloads first, then resolves.
// Returns { bookId, ready: true } on success.
export function useOpenBook() {
  const qc = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (book) => {
      // Already have it locally — open immediately
      if (epubExists(book.id)) return { bookId: book.id, ready: true };

      // Not local — try to download from Supabase Storage
      if (!book.cloudSynced) {
        throw new Error("EPUB not available — please upload this book again.");
      }

      const { url } = await api.getDownloadUrl(book.id);
      if (!url) throw new Error("Could not get download URL.");

      const booksDir = FileSystemLegacy.documentDirectory + "books/";
      const dirInfo = await FileSystemLegacy.getInfoAsync(booksDir);
      if (!dirInfo.exists) {
        await FileSystemLegacy.makeDirectoryAsync(booksDir, {
          intermediates: true,
        });
      }

      const destUri = booksDir + book.id + ".epub";
      const dl = await FileSystemLegacy.downloadAsync(url, destUri);
      if (dl.status !== 200)
        throw new Error(`Download failed: HTTP ${dl.status}`);

      // Mark as ready in AsyncStorage
      await updateBookMeta(book.id, { epubReady: true });

      // Refresh library so the card updates
      qc.invalidateQueries({ queryKey: bookKeys.library() });

      return { bookId: book.id, ready: true };
    },
    onError: (err) => {
      addToast(err.message || "Could not open book", "error");
    },
  });
}

// ── useProgress ───────────────────────────────────────────────────────────────
export function useProgress(bookId) {
  return useQuery({
    queryKey: bookKeys.progress(bookId),
    queryFn: () => api.getProgress(bookId),
    enabled: !!bookId,
    staleTime: 10_000,
    retry: false,
  });
}

// ── useHighlights ─────────────────────────────────────────────────────────────
export function useHighlights(bookId) {
  return useQuery({
    queryKey: bookKeys.highlights(bookId),
    queryFn: () => api.getHighlights(bookId),
    enabled: !!bookId,
    staleTime: 60_000,
  });
}

// ── useUploadBook ─────────────────────────────────────────────────────────────
export function useUploadBook() {
  const qc = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (asset) => {
      const id = await hashEpubFile(asset.uri);

      const existing = await getAllBooks();
      if (!existing.find((b) => b.id === id)) {
        // saveEpub now handles "destination already exists" gracefully
        await saveEpub(id, asset.uri);

        const meta = {
          id,
          title: (asset.name ?? "Unknown").replace(/\.epub$/i, "").replace(/_/g, " "),
          author: "Unknown Author",
          coverColor: randomCoverColor(),
          addedAt: new Date().toISOString(),
          epubReady: true,
        };
        await saveBook(meta);

        // Register in backend DB
        await api
          .registerBook(id, { title: meta.title, author: meta.author })
          .catch(() => {});

        // ── Phase D: Upload to Supabase Storage for cross-device sync ────────
        // Fire-and-forget — local save already succeeded, upload failure is
        // non-fatal. User gets the book locally, it'll appear on other devices
        // once they next open the app (cloud sync in useLibrary picks it up).
        try {
          const epubFile = new File(Paths.document, "books", `${id}.epub`);
          const formData = new FormData();
          formData.append("epub", {
            uri: epubFile.uri,
            type: asset.mimeType || "application/epub+zip",
            name: `${id}.epub`,
          });
          await api.uploadEpub(id, formData);
          console.log(`[Upload] Cloud upload complete for ${id}`);
        } catch (e) {
          console.warn(
            `[Upload] Cloud upload failed for ${id} (local save OK):`,
            e?.message,
          );
        }
      }
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: bookKeys.library() });
      addToast("Book added to your library", "success");
    },
    onError: (err) => {
      console.log("Upload error:", err?.message, err);
      addToast("Failed to add book — please try again", "error");
    },
  });
}

// ── useSaveProgress ───────────────────────────────────────────────────────────
export function useSaveProgress(bookId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.saveProgress(bookId, data),
    onSuccess: (saved) => {
      qc.setQueryData(bookKeys.progress(bookId), saved);
      const now = new Date().toISOString();
      
      qc.setQueryData(bookKeys.library(), (old) => {
        if (!old) return old;
        const updated = old.map((b) =>
          b.id === bookId
            ? {
                ...b,
                progress: parseFloat(saved.percentage ?? 0),
                cfi: saved.cfi ?? null,
                lastRead: saved.updated_at ?? saved.updatedAt ?? now,
                lastReadAt: now,
              }
            : b,
        );
        // INSTANT SORT: Prevents the UI from jumping when the backend syncs
        return updated.sort((a, b) => {
          const timeA = new Date(a.lastReadAt || a.lastRead || a.addedAt || 0).getTime();
          const timeB = new Date(b.lastReadAt || b.lastRead || b.addedAt || 0).getTime();
          return timeB - timeA;
        });
      });
    },
  });
}

// ── useAddHighlight ───────────────────────────────────────────────────────────
export function useAddHighlight(bookId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.saveHighlight(bookId, data),
    onMutate: async (newHL) => {
      await qc.cancelQueries({ queryKey: bookKeys.highlights(bookId) });
      const prev = qc.getQueryData(bookKeys.highlights(bookId));
      qc.setQueryData(bookKeys.highlights(bookId), (old) => [
        {
          id: `opt-${Date.now()}`,
          ...newHL,
          created_at: new Date().toISOString(),
        },
        ...(old ?? []),
      ]);
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(bookKeys.highlights(bookId), ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: bookKeys.highlights(bookId) }),
  });
}

// ── useDeleteHighlight ────────────────────────────────────────────────────────
export function useDeleteHighlight(bookId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteHighlight(bookId, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: bookKeys.highlights(bookId) });
      const prev = qc.getQueryData(bookKeys.highlights(bookId));
      qc.setQueryData(bookKeys.highlights(bookId), (old) => old?.filter((h) => h.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(bookKeys.highlights(bookId), ctx.prev),
  });
}