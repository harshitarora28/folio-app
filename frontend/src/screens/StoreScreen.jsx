import React, { useState, useCallback, useMemo } from 'react'
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  Image, ActivityIndicator, ScrollView, StyleSheet,
} from 'react-native'
import { SafeAreaView }     from 'react-native-safe-area-context'
import { useNavigation }    from '@react-navigation/native'
import {
  useStoreFeatured, useStoreBooks,
  useStoreSubjects, useCatalogStatus,
} from '../hooks/useStore'

// ── DESIGN SYSTEM CONSTANTS ──────────────────────────────────────────────────
const ACCENT  = '#E8A838'
const BG      = '#0F0E0C'
const CARD    = '#1A1916'
const ELV     = '#242220'
const BORDER  = '#2E2C28'
const TEXT    = '#F0EBE1'
const MUTED   = '#8A8070'
const LIGHT   = '#C8BFB0'
const GREEN   = '#5DBB8A'

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SORT_OPTIONS = [
  { label: 'A–Z',     value: 'title'   },
  { label: 'Popular', value: 'popular' },
  { label: 'Newest',  value: 'newest'  },
]

// ── EDGE CDN PROXY HELPER ────────────────────────────────────────────────────
function getOptimizedCoverUrl(rawUrl, width = 300) {
  if (!rawUrl) return null;
  const cleanUrl = rawUrl.replace(/^https?:\/\//, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&w=${width}&output=webp&q=80&il`;
}

// ── HIGH-PERFORMANCE HIGH-AVAILABILITY IMAGE LAYER ──────────────────────────
const OptimizedCover = React.memo(({ url, style }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const imageSource = useMemo(() => ({
    uri: url,
    cache: 'force-cache', 
    headers: {
      'User-Agent': BROWSER_UA,
      'Referer': 'https://standardebooks.org/'
    }
  }), [url])

  if (!url || error) {
    return (
      <View style={[style, s.coverFallbackContainer]}>
        <Text style={{ fontSize: 24 }}>📖</Text>
      </View>
    )
  }

  return (
    <View style={style}>
      <Image 
        source={imageSource}
        style={StyleSheet.absoluteFill} 
        resizeMode="cover"
        fadeDuration={150}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false)
          setError(true)
        }}
      />
      {loading && (
        <View style={[StyleSheet.absoluteFill, s.coverSpinner]}>
          <ActivityIndicator size="small" color={ACCENT} />
        </View>
      )}
    </View>
  )
})

// ── MEMOIZED LIST ITERATOR CARDS ─────────────────────────────────────────────
const BookCard = React.memo(({ book, onPress, width = 120 }) => {
  return (
    <TouchableOpacity 
      onPress={() => onPress(book)} 
      activeOpacity={0.75}
      style={[s.card, { width }]}
    >
      <View style={[s.cardCover, { width, height: width * 1.5 }]}>
        <OptimizedCover url={getOptimizedCoverUrl(book.coverUrl, 300)} style={StyleSheet.absoluteFill} />
        <View style={book.isPaid ? s.paidBadge : s.freeBadge}>
          <Text style={s.badgeText}>{book.isPaid ? `₹${book.price / 100}` : 'FREE'}</Text>
        </View>
      </View>
      <Text style={s.cardTitle} numberOfLines={2}>{book.title}</Text>
      <Text style={s.cardAuthor} numberOfLines={1}>{book.author}</Text>
    </TouchableOpacity>
  )
})

const GridCard = React.memo(({ book, onPress }) => {
  return (
    <TouchableOpacity 
      onPress={() => onPress(book)} 
      activeOpacity={0.75} 
      style={s.gridCard}
    >
      <View style={s.gridCover}>
        <OptimizedCover url={getOptimizedCoverUrl(book.coverUrl, 350)} style={StyleSheet.absoluteFill} />
        <View style={book.isPaid ? s.paidBadge : s.freeBadge}>
          <Text style={s.badgeText}>{book.isPaid ? `₹${book.price / 100}` : 'FREE'}</Text>
        </View>
      </View>
      <Text style={s.gridTitle} numberOfLines={2}>{book.title}</Text>
      <Text style={s.gridAuthor} numberOfLines={1}>{book.author}</Text>
    </TouchableOpacity>
  )
})

// ── HORIZONTAL CAROUSEL COMPONENTS ───────────────────────────────────────────
const SectionRow = React.memo(({ title, books, isLoading, onBookPress }) => {
  const renderItem = useCallback(({ item }) => (
    <BookCard book={item} onPress={onBookPress} />
  ), [onBookPress])

  const keyExtractor = useCallback(b => b.id, [])

  if (!isLoading && (!books || books.length === 0)) return null

  return (
    <View style={s.sectionWrap}>
      <Text style={s.sectionTitle}>{title}</Text>
      {isLoading ? (
        <ActivityIndicator color={ACCENT} style={s.rowLoader} />
      ) : (
        <FlatList
          data={books}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.carouselContent}
          renderItem={renderItem}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={3}
          removeClippedSubviews={true}
        />
      )}
    </View>
  )
})

const GenreRow = React.memo(({ subject, onBookPress }) => {
  const { data, isLoading } = useStoreBooks({ subject, sort: 'popular', page: 1 })
  return (
    <SectionRow
      title={subject}
      books={data?.results}
      isLoading={isLoading}
      onBookPress={onBookPress}
    />
  )
})

// ── MAIN CORE STORE MODULE ───────────────────────────────────────────────────
export default function StoreScreen() {
  const nav = useNavigation()

  const [searchInput, setSearchInput] = useState('')
  const [search,      setSearch]      = useState('')
  const [activeGenre, setActiveGenre] = useState('')
  const [paidFilter,  setPaidFilter]  = useState('')
  const [sort,        setSort]        = useState('title')
  const [page,        setPage]        = useState(1)
  const [showSort,    setShowSort]    = useState(false)

  const { data: featured,    isLoading: featuredLoading } = useStoreFeatured()
  const { data: subjects,    isLoading: subjectsLoading } = useStoreSubjects()
  const { data: catalogStatus }                           = useCatalogStatus()

  const isFiltering = search.length > 0 || !!activeGenre || !!paidFilter
  const { data: filteredData, isLoading: filterLoading, isFetching } = useStoreBooks({
    search, page, subject: activeGenre, isPaid: paidFilter, sort,
  })

  const top4Genres = useMemo(() => {
    return (subjects || []).slice(0, 4).map(s => s.name)
  }, [subjects])

  const handleSearch = useCallback(() => {
    setPage(1)
    setSearch(searchInput.trim())
  }, [searchInput])

  const handleClearSearch = useCallback(() => {
    setSearchInput('')
    setSearch('')
    setPage(1)
  }, [])

  const handleGenreChip = useCallback((genre) => {
    setActiveGenre(prev => prev === genre ? '' : genre)
    setPage(1)
  }, [])

  const handlePaidToggle = useCallback((val) => {
    setPaidFilter(prev => prev === val ? '' : val)
    setPage(1)
  }, [])

  const handleBookPress = useCallback((book) => {
    nav.navigate('StoreBookDetail', { book })
  }, [nav])

  const handleClearAll = useCallback(() => {
    setSearchInput(''); setSearch('')
    setActiveGenre(''); setPaidFilter('')
    setSort('title');   setPage(1)
  }, [])

  const renderGridItem = useCallback(({ item }) => (
    <GridCard book={item} onPress={handleBookPress} />
  ), [handleBookPress])

  const gridKeyExtractor = useCallback(b => b.id, [])

  // ── SEEDING LAYOUT FALLBACK ──
  if (catalogStatus && !catalogStatus.seeded) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Book Store</Text>
        </View>
        <View style={s.seedingState}>
          <ActivityIndicator color={ACCENT} size="large" />
          <Text style={s.seedingTitle}>Building the catalog…</Text>
          <Text style={s.seedingSubtitle}>
            Scraping 1,400+ books from Standard Ebooks.{'\n'}
            This only happens once. Check back in ~30 seconds.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Book Store</Text>
        <Text style={s.headerSub}>
          {catalogStatus?.bookCount
            ? `${catalogStatus.bookCount.toLocaleString()} books · Standard Ebooks`
            : 'Standard Ebooks'}
        </Text>
      </View>

      {/* ── SEARCH ENGINE BLOCK ── */}
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <Text style={s.searchIcon}>🔍</Text>
          <TextInput
            style={s.searchInput}
            placeholder="Search by title or author…"
            placeholderTextColor={MUTED}
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchInput.length > 0 && (
            <TouchableOpacity onPress={handleClearSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: MUTED, fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={s.searchBtn} onPress={handleSearch}>
          <Text style={s.searchBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      {/* ── FILTER & CONTROL ENGINE ── */}
      <View style={s.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
          {(subjects || []).map(({ name }) => (
            <TouchableOpacity key={name}
              style={[s.chip, activeGenre === name && s.chipActive]}
              onPress={() => handleGenreChip(name)}>
              <Text style={[s.chipText, activeGenre === name && s.chipTextActive]}>
                {name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.filterControls}>
          <TouchableOpacity
            style={[s.toggleBtn, paidFilter === 'false' && s.toggleActive]}
            onPress={() => handlePaidToggle('false')}>
            <Text style={[s.toggleText, paidFilter === 'false' && s.toggleTextActive]}>Free</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.toggleBtn, paidFilter === 'true' && s.toggleActive]}
            onPress={() => handlePaidToggle('true')}>
            <Text style={[s.toggleText, paidFilter === 'true' && s.toggleTextActive]}>Paid</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.sortBtn} onPress={() => setShowSort(v => !v)}>
            <Text style={s.sortBtnText}>
              {SORT_OPTIONS.find(o => o.value === sort)?.label ?? 'Sort'} ▾
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {showSort && (
        <View style={s.sortDropdown}>
          {SORT_OPTIONS.map(opt => (
            <TouchableOpacity key={opt.value}
              style={[s.sortOption, sort === opt.value && s.sortOptionActive]}
              onPress={() => { setSort(opt.value); setPage(1); setShowSort(false) }}>
              <Text style={[s.sortOptionText, sort === opt.value && { color: ACCENT }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isFiltering && (
        <View style={s.activeFilters}>
          <Text style={s.activeFiltersText}>
            {[search && `"${search}"`, activeGenre, paidFilter === 'true' ? 'Paid' : paidFilter === 'false' ? 'Free' : '']
              .filter(Boolean).join(' · ')}
            {filteredData ? ` · ${filteredData.total} results` : ''}
          </Text>
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={s.clearFilters}>Clear all</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── VIEW LAYER CONDITIONAL RENDERING ── */}
      {!isFiltering ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <SectionRow
            title="⭐ Top Picks"
            books={featured?.topPicks}
            isLoading={featuredLoading}
            onBookPress={handleBookPress}
          />
          <SectionRow
            title="✨ New Releases"
            books={featured?.newReleases}
            isLoading={featuredLoading}
            onBookPress={handleBookPress}
          />
          {top4Genres.map(genre => (
            <GenreRow key={genre} subject={genre} onBookPress={handleBookPress} />
          ))}
        </ScrollView>
      ) : (
        <>
          {filterLoading || isFetching ? (
            <View style={s.center}><ActivityIndicator color={ACCENT} size="large" /></View>
          ) : (
            <FlatList
              data={filteredData?.results ?? []}
              keyExtractor={gridKeyExtractor}
              numColumns={2}
              columnWrapperStyle={s.gridRow}
              contentContainerStyle={s.gridContent}
              showsVerticalScrollIndicator={false}
              renderItem={renderGridItem}
              initialNumToRender={6}
              maxToRenderPerBatch={6}
              windowSize={5}
              removeClippedSubviews={true}
              ListEmptyComponent={() => (
                <View style={s.center}>
                  <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
                  <Text style={{ color: MUTED, fontSize: 14 }}>No books found</Text>
                </View>
              )}
              ListFooterComponent={() => filteredData?.results?.length > 0 ? (
                <View style={s.pagination}>
                  <TouchableOpacity
                    style={[s.pageBtn, page === 1 && s.pageBtnOff]}
                    onPress={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}>
                    <Text style={[s.pageBtnText, page === 1 && { opacity: 0.3 }]}>← Prev</Text>
                  </TouchableOpacity>
                  <Text style={s.pageNum}>Page {page} of {Math.ceil((filteredData?.total ?? 0) / 20)}</Text>
                  <TouchableOpacity
                    style={[s.pageBtn, !filteredData?.hasNext && s.pageBtnOff]}
                    onPress={() => setPage(p => p + 1)}
                    disabled={!filteredData?.hasNext}>
                    <Text style={[s.pageBtnText, !filteredData?.hasNext && { opacity: 0.3 }]}>Next →</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            />
          )}
        </>
      )}
    </SafeAreaView>
  )
}

// ── OPTIMIZED APPLICATION STYLE DEFINITION ──────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },

  header:    { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  headerTitle: { color: TEXT, fontSize: 22, fontFamily: 'Georgia' },
  headerSub:   { color: MUTED, fontSize: 11, marginTop: 2 },

  seedingState:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  seedingTitle:    { color: TEXT, fontSize: 18, fontFamily: 'Georgia', marginTop: 20, marginBottom: 8 },
  seedingSubtitle: { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20 },

  searchRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, paddingHorizontal: 12,
  },
  searchIcon:    { fontSize: 14 },
  searchInput:   { flex: 1, color: TEXT, fontSize: 14, paddingVertical: 10 },
  searchBtn:     { backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  searchBtnText: { color: BG, fontWeight: '700', fontSize: 13 },

  filterRow:     { paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  chipsRow:      { paddingHorizontal: 16, paddingVertical: 6, gap: 8 },
  chip:          { backgroundColor: ELV, borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  chipActive:    { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText:      { color: LIGHT, fontSize: 12 },
  chipTextActive:{ color: BG, fontWeight: '700' },

  filterControls: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 4, gap: 8, alignItems: 'center' },
  toggleBtn:      { backgroundColor: ELV, borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  toggleActive:   { backgroundColor: 'rgba(232,168,56,0.15)', borderColor: ACCENT },
  toggleText:     { color: LIGHT, fontSize: 12 },
  toggleTextActive:{ color: ACCENT, fontWeight: '700' },
  sortBtn:        { marginLeft: 'auto', backgroundColor: ELV, borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  sortBtnText:    { color: LIGHT, fontSize: 12 },

  sortDropdown: {
    position: 'absolute', top: 148, right: 16, zIndex: 99,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, overflow: 'hidden',
  },
  sortOption:       { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  sortOptionActive: { backgroundColor: ELV },
  sortOptionText:   { color: LIGHT, fontSize: 13 },

  activeFilters:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 6 },
  activeFiltersText: { color: MUTED, fontSize: 11, flex: 1 },
  clearFilters:      { color: ACCENT, fontSize: 11, fontWeight: '600' },

  sectionWrap:    { marginTop: 20 },
  sectionTitle:   { color: TEXT, fontSize: 15, fontFamily: 'Georgia', paddingHorizontal: 20, marginBottom: 10 },
  carouselContent:{ paddingHorizontal: 16, gap: 12 },
  rowLoader:      { marginLeft: 20, marginTop: 8, alignSelf: 'flex-start' },

  card:        { marginRight: 4 },
  cardCover:   { borderRadius: 10, backgroundColor: ELV, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  cardTitle:   { color: LIGHT, fontSize: 11, lineHeight: 15, fontWeight: '500' },
  cardAuthor:  { color: MUTED, fontSize: 10, marginTop: 2 },

  freeBadge: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(93,187,138,0.9)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  paidBadge: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(232,168,56,0.9)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },

  gridContent:     { paddingHorizontal: 12, paddingVertical: 12, paddingBottom: 40 },
  gridRow:         { justifyContent: 'space-between', marginBottom: 16 },
  gridCard:        { width: '48%' },
  gridCover:       { aspectRatio: 2/3, borderRadius: 10, backgroundColor: ELV, overflow: 'hidden', marginBottom: 6 },
  
  coverSpinner: {
    backgroundColor: 'rgba(26,25,22,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverFallbackContainer: {
    backgroundColor: ELV,
    alignItems: 'center',
    justifyContent: 'center',
  },

  gridTitle:   { color: LIGHT, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  gridAuthor:  { color: MUTED, fontSize: 11, marginTop: 2 },

  pagination:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16 },
  pageBtn:     { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  pageBtnOff:  { opacity: 0.4 },
  pageBtnText: { color: LIGHT, fontSize: 13 },
  pageNum:     { color: MUTED, fontSize: 12 },
})