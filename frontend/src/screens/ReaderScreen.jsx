import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  TextInput,
  StyleSheet,
  BackHandler,
  Animated,
  useWindowDimensions,
} from "react-native";
import Slider from "@react-native-community/slider";
import { WebView } from "react-native-webview";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReaderStore } from "../stores/readerStore";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSaveProgress,
  useAddHighlight,
  useDeleteHighlight,
  useHighlights,
  bookKeys,
} from "../hooks/useBooks";
import { useAIQuery, useImagine } from "../hooks/useAI";
import {
  readEpubBase64,
  saveCoverFromDataUrl,
  updateBookMeta,
  getBookLocations,
  saveBookLocations,
} from "../utils/bookStore";
import { buildReaderHtml } from "../utils/epubReaderHtml";

const THEMES = {
  dark: { bg: "#0F0E0C", text: "#F0EBE1" },
  light: { bg: "#F8F4ED", text: "#1A1410" },
  sepia: { bg: "#F5EBCF", text: "#2C1810" },
};

const READER_HTML = buildReaderHtml();

export default function ReaderScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { book } = route.params;
  const webSource = useMemo(() => ({ html: READER_HTML }), []);
  const hasRestoredOnce = useRef(false);

  const webRef = useRef(null);
  const saveTimer = useRef(null);
  const isDragging = useRef(false);
  const webviewReady = useRef(false);
  const readerInited = useRef(false);

  // ── Store ─────────────────────────────────────────────────────────────────
  const theme = useReaderStore((s) => s.theme);
  const fontSize = useReaderStore((s) => s.fontSize);
  const showControls = useReaderStore((s) => s.showControls);
  const progress = useReaderStore((s) => s.progress);
  const chapterTitle = useReaderStore((s) => s.chapterTitle);
  const selection = useReaderStore((s) => s.selection);
  const setBook = useReaderStore((s) => s.setBook);
  const setPosition = useReaderStore((s) => s.setPosition);
  const setChapter = useReaderStore((s) => s.setChapter);
  const setTheme = useReaderStore((s) => s.setTheme);
  const setFontSize = useReaderStore((s) => s.setFontSize);
  const setSelection = useReaderStore((s) => s.setSelection);
  const clearSelection = useReaderStore((s) => s.clearSelection);
  const leaveReader = useReaderStore((s) => s.leaveReader);

  // ── Local state ───────────────────────────────────────────────────────────
  const [epubBase64, setEpubBase64] = useState(null);
  const [cachedLocations, setCachedLocations] = useState(null);
  const [loadingEpub, setLoadingEpub] = useState(true);
  const [sliderValue, setSliderValue] = useState(0);
  const [locationsReady, setLocationsReady] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiAction, setAiAction] = useState("explain");
  const [imagineOpen, setImagineOpen] = useState(false);
  const [selIsHL, setSelIsHL] = useState(false);
  const [imageFullscreen, setImageFullscreen] = useState(false);
  // TOC
  const [toc, setToc] = useState([]);
  const [tocOpen, setTocOpen] = useState(false);
  // ── Search ──────────────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchIdx, setSearchIdx] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef(null);

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const saveProgress = useSaveProgress(book.id);
  const qc = useQueryClient();
  const addHighlight = useAddHighlight(book.id);
  const deleteHL = useDeleteHighlight(book.id);
  const { data: highlights = [] } = useHighlights(book.id);
  const aiQuery = useAIQuery();
  const imagine = useImagine();

  // ── UI Animation (Precise Crop & Shift Effect) ────────────────────────────
  const { height: screenH } = useWindowDimensions();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const transYAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let targetScale = 1;
    let targetTransY = 0;

    // Approximate component heights accounting for safe area notches
    const safeTop = insets.top || 40;
    const safeBot = insets.bottom || 20;
    const topBarHeight = safeTop + 60;
    const botBarHeight = safeBot + 90;

    // Search is taller when results populate the navigation extension
    const hasResults = searchResults.length > 0;
    const searchHeight = safeTop + 60 + (hasResults ? 50 : 0);

    if (searchOpen) {
      // CASE 2: Search active (No bottom bar, taller top bar)
      targetScale = (screenH - searchHeight) / screenH;
      targetTransY = searchHeight / 2; // Shift exactly halfway down the new empty space
    } else if (showControls) {
      // CASE 1: Controls active (Top and Bottom bars)
      targetScale = (screenH - topBarHeight - botBarHeight) / screenH;
      targetTransY = (topBarHeight - botBarHeight) / 2; // Shift to balance unequal top/bottom heights
    }

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: targetScale,
        friction: 11, // Slightly higher friction to prevent bouncy "sliding" overshoots
        tension: 50,
        useNativeDriver: true,
      }),
      Animated.spring(transYAnim, {
        toValue: targetTransY,
        friction: 11,
        tension: 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, [showControls, searchOpen, searchResults.length, screenH, insets]);

  // ── Load EPUB ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setBook(book);
    setLocationsReady(false);
    webviewReady.current = false;
    readerInited.current = false;

    Promise.all([readEpubBase64(book.id), getBookLocations(book.id)])
      .then(([b64, locs]) => {
        setCachedLocations(locs || "");
        setEpubBase64(b64);
      })
      .catch(() => Alert.alert("Error", "Could not load this EPUB file."))
      .finally(() => setLoadingEpub(false));

    return () => {
      clearTimeout(saveTimer.current);
      const state = useReaderStore.getState();
      if (state.currentCfi) {
        saveProgress.mutate({
          cfi: state.currentCfi,
          percentage: state.progress,
        });
      }
      leaveReader();
    };
  }, [book.id]);

  // Intercept Android hardware back button — same as tapping the top bar back
  const handleBack = useCallback(() => {
    const state = useReaderStore.getState();
    const now = new Date().toISOString();

    if (state.currentCfi) {
      // ── ZERO-LAG OPTIMISTIC UPDATE ──
      // This synchronously forces the library into the correct "last read" order
      // the exact millisecond you press the back button.
      qc.setQueryData(bookKeys.library(), (old) => {
        if (!old) return old;
        const updated = old.map((b) =>
          b.id === book.id
            ? {
                ...b,
                lastReadAt: now,
                lastRead: now,
                progress: state.progress,
                cfi: state.currentCfi,
              }
            : b,
        );
        return updated.sort((a, b) => {
          const timeA = new Date(
            a.lastReadAt || a.lastRead || a.addedAt || 0,
          ).getTime();
          const timeB = new Date(
            b.lastReadAt || b.lastRead || b.addedAt || 0,
          ).getTime();
          return timeB - timeA;
        });
      });

      saveProgress.mutate({
        cfi: state.currentCfi,
        percentage: state.progress,
      });
    }

    nav.goBack();
  }, [book.id, qc, saveProgress, nav]);

  const handleBackRef = useRef(handleBack);
  useEffect(() => {
    handleBackRef.current = handleBack;
  }, [handleBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, []); // stays empty — uses ref which is always current

  useEffect(() => {
    if (!isDragging.current) setSliderValue(progress);
  }, [progress]);

  useEffect(() => {
    if (locationsReady && highlights.length > 0) {
      const cfis = JSON.stringify(highlights.map((h) => h.cfi));
      injectJS(`window.epubRestoreHighlights('${cfis.replace(/'/g, "\\'")}')`);
    }
  }, [locationsReady, highlights.length]);

  // ── WebView helpers ───────────────────────────────────────────────────────
  const injectJS = (code) => {
    webRef.current?.injectJavaScript(`(function(){ ${code} })(); true;`);
  };

  const tryInit = (b64, locs) => {
    if (
      !b64 ||
      typeof locs !== "string" ||
      !webviewReady.current ||
      readerInited.current
    )
      return;
    readerInited.current = true;
    const state = useReaderStore.getState();
    const savedCfi = (book.cfi || "")
      .replace(/`/g, "\\`")
      .replace(/\\/g, "\\\\");
    const escaped = b64.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
    const safeLocs = locs.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
    const topInset = insets.top || 0;
    injectJS(
      `window.initReader(\`${escaped}\`, \`${savedCfi}\`, '${state.theme}', ${state.fontSize}, ${topInset}, '${book.id}', \`${safeLocs}\`)`,
    );
  };

  const handleLoadEnd = () => {
    webviewReady.current = true;
    tryInit(epubBase64, cachedLocations);
  };

  useEffect(() => {
    if (epubBase64 && typeof cachedLocations === "string") {
      tryInit(epubBase64, cachedLocations);
    }
  }, [epubBase64, cachedLocations]);

  // ── Messages from WebView ─────────────────────────────────────────────────
  const handleMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      switch (msg.type) {
        case "progress": {
          setPosition(msg.cfi, msg.percentage);
          if (!isDragging.current) setSliderValue(msg.percentage);
          if (!hasRestoredOnce.current) break;
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            saveProgress.mutate({ cfi: msg.cfi, percentage: msg.percentage });
          }, 5000);
          break;
        }
        case "chapter":
          setChapter(msg.title);
          break;
        case "selection":
          setSelection(msg.text, msg.cfi);
          setSelIsHL(!!msg.isHighlighted);
          setAiPanelOpen(true);
          aiQuery.reset();
          break;
        case "tap":
          useReaderStore.getState().toggleControls();
          break;
        case "locations_ready":
          setLocationsReady(true);
          hasRestoredOnce.current = true;
          break;
        case "locations_generated":
          saveBookLocations(book.id, msg.data).catch(() => {});
          setLocationsReady(true);
          hasRestoredOnce.current = true;
          break;
        case "searchStart":
          setSearchLoading(true);
          setSearchResults([]);
          break;
        case "searchResults":
          setSearchLoading(false);
          setSearchResults(msg.results || []);
          setSearchIdx(0);
          if (msg.results && msg.results.length > 0) {
            injectJS(
              `window.goToSearchResult(${JSON.stringify(msg.results[0].cfi)})`,
            );
          }
          break;
        case "cover":
          saveCoverFromDataUrl(book.id, msg.dataUrl)
            .then((localUri) => {
              if (localUri) {
                // Update library cache immediately so cover shows on HomeScreen
                qc.setQueryData(bookKeys.library(), (old) =>
                  old?.map((b) =>
                    b.id === book.id ? { ...b, coverUri: localUri } : b,
                  ),
                );
              }
            })
            .catch(() => {});
          break;
        case "toc":
          if (msg.toc && msg.toc.length > 0) setToc(msg.toc);
          break;
        case "debug":
          //console.log("[EPUB_DEBUG]", msg.msg);
          break;
        case "metadata": {
          const updates = {};
          if (msg.title && msg.title !== "Unknown") updates.title = msg.title;
          if (msg.author && msg.author !== "Unknown Author")
            updates.author = msg.author;
          if (Object.keys(updates).length > 0) {
            updateBookMeta(book.id, updates).catch(() => {});

            // Immediately update the library cache so HomeScreen
            // shows correct title/author without requiring app restart
            qc.setQueryData(bookKeys.library(), (old) =>
              old?.map((b) => (b.id === book.id ? { ...b, ...updates } : b)),
            );

            import("../services/api").then((api) =>
              api
                .registerBook(book.id, {
                  title: updates.title || book.title,
                  author: updates.author || book.author,
                })
                .catch(() => {}),
            );
          }
          break;
        }
      }
    } catch {}
  };

  // ── Controls ──────────────────────────────────────────────────────────────
  const applyTheme = (t) => {
    setTheme(t);
    injectJS(`window.epubTheme('${t}')`);
  };

  const applyFontSize = (delta) => {
    const current = useReaderStore.getState().fontSize;
    const next = Math.min(28, Math.max(12, current + delta));
    setFontSize(next);
    injectJS(`window.epubFont(${next})`);
  };

  const handleHighlightToggle = () => {
    if (!selection.cfi) return;
    if (selIsHL) {
      injectJS(`window.epubRemoveHighlight('${selection.cfi}')`);
      const existing = highlights.find((h) => h.cfi === selection.cfi);
      if (existing) deleteHL.mutate(existing.id);
      setSelIsHL(false);
    } else {
      injectJS(`window.epubHighlight('${selection.cfi}')`);
      addHighlight.mutate({
        cfi: selection.cfi,
        text: selection.text,
        color: "#E8A83855",
      });
      setSelIsHL(true);
    }
    setAiPanelOpen(false);
    clearSelection();
  };

  const handleSliderStart = () => {
    isDragging.current = true;
  };
  const handleSliderChange = (val) => setSliderValue(Math.round(val));
  const handleSliderEnd = (val) => {
    isDragging.current = false;
    const pct = Math.round(val);
    setSliderValue(pct);
    injectJS(`window.epubSeek(${pct})`);
  };

  const handleAskAI = () => {
    aiQuery.mutate({
      text: selection.text,
      bookId: book.id,
      cfi: selection.cfi,
      action: aiAction,
      progress: useReaderStore.getState().progress,
    });
  };

  const handleImagine = () => {
    setAiPanelOpen(false);
    setImagineOpen(true);
    imagine.mutate({
      text: selection.text,
      bookId: book.id,
      progress: useReaderStore.getState().progress,
    });
  };

  const navigateToChapter = (href) => {
    injectJS(`window.epubDisplay('${href.replace(/'/g, "\\'")}')`);
    setTocOpen(false);
  };

  const bgColor = THEMES[theme]?.bg ?? "#0F0E0C";

  if (loadingEpub) {
    return (
      <View style={[s.fill, s.center, { backgroundColor: bgColor }]}>
        <ActivityIndicator color="#E8A838" size="large" />
        <Text style={s.loadingText}>Loading book…</Text>
      </View>
    );
  }

  const openSearch = () => {
    setSearchOpen(true);
    setSearchResults([]);
    setSearchQuery("");
    setTimeout(() => searchInputRef.current?.focus(), 150);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchResults([]);
    setSearchQuery("");
    injectJS("window.clearSearchHighlight()");
  };

  const runSearch = () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    injectJS(`window.searchBook(${JSON.stringify(searchQuery.trim())})`);
  };

  const goToResult = (idx) => {
    if (!searchResults[idx]) return;
    setSearchIdx(idx);
    injectJS(
      `window.goToSearchResult(${JSON.stringify(searchResults[idx].cfi)})`,
    );
  };

  return (
    <View style={[s.fill, { backgroundColor: bgColor }]}>
      {/* ── Animated Page Wrapper ── */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: bgColor,
            transform: [{ translateY: transYAnim }, { scale: scaleAnim }],
            borderRadius: showControls || searchOpen ? 16 : 0,
            overflow: "hidden",
          },
        ]}
      >
        {/* WebView */}
        <WebView
          key={book.id}
          ref={webRef}
          source={webSource}
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          javaScriptEnabled
          allowFileAccess
          allowUniversalAccessFromFileURLs
          originWhitelist={["*"]}
          scrollEnabled={false}
          cacheEnabled={false}
          cacheMode="LOAD_NO_CACHE"
          style={[StyleSheet.absoluteFill, { backgroundColor: bgColor }]}
        />
      </Animated.View>
      {/* Top bar */}
      {showControls && !searchOpen && (
        <View style={s.topBar}>
          <TouchableOpacity
            onPress={handleBack}
            style={s.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.backArrow}>←</Text>
          </TouchableOpacity>

          <View style={s.titleArea} pointerEvents="none">
            <Text style={s.bookTitle} numberOfLines={1}>
              {book.title}
            </Text>
            {chapterTitle ? (
              <Text style={s.chapterTitleTx} numberOfLines={1}>
                {chapterTitle}
              </Text>
            ) : null}
          </View>

          <View style={s.topActions}>
            <TouchableOpacity
              style={s.chatPill}
              onPress={() => nav.navigate("Chat", { book })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.chatPillText}>💬 Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.chatPill}
              onPress={openSearch}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={s.chatPillText}>🔍</Text>
            </TouchableOpacity>

            {toc.length > 0 && (
              <TouchableOpacity
                onPress={() => setTocOpen(true)}
                style={s.tocBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.tocBtnText}>≡</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Bottom bar */}
      {showControls && !searchOpen && (
        <View style={s.bottomBar} pointerEvents="box-none">
          <View style={s.sliderRow} pointerEvents="auto">
            <Text style={s.sliderPct}>{sliderValue}%</Text>
            <Slider
              style={s.slider}
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={sliderValue}
              minimumTrackTintColor={locationsReady ? "#E8A838" : "#2E2C28"}
              maximumTrackTintColor="#2E2C28"
              thumbTintColor={locationsReady ? "#E8A838" : "#4A4840"}
              disabled={!locationsReady}
              onSlidingStart={handleSliderStart}
              onValueChange={handleSliderChange}
              onSlidingComplete={handleSliderEnd}
            />
            {!locationsReady && (
              <ActivityIndicator
                size="small"
                color="#4A4840"
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
          <View style={s.toolRow} pointerEvents="auto">
            <View style={s.themeGroup}>
              {Object.keys(THEMES).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    s.themeBtn,
                    { backgroundColor: THEMES[t].bg },
                    theme === t && s.themeBtnActive,
                  ]}
                  onPress={() => applyTheme(t)}
                >
                  <Text
                    style={{
                      color: THEMES[t].text,
                      fontSize: 10,
                      fontWeight: "600",
                    }}
                  >
                    Aa
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.fontGroup}>
              <TouchableOpacity
                style={s.fontBtn}
                onPress={() => applyFontSize(-1)}
              >
                <Text style={s.fontBtnText}>A−</Text>
              </TouchableOpacity>
              <Text style={s.fontSizeNum}>{fontSize}</Text>
              <TouchableOpacity
                style={s.fontBtn}
                onPress={() => applyFontSize(+1)}
              >
                <Text style={s.fontBtnText}>A+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* ── TOC Modal ── */}
      <Modal
        visible={tocOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTocOpen(false)}
      >
        <View style={s.modalWrap}>
          <TouchableOpacity
            style={s.overlay}
            onPress={() => setTocOpen(false)}
          />
          <View style={[s.sheet, { maxHeight: "75%", paddingHorizontal: 0 }]}>
            <View style={s.sheetHandle} />
            <View style={s.tocHeader}>
              <Text style={s.sheetTitle}>Chapters</Text>
              <TouchableOpacity
                onPress={() => setTocOpen(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.tocCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {toc.map((item, i) => (
                <View key={i}>
                  <TouchableOpacity
                    onPress={() => navigateToChapter(item.href)}
                    style={s.tocItem}
                  >
                    <Text style={s.tocItemText} numberOfLines={2}>
                      {item.label}
                    </Text>
                    <Text style={s.tocArrow}>›</Text>
                  </TouchableOpacity>
                  {item.subitems?.map((sub, j) => (
                    <TouchableOpacity
                      key={j}
                      onPress={() => navigateToChapter(sub.href)}
                      style={s.tocSubItem}
                    >
                      <Text style={s.tocSubItemText} numberOfLines={2}>
                        {sub.label}
                      </Text>
                      <Text style={s.tocArrow}>›</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── AI Panel ── */}
      <Modal
        visible={aiPanelOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAiPanelOpen(false)}
      >
        <View style={s.modalWrap}>
          <TouchableOpacity
            style={s.overlay}
            onPress={() => {
              setAiPanelOpen(false);
              aiQuery.reset();
            }}
          />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Selected Text</Text>
            <View style={s.quoteBox}>
              <Text style={s.quoteText} numberOfLines={4}>
                "{selection.text.slice(0, 300)}
                {selection.text.length > 300 ? "…" : ""}"
              </Text>
            </View>
            <View style={s.tabRow}>
              {["explain", "summarize", "define"].map((a) => (
                <TouchableOpacity
                  key={a}
                  style={[s.tab, aiAction === a && s.tabActive]}
                  onPress={() => {
                    setAiAction(a);
                    aiQuery.reset();
                  }}
                >
                  <Text style={[s.tabText, aiAction === a && s.tabTextActive]}>
                    {a}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {aiQuery.isPending && (
              <View style={s.aiLoadRow}>
                <ActivityIndicator color="#E8A838" size="small" />
                <Text style={s.aiLoadText}>Thinking…</Text>
              </View>
            )}
            {aiQuery.data?.response && !aiQuery.isPending && (
              <ScrollView
                style={s.aiResponse}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <Text style={s.aiResponseText}>
                  {(aiQuery.data.response || "")
                    .replace(/\*\*(.+?)\*\*/g, "$1")
                    .replace(/\*(.+?)\*/g, "$1")
                    .replace(/^#+\s+/gm, "")
                    .trim()}
                </Text>
              </ScrollView>
            )}
            <View style={s.actionRow}>
              <TouchableOpacity
                style={[s.actionBtn, selIsHL && s.actionBtnActive]}
                onPress={handleHighlightToggle}
              >
                <Text
                  style={[s.actionBtnText, selIsHL && s.actionBtnTextActive]}
                >
                  {selIsHL ? "✕ Remove" : "🖊 Highlight"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.askBtn, aiQuery.isPending && { opacity: 0.5 }]}
                onPress={handleAskAI}
                disabled={aiQuery.isPending}
              >
                <Text style={s.askBtnText}>
                  {aiQuery.isPending ? "…" : "Ask AI"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.imagineBtn} onPress={handleImagine}>
                <Text style={s.imagineBtnText}>🎨 Imagine</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.chatBtn}
                onPress={() => {
                  setAiPanelOpen(false);
                  nav.navigate("Chat", {
                    book,
                    prefill: selection.text.slice(0, 200),
                  });
                }}
              >
                <Text style={s.chatBtnText}>💬 Chat</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.closeBtn}
                onPress={() => {
                  setAiPanelOpen(false);
                  aiQuery.reset();
                }}
              >
                <Text style={s.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Imagine Modal ── */}
      <Modal
        visible={imagineOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setImagineOpen(false);
          imagine.reset();
        }}
      >
        <View style={s.modalWrap}>
          <TouchableOpacity
            style={s.overlay}
            onPress={() => {
              setImagineOpen(false);
              imagine.reset();
            }}
          />
          <View style={[s.sheet, { maxHeight: "88%" }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>🎨 Scene Visualization</Text>
            <View style={s.quoteBox}>
              <Text style={s.quoteText} numberOfLines={3}>
                "{selection.text.slice(0, 200)}
                {selection.text.length > 200 ? "…" : ""}"
              </Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {imagine.isPending && (
                <View
                  style={[
                    s.aiLoadRow,
                    { paddingVertical: 40, justifyContent: "center" },
                  ]}
                >
                  <ActivityIndicator color="#E8A838" size="large" />
                  <Text style={s.aiLoadText}>Generating scene…</Text>
                </View>
              )}
              {imagine.isError && (
                <Text style={s.errorText}>
                  Generation failed — please try again.
                </Text>
              )}
              {imagine.data && !imagine.isPending && (
                <>
                  {imagine.data.imageUrl ? (
                    <TouchableOpacity
                      activeOpacity={0.92}
                      onPress={() => setImageFullscreen(true)}
                      style={s.imagineImgWrapper}
                    >
                      <Image
                        source={{ uri: imagine.data.imageUrl }}
                        style={s.imagineImg}
                        resizeMode="cover"
                      />
                      <View style={s.imagineExpandHint}>
                        <Text style={s.imagineExpandHintText}>
                          ⤢ Tap to expand
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ) : (
                    <View style={s.imagineUnavailable}>
                      <Text style={{ fontSize: 40, marginBottom: 8 }}>🖼️</Text>
                      <Text style={{ color: "#8A8070", fontSize: 12 }}>
                        Image unavailable
                      </Text>
                    </View>
                  )}
                  {imagine.data.description && (
                    <View style={s.quoteBox}>
                      <Text style={s.imagineDescLabel}>Scene description</Text>
                      <Text style={s.imagineDescText}>
                        {imagine.data.description}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => {
                setImagineOpen(false);
                imagine.reset();
              }}
            >
              <Text style={s.primaryBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Image Fullscreen Lightbox ── */}
      <Modal
        visible={imageFullscreen}
        transparent
        animationType="fade"
        onRequestClose={() => setImageFullscreen(false)}
        statusBarTranslucent
      >
        <View style={s.lightboxWrap}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setImageFullscreen(false)}
          />
          <Image
            source={{ uri: imagine.data?.imageUrl }}
            style={s.lightboxImg}
            resizeMode="contain"
          />
          <TouchableOpacity
            style={s.lightboxClose}
            onPress={() => setImageFullscreen(false)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={s.lightboxCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
      </Modal>
      {/* ── Search overlay — direct child of root View, (Direct replacement for TopBar)── */}
      {searchOpen && (
        <View
          style={[s.searchOverlay, { paddingTop: (insets.top || 40) + 10 }]}
        >
          <View style={s.searchBar}>
            <TextInput
              ref={searchInputRef}
              style={s.searchInput}
              placeholder="Search in book…"
              placeholderTextColor="#8A8070"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={runSearch}
              returnKeyType="search"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={s.searchRunBtn}
              onPress={runSearch}
              disabled={searchLoading}
            >
              {searchLoading ? (
                <ActivityIndicator size="small" color="#0F0E0C" />
              ) : (
                <Text style={s.searchRunBtnText}>Go</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={s.searchCloseBtn} onPress={closeSearch}>
              <Text style={s.searchCloseBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
          {searchResults.length > 0 && (
            <View style={s.searchNav}>
              <TouchableOpacity
                style={[
                  s.searchArrow,
                  searchIdx === 0 && s.searchArrowDisabled,
                ]}
                onPress={() => goToResult(searchIdx - 1)}
                disabled={searchIdx === 0}
              >
                <Text style={s.searchArrowText}>‹</Text>
              </TouchableOpacity>
              <Text style={s.searchCount}>
                {searchIdx + 1} / {searchResults.length}
              </Text>
              <TouchableOpacity
                style={[
                  s.searchArrow,
                  searchIdx === searchResults.length - 1 &&
                    s.searchArrowDisabled,
                ]}
                onPress={() => goToResult(searchIdx + 1)}
                disabled={searchIdx === searchResults.length - 1}
              >
                <Text style={s.searchArrowText}>›</Text>
              </TouchableOpacity>
            </View>
          )}
          {!searchLoading &&
            searchQuery.length > 1 &&
            searchResults.length === 0 && (
              <View style={s.searchEmpty}>
                <Text style={s.searchEmptyText}>No results found</Text>
              </View>
            )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  loadingText: { color: "#8A8070", fontSize: 14, marginTop: 12 },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15,14,12,0.95)",
    borderBottomWidth: 1,
    borderBottomColor: "#2E2C28",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 14,
    gap: 12,
  },
  backBtn: { padding: 4 },
  backArrow: { color: "#F0EBE1", fontSize: 22 },

  titleArea: { flex: 1, minWidth: 0 },

  // CHANGED — bigger, more prominent
  bookTitle: {
    color: "#F0EBE1",
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Georgia",
    letterSpacing: 0.2,
  },
  // CHANGED — accent color so chapter is visible
  chapterTitleTx: {
    color: "#E8A838",
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },

  // NEW — groups chat + toc together on the right
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },

  chatPill: {
    backgroundColor: "rgba(232,168,56,0.14)",
    borderWidth: 1,
    borderColor: "rgba(232,168,56,0.35)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chatPillText: { color: "#E8A838", fontSize: 12, fontWeight: "600" },

  // NEW — matches chat pill style
  tocBtn: {
    backgroundColor: "rgba(232,168,56,0.14)",
    borderWidth: 1,
    borderColor: "rgba(232,168,56,0.35)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tocBtnText: { color: "#E8A838", fontSize: 16, fontWeight: "600" },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: "rgba(15,14,12,0.92)",
    borderTopWidth: 1,
    borderTopColor: "#2E2C28",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 32,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  sliderPct: { color: "#8A8070", fontSize: 11, minWidth: 32 },
  slider: { flex: 1, height: 36 },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  themeGroup: { flexDirection: "row", gap: 6 },
  themeBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  themeBtnActive: { borderColor: "#E8A838" },
  fontGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  fontBtn: {
    backgroundColor: "#242220",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  fontBtnText: { color: "#F0EBE1", fontSize: 13, fontWeight: "700" },
  fontSizeNum: {
    color: "#8A8070",
    fontSize: 12,
    minWidth: 20,
    textAlign: "center",
  },

  // ── TOC ──────────────────────────────────────────────────────────────────
  tocHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  tocCloseText: { color: "#8A8070", fontSize: 20 },
  tocItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1C18",
  },
  tocItemText: { flex: 1, color: "#F0EBE1", fontSize: 14, fontWeight: "600" },
  tocSubItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 36,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1C18",
    backgroundColor: "#161412",
  },
  tocSubItemText: { flex: 1, color: "#8A8070", fontSize: 13 },
  tocArrow: { color: "#3E3C38", fontSize: 18 },

  // ── Shared modal ──────────────────────────────────────────────────────────
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  sheet: {
    backgroundColor: "#1A1916",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: "#2E2C28",
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: "80%",
    flexShrink: 1,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#2E2C28",
    borderRadius: 2,
    alignSelf: "center",
    marginVertical: 14,
  },
  sheetTitle: {
    color: "#F0EBE1",
    fontSize: 16,
    fontFamily: "Georgia",
    marginBottom: 12,
  },
  quoteBox: {
    backgroundColor: "#242220",
    borderLeftWidth: 3,
    borderLeftColor: "#E8A838",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  quoteText: {
    color: "#C8BFB0",
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 20,
  },

  tabRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2E2C28",
  },
  tabActive: {
    borderColor: "#E8A838",
    backgroundColor: "rgba(232,168,56,0.12)",
  },
  tabText: { color: "#8A8070", fontSize: 12 },
  tabTextActive: { color: "#E8A838", fontWeight: "600" },

  aiLoadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  aiLoadText: { color: "#8A8070", fontSize: 13 },
  aiResponse: {
    backgroundColor: "#242220",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    maxHeight: 220,
  },
  aiResponseText: { color: "#C8BFB0", fontSize: 13, lineHeight: 20 },

  actionRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  actionBtn: {
    flex: 1,
    minWidth: 80,
    backgroundColor: "#242220",
    borderWidth: 1,
    borderColor: "#2E2C28",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  actionBtnActive: {
    backgroundColor: "rgba(232,88,88,0.12)",
    borderColor: "rgba(232,88,88,0.4)",
  },
  actionBtnText: { color: "#C8BFB0", fontSize: 12 },
  actionBtnTextActive: { color: "#E85858" },
  askBtn: {
    flex: 2,
    minWidth: 60,
    backgroundColor: "#E8A838",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  askBtnText: { color: "#0F0E0C", fontSize: 13, fontWeight: "700" },
  imagineBtn: {
    flex: 1,
    minWidth: 80,
    backgroundColor: "rgba(93,187,138,0.12)",
    borderWidth: 1,
    borderColor: "rgba(93,187,138,0.3)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  imagineBtnText: { color: "#5DBB8A", fontSize: 12 },
  chatBtn: {
    flex: 1,
    minWidth: 60,
    backgroundColor: "rgba(232,168,56,0.1)",
    borderWidth: 1,
    borderColor: "rgba(232,168,56,0.25)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  chatBtnText: { color: "#E8A838", fontSize: 12 },
  closeBtn: {
    width: 42,
    backgroundColor: "#242220",
    borderWidth: 1,
    borderColor: "#2E2C28",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  closeBtnText: { color: "#8A8070", fontSize: 13 },

  imagineImgWrapper: {
    width: "100%",
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#2E2C28",
    backgroundColor: "#0F0E0C",
  },
  imagineImg: { width: "100%", height: 260 },
  imagineExpandHint: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  imagineExpandHintText: {
    color: "#F0EBE1",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  imagineUnavailable: {
    backgroundColor: "#242220",
    borderRadius: 14,
    padding: 24,
    marginBottom: 14,
    alignItems: "center",
  },
  imagineDescLabel: {
    color: "#E8A838",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  imagineDescText: { color: "#C8BFB0", fontSize: 14, lineHeight: 22 },

  lightboxWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxImg: { width: "100%", height: "80%" },
  lightboxClose: {
    position: "absolute",
    top: 52,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightboxCloseText: { color: "#F0EBE1", fontSize: 16, fontWeight: "700" },

  primaryBtn: {
    backgroundColor: "#E8A838",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  primaryBtnText: { color: "#0F0E0C", fontWeight: "700", fontSize: 14 },

  errorText: { color: "#E85858", fontSize: 14, paddingVertical: 16 },
  // ── Search Overlay ─────────────────────────────────────────────────────────
  searchOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 110,
    backgroundColor: "rgba(15,14,12,0.98)", // Matches topBar look
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#2E2C28",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    height: 40,
    backgroundColor: "#242220",
    borderRadius: 8,
    paddingHorizontal: 14,
    color: "#F0EBE1",
    fontSize: 15,
  },
  searchRunBtn: {
    backgroundColor: "#E8A838",
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  searchRunBtnText: {
    color: "#0F0E0C",
    fontSize: 14,
    fontWeight: "700",
  },
  searchCloseBtn: {
    padding: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  searchCloseBtnText: {
    color: "#8A8070",
    fontSize: 20,
    fontWeight: "600",
  },
  searchNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    backgroundColor: "#242220",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  searchArrow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchArrowDisabled: {
    opacity: 0.3,
  },
  searchArrowText: {
    color: "#F0EBE1",
    fontSize: 26,
    lineHeight: 28,
  },
  searchCount: {
    color: "#C8BFB0",
    fontSize: 13,
    fontWeight: "600",
  },
  searchEmpty: {
    marginTop: 16,
    alignItems: "center",
    paddingVertical: 8,
  },
  searchEmptyText: {
    color: "#8A8070",
    fontSize: 14,
  },
});
