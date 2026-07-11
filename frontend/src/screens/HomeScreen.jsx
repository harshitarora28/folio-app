import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/clerk-expo";
import {
  useLibrary,
  useUploadBook,
  useOpenBook,
  bookKeys,
} from "../hooks/useBooks";
import {
  useShelves,
  useCreateShelf,
  useDeleteShelf,
  useAddBookToShelf,
  useRemoveBookFromShelf,
} from "../hooks/useShelves";

export default function HomeScreen() {
  const nav = useNavigation();
  const { user } = useUser(); // FIX: useUser() returns { user, isLoaded, isSignedIn } — must destructure

  const initial = (user?.firstName ?? "R").charAt(0).toUpperCase();

  const [shelfInput, setShelfInput] = useState({ open: false, name: "" });
  const [collapsedShelves, setCollapsed] = useState({});
  const [bookMenu, setBookMenu] = useState(null); // { book } | null
  const [shelfConfirm, setShelfConfirm] = useState(null); // { shelfId, shelfName } to confirm delete

  const qc = useQueryClient();
  const { data: books = [], isLoading: booksLoading } = useLibrary();
  const { data: shelves = [] } = useShelves();

  // ── BACKGROUND REFETCH ──
  // Instant, silent background refetch. The 800ms artificial delay has been completely removed.
  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: bookKeys.library() });
    }, [qc]),
  );

  const uploadBook = useUploadBook();
  const openBook = useOpenBook();
  const createShelf = useCreateShelf();
  const deleteShelf = useDeleteShelf();
  const addBookToShelf = useAddBookToShelf();
  const removeFromShelf = useRemoveBookFromShelf();

  // Most recently read book is the first book in the sorted list that has progress
  const continueBook = books.find((b) => (b.progress ?? 0) > 0) ?? null;

  // DEBUG: log library order every render so we can see what's happening
  console.log(
    "[HomeScreen] books count=",
    books.length,
    "order=",
    books
      .slice(0, 3)
      .map(
        (b) =>
          b.title?.slice(0, 15) +
          "|" +
          (b.lastReadAt || b.lastRead || b.addedAt || "none"),
      ),
    "continueBook=",
    continueBook?.title?.slice(0, 20) ?? "none",
  );

  const handlePickEpub = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/epub+zip",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      uploadBook.mutate(result.assets[0]);
    } catch {
      Alert.alert("Error", "Could not open file picker.");
    }
  };

  // Open a book — downloads EPUB first if not yet on device
  const handleOpenBook = (book) => {
    if (book.epubReady === false && book.cloudSynced) {
      // Cloud book not yet downloaded — fetch then open
      openBook.mutate(book, {
        onSuccess: ({ bookId }) => {
          const updated = books.find((b) => b.id === bookId) || book;
          nav.navigate("Reader", { book: { ...updated, epubReady: true } });
        },
      });
    } else {
      nav.navigate("Reader", { book });
    }
  };

  const handleCreateShelf = () => {
    if (!shelfInput.name.trim()) return;
    createShelf.mutate(shelfInput.name.trim(), {
      onSuccess: () => setShelfInput({ open: false, name: "" }),
    });
  };

  const toggleCollapse = (shelfId) =>
    setCollapsed((p) => ({ ...p, [shelfId]: !p[shelfId] }));

  const handleBookLongPress = (book) => setBookMenu({ book });

  const handleAddToShelf = (shelfId) => {
    if (!bookMenu) return;
    addBookToShelf.mutate({ shelfId, bookId: bookMenu.book.id });
    setBookMenu(null);
  };

  const handleRemoveFromShelf = (shelfId) => {
    if (!bookMenu) return;
    removeFromShelf.mutate({ shelfId, bookId: bookMenu.book.id });
    setBookMenu(null);
  };

  const handleDeleteShelf = (shelf) => {
    setShelfConfirm(shelf);
    setBookMenu(null);
  };

  const confirmDeleteShelf = () => {
    if (!shelfConfirm) return;
    deleteShelf.mutate(shelfConfirm.id);
    setShelfConfirm(null);
  };

  // Only show the full-screen loader if we have zero books AND we are loading
  // Prevents the screen from flashing to a loading spinner during background refetches
  if (booksLoading && books.length === 0) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#E8A838" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      {/* Top Bar */}
      <View style={s.topBar}>
        <Text style={s.logo}>Folio</Text>
        <TouchableOpacity
          onPress={() => nav.navigate("Profile")}
          style={s.avatarWrap}
        >
          <Text style={s.avatarText}>{initial}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Upload progress */}
        {uploadBook.isPending && (
          <View style={s.uploadToast}>
            <ActivityIndicator color="#E8A838" size="small" />
            <Text style={s.uploadText}>Processing EPUB…</Text>
          </View>
        )}

        {books.length === 0 ? (
          <EmptyState onAdd={handlePickEpub} />
        ) : (
          <>
            {/* Continue Reading */}
            {continueBook && (
              <View style={{ paddingTop: 28 }}>
                <View style={s.sectionHeader}>
                  <Text style={s.sectionTitle}>Continue Reading</Text>
                </View>
                <ContinueCard
                  book={continueBook}
                  onPress={() => handleOpenBook(continueBook)}
                  onLongPress={() => handleBookLongPress(continueBook)}
                />
              </View>
            )}

            {/* Library */}
            <View style={{ paddingTop: continueBook ? 20 : 28 }}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>My Library</Text>
                <Text style={s.sectionCount}>{books.length} books</Text>
              </View>
              <FlatList
                horizontal
                data={books}
                keyExtractor={(b) => b.id}
                renderItem={({ item }) => (
                  <BookCard
                    book={item}
                    onPress={() => handleOpenBook(item)}
                    onLongPress={() => handleBookLongPress(item)}
                    isDownloading={
                      openBook.isPending && openBook.variables?.id === item.id
                    }
                  />
                )}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 24 }}
              />
            </View>

            {/* Shelves */}
            {shelves.map((shelf) => {
              const shelfBooks = books.filter((b) =>
                shelf.bookIds?.includes(b.id),
              );
              const isCollapsed = collapsedShelves[shelf.id];
              return (
                <View key={shelf.id} style={{ paddingTop: 28 }}>
                  {/* Shelf header — tap to collapse, long press to delete */}
                  <TouchableOpacity
                    style={s.sectionHeader}
                    onPress={() => toggleCollapse(shelf.id)}
                    onLongPress={() => handleDeleteShelf(shelf)}
                    delayLongPress={500}
                    activeOpacity={0.7}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Text style={s.sectionTitle}>{shelf.name}</Text>
                      <Text style={s.collapseChevron}>
                        {isCollapsed ? "›" : "⌄"}
                      </Text>
                    </View>
                    <Text style={s.sectionCount}>
                      {shelfBooks.length}{" "}
                      {shelfBooks.length === 1 ? "book" : "books"}
                    </Text>
                  </TouchableOpacity>

                  {!isCollapsed &&
                    (shelfBooks.length === 0 ? (
                      <View style={s.emptyShelf}>
                        <Text style={s.emptyShelfText}>
                          No books yet — long press any book to add
                        </Text>
                      </View>
                    ) : (
                      <FlatList
                        horizontal
                        data={shelfBooks}
                        keyExtractor={(b) => b.id}
                        renderItem={({ item }) => (
                          <BookCard
                            book={item}
                            onPress={() => handleOpenBook(item)}
                            onLongPress={() => handleBookLongPress(item)}
                            isDownloading={
                              openBook.isPending &&
                              openBook.variables?.id === item.id
                            }
                          />
                        )}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ paddingHorizontal: 24 }}
                      />
                    ))}
                </View>
              );
            })}

            {/* New shelf */}
            {shelfInput.open ? (
              <View style={s.shelfInputRow}>
                <TextInput
                  style={s.shelfInput}
                  placeholder="Shelf name…"
                  placeholderTextColor="#8A8070"
                  value={shelfInput.name}
                  onChangeText={(v) =>
                    setShelfInput((p) => ({ ...p, name: v }))
                  }
                  onSubmitEditing={handleCreateShelf}
                  autoFocus
                />
                <TouchableOpacity
                  style={s.shelfCreateBtn}
                  onPress={handleCreateShelf}
                  disabled={createShelf.isPending}
                >
                  <Text style={s.shelfCreateBtnText}>
                    {createShelf.isPending ? "…" : "Create"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.shelfCancelBtn}
                  onPress={() => setShelfInput({ open: false, name: "" })}
                >
                  <Text style={{ color: "#8A8070" }}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={s.newShelfBtn}
                onPress={() => setShelfInput({ open: true, name: "" })}
              >
                <Text style={s.newShelfBtnText}>＋ New Shelf</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 96 }} />
          </>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={handlePickEpub}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      {/* ── Book long-press shelf menu ── */}
      <Modal
        visible={!!bookMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setBookMenu(null)}
      >
        <View style={s.modalWrap}>
          <TouchableOpacity
            style={s.modalOverlay}
            onPress={() => setBookMenu(null)}
          />
          <View style={s.menuSheet}>
            <View style={s.menuHandle} />
            <Text style={s.menuTitle} numberOfLines={1}>
              {bookMenu?.book?.title}
            </Text>

            {shelves.length === 0 ? (
              <Text style={s.menuEmpty}>No shelves yet — create one below</Text>
            ) : (
              shelves.map((shelf) => {
                const isOn = shelf.bookIds?.includes(bookMenu?.book?.id);
                return (
                  <TouchableOpacity
                    key={shelf.id}
                    style={s.menuRow}
                    onPress={() =>
                      isOn
                        ? handleRemoveFromShelf(shelf.id)
                        : handleAddToShelf(shelf.id)
                    }
                  >
                    <Text style={[s.menuRowText, isOn && s.menuRowTextActive]}>
                      {shelf.name}
                    </Text>
                    <Text
                      style={[s.menuRowCheck, isOn && s.menuRowCheckActive]}
                    >
                      {isOn ? "✓" : "＋"}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity
              style={s.menuClose}
              onPress={() => setBookMenu(null)}
            >
              <Text style={s.menuCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Delete shelf confirm ── */}
      <Modal
        visible={!!shelfConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShelfConfirm(null)}
      >
        <View style={s.confirmOverlay}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>Delete shelf?</Text>
            <Text style={s.confirmBody}>
              "{shelfConfirm?.name}" will be deleted. Books are not affected.
            </Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity
                style={s.confirmCancel}
                onPress={() => setShelfConfirm(null)}
              >
                <Text style={s.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.confirmDelete}
                onPress={confirmDeleteShelf}
              >
                <Text style={s.confirmDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── BookCard ──────────────────────────────────────────────────────────────────
function BookCard({ book, onPress, onLongPress, isDownloading }) {
  const notReady = book.epubReady === false && book.cloudSynced;
  return (
    <TouchableOpacity
      style={s.bookCard}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.8}
    >
      <View
        style={[s.bookCover, { backgroundColor: book.coverColor ?? "#2D3561" }]}
      >
        {book.coverUri ? (
          <Image
            source={{ uri: book.coverUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => {}}
          />
        ) : (
          <View
            style={{ alignItems: "center", justifyContent: "center", flex: 1 }}
          >
            <Text style={{ fontSize: 24 }}>📖</Text>
          </View>
        )}

        {/* Downloading overlay */}
        {isDownloading && (
          <View style={s.downloadOverlay}>
            <ActivityIndicator color="#E8A838" size="small" />
            <Text style={s.downloadOverlayText}>Downloading…</Text>
          </View>
        )}

        {/* Cloud badge — shown when EPUB not yet on device */}
        {!isDownloading && notReady && (
          <View style={s.cloudBadge}>
            <Text style={s.cloudBadgeText}>☁</Text>
          </View>
        )}

        {/* Progress bar at bottom of cover */}
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${book.progress ?? 0}%` }]} />
        </View>
      </View>
      <Text style={s.bookTitle} numberOfLines={2}>
        {book.title}
      </Text>
      <Text style={s.bookAuthor} numberOfLines={1}>
        {book.author}
      </Text>
    </TouchableOpacity>
  );
}

// ── ContinueCard ──────────────────────────────────────────────────────────────
function ContinueCard({ book, onPress, onLongPress }) {
  const pct = Math.round(book.progress ?? 0);
  return (
    <TouchableOpacity
      style={s.continueCard}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.88}
    >
      {/* Cover — larger, with shadow */}
      <View
        style={[
          s.continueCover,
          { backgroundColor: book.coverColor ?? "#2D3561" },
        ]}
      >
        {book.coverUri ? (
          <Image
            source={{ uri: book.coverUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{ alignItems: "center", justifyContent: "center", flex: 1 }}
          >
            <Text style={{ fontSize: 28 }}>📖</Text>
          </View>
        )}
        {/* Progress strip on cover bottom */}
        <View style={s.continueProgressStrip}>
          <View style={[s.continueProgressStripFill, { width: `${pct}%` }]} />
        </View>
      </View>

      {/* Info */}
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
        <Text style={s.continueLabel}>CONTINUE READING</Text>
        <Text style={s.continueTitle} numberOfLines={2}>
          {book.title}
        </Text>
        <Text style={s.continueAuthor} numberOfLines={1}>
          {book.author ?? "Unknown"}
        </Text>
        <View style={s.continueProgressRow}>
          <View style={s.continueProgressBg}>
            <View style={[s.continueProgressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={s.continuePct}>{pct}%</Text>
        </View>
      </View>

      {/* Arrow */}
      <Text style={s.continueArrow}>›</Text>
    </TouchableOpacity>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────
function EmptyState({ onAdd }) {
  return (
    <View style={s.emptyWrap}>
      <Text style={{ fontSize: 64 }}>📚</Text>
      <Text style={s.emptyTitle}>Your library is empty</Text>
      <Text style={s.emptySubtitle}>
        Add your first EPUB book to get started
      </Text>
      <TouchableOpacity style={s.emptyBtn} onPress={onAdd}>
        <Text style={s.emptyBtnText}>+ Add a Book</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F0E0C" },
  center: {
    flex: 1,
    backgroundColor: "#0F0E0C",
    alignItems: "center",
    justifyContent: "center",
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#2E2C28",
  },
  logo: {
    color: "#E8A838",
    fontSize: 26,
    fontFamily: "Georgia",
    letterSpacing: 1,
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(232,168,56,0.14)",
    borderWidth: 1,
    borderColor: "#E8A838",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#E8A838", fontWeight: "700", fontSize: 14 },

  uploadToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 24,
    marginTop: 14,
    backgroundColor: "#1A1916",
    borderWidth: 1,
    borderColor: "#2E2C28",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  uploadText: { color: "#C8BFB0", fontSize: 14 },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  sectionTitle: { color: "#F0EBE1", fontSize: 20, fontFamily: "Georgia" },
  sectionCount: { color: "#8A8070", fontSize: 13 },
  collapseChevron: { color: "#8A8070", fontSize: 18, marginTop: 2 },

  downloadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,14,12,0.75)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 8,
  },
  downloadOverlayText: {
    color: "#E8A838",
    fontSize: 10,
    fontWeight: "600",
  },
  cloudBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(15,14,12,0.7)",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  cloudBadgeText: {
    color: "#8A8070",
    fontSize: 11,
  },

  emptyShelf: {
    marginHorizontal: 24,
    borderWidth: 1,
    borderColor: "#2E2C28",
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: "center",
  },
  emptyShelfText: { color: "#8A8070", fontSize: 13 },

  shelfInputRow: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 24,
    marginTop: 28,
  },
  shelfInput: {
    flex: 1,
    backgroundColor: "#242220",
    borderWidth: 1,
    borderColor: "#2E2C28",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: "#F0EBE1",
    fontSize: 14,
  },
  shelfCreateBtn: {
    backgroundColor: "#E8A838",
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  shelfCreateBtnText: { color: "#0F0E0C", fontWeight: "700", fontSize: 14 },
  shelfCancelBtn: {
    backgroundColor: "#242220",
    borderWidth: 1,
    borderColor: "#2E2C28",
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  newShelfBtn: {
    marginHorizontal: 24,
    marginTop: 28,
    borderWidth: 1,
    borderColor: "#2E2C28",
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  newShelfBtnText: { color: "#8A8070", fontSize: 14 },

  fab: {
    position: "absolute",
    bottom: 28,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#E8A838",
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#E8A838",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  fabText: {
    color: "#0F0E0C",
    fontSize: 28,
    fontWeight: "300",
    lineHeight: 32,
  },

  // BookCard
  bookCard: { width: 112, marginRight: 12 },
  bookCover: {
    width: 112,
    height: 160,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  progressBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  progressFill: { height: 3, backgroundColor: "#E8A838" },
  bookTitle: { color: "#F0EBE1", fontSize: 12, marginTop: 6, lineHeight: 16 },
  bookAuthor: { color: "#8A8070", fontSize: 11, marginTop: 2 },

  // ContinueCard
  continueCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 24, // ALIGNED WITH SECTION HEADER PADDING
    marginBottom: 8,
    backgroundColor: "#161412",
    borderWidth: 1,
    borderColor: "#2E2C28",
    borderRadius: 18,
    padding: 14,
    gap: 14,
    // shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  continueCover: {
    width: 80,
    height: 112,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
    // shadow on cover
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  continueProgressStrip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  continueProgressStripFill: {
    height: 3,
    backgroundColor: "#E8A838",
  },
  continueLabel: {
    color: "#E8A838",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  continueTitle: {
    color: "#F0EBE1",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
    marginBottom: 3,
    fontFamily: "Georgia",
  },
  continueAuthor: {
    color: "#8A8070",
    fontSize: 12,
    marginBottom: 12,
  },
  continueProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  continueProgressBg: {
    flex: 1,
    height: 3,
    backgroundColor: "#2E2C28",
    borderRadius: 2,
  },
  continueProgressFill: {
    height: 3,
    backgroundColor: "#E8A838",
    borderRadius: 2,
  },
  continuePct: {
    color: "#E8A838",
    fontSize: 12,
    fontWeight: "600",
    minWidth: 32,
    textAlign: "right",
  },
  continueArrow: {
    color: "#3E3C38",
    fontSize: 26,
    paddingLeft: 4,
  },

  // EmptyState
  emptyWrap: { alignItems: "center", paddingHorizontal: 40, paddingTop: 120 },
  emptyTitle: {
    color: "#F0EBE1",
    fontSize: 22,
    fontFamily: "Georgia",
    marginTop: 24,
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    color: "#8A8070",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 32,
  },
  emptyBtn: {
    backgroundColor: "#E8A838",
    borderRadius: 999,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  emptyBtnText: { color: "#0F0E0C", fontWeight: "700", fontSize: 14 },

  // Book menu modal
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  menuSheet: {
    backgroundColor: "#1A1916",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: "#2E2C28",
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  menuHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#2E2C28",
    borderRadius: 2,
    alignSelf: "center",
    marginVertical: 14,
  },
  menuTitle: {
    color: "#F0EBE1",
    fontSize: 16,
    fontFamily: "Georgia",
    marginBottom: 16,
  },
  menuEmpty: { color: "#8A8070", fontSize: 14, marginBottom: 16 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2E2C28",
  },
  menuRowText: { color: "#C8BFB0", fontSize: 15 },
  menuRowTextActive: { color: "#E8A838" },
  menuRowCheck: { color: "#2E2C28", fontSize: 18 },
  menuRowCheckActive: { color: "#E8A838", fontWeight: "700" },
  menuClose: {
    marginTop: 14,
    backgroundColor: "#242220",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  menuCloseText: { color: "#8A8070", fontSize: 14, fontWeight: "600" },

  // Delete confirm
  confirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBox: {
    backgroundColor: "#1A1916",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2E2C28",
    padding: 24,
    marginHorizontal: 32,
    width: "80%",
  },
  confirmTitle: {
    color: "#F0EBE1",
    fontSize: 18,
    fontFamily: "Georgia",
    marginBottom: 10,
  },
  confirmBody: {
    color: "#8A8070",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  confirmBtns: { flexDirection: "row", gap: 12 },
  confirmCancel: {
    flex: 1,
    backgroundColor: "#242220",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  confirmCancelText: { color: "#C8BFB0", fontWeight: "600" },
  confirmDelete: {
    flex: 1,
    backgroundColor: "rgba(232,88,88,0.15)",
    borderWidth: 1,
    borderColor: "rgba(232,88,88,0.4)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  confirmDeleteText: { color: "#E85858", fontWeight: "700" },
});