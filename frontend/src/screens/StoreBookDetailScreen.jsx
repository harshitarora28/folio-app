import React, { useState, useEffect, useMemo } from 'react'
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Modal, Alert,
} from 'react-native'
import { WebView }                     from 'react-native-webview'
import { SafeAreaView }                from 'react-native-safe-area-context'
import { useNavigation, useRoute }     from '@react-navigation/native'
import { useStoreBook, useGetFreeBook, useCreateOrder, useVerifyAndDownload, usePurchases } from '../hooks/useStore'
import { epubExists } from '../utils/bookStore'

// ── DESIGN SYSTEM CONSTANTS ──────────────────────────────────────────────────
const ACCENT = '#E8A838'
const BG     = '#0F0E0C'
const CARD   = '#1A1916'
const ELV    = '#242220'
const BORDER = '#2E2C28'
const TEXT   = '#F0EBE1'
const MUTED  = '#8A8070'
const LIGHT  = '#C8BFB0'
const GREEN  = '#5DBB8A'

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ── EDGE CDN PROXY HELPER ────────────────────────────────────────────────────
function getOptimizedCoverUrl(rawUrl, width = 600) {
  if (!rawUrl) return null;
  const cleanUrl = rawUrl.replace(/^https?:\/\//, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&w=${width}&output=webp&q=80&il`;
}

// ── HIGH-PERFORMANCE HIGH-AVAILABILITY IMAGE LAYER ──────────────────────────
const OptimizedCover = React.memo(({ url, style, fallbackSize = 24 }) => {
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
        <Text style={{ fontSize: fallbackSize }}>📖</Text>
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

function buildRazorpayHtml({ orderId, amount, currency, key, bookTitle }) {
  const safeTitle = (bookTitle || '').replace(/'/g, "\\'")
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;background:#0F0E0C;display:flex;align-items:center;
       justify-content:center;height:100vh;font-family:sans-serif}
  p{color:#8A8070;font-size:14px;text-align:center;padding:20px}
</style>
</head>
<body>
<p>Opening payment…</p>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
(function(){
  function send(d){ window.ReactNativeWebView.postMessage(JSON.stringify(d)) }
  var opts = {
    key:         '${key}',
    amount:      ${amount},
    currency:    '${currency}',
    order_id:    '${orderId}',
    name:        'Folio',
    description: '${safeTitle}',
    theme:       { color:'${ACCENT}', backdrop_color:'#0F0E0C' },
    handler: function(r){
      send({ type:'success', razorpay_order_id:r.razorpay_order_id,
             razorpay_payment_id:r.razorpay_payment_id, razorpay_signature:r.razorpay_signature })
    },
    modal:{ ondismiss:function(){ send({ type:'dismissed' }) } }
  }
  var rzp = new Razorpay(opts)
  rzp.on('payment.failed', function(r){
    send({ type:'failed', error: r.error ? r.error.description : 'Payment failed' })
  })
  setTimeout(function(){ rzp.open() }, 600)
})()
</script>
</body>
</html>`
}

export default function StoreBookDetailScreen() {
  const nav   = useNavigation()
  const route = useRoute()

  const { book: passedBook } = route.params

  const { data: detailBook, isLoading: detailLoading } = useStoreBook(passedBook?.id)
  const book = detailBook || passedBook

  const [checkoutHtml,    setCheckoutHtml]    = useState(null)
  const [checkoutVisible, setCheckoutVisible] = useState(false)
  const [actionLoading,   setActionLoading]   = useState(false)
  const [checkoutReady,   setCheckoutReady]   = useState(false)
  const [isDownloaded,    setIsDownloaded]    = useState(false)

  const getFreeBook       = useGetFreeBook()
  const createOrder       = useCreateOrder()
  const verifyAndDownload = useVerifyAndDownload()
  const { data: purchases = [] } = usePurchases()

  const isPurchased = purchases.some(p => p.catalogBookId === book?.id)

  useEffect(() => {
    if (!book?.id) return
    const slugHash = (book.id || '').replace(/\//g, '_').replace(/-/g, '').slice(0, 16)
    const bookId   = slugHash.padEnd(16, '0')
    setIsDownloaded(epubExists(bookId))
  }, [book?.id])

  const handleGetFree = () => {
    getFreeBook.mutate(
      { slug: book.id, epubUrl: book.epubUrl, title: book.title, author: book.author, coverUrl: book.coverUrl },
      {
        onSuccess: ({ bookId, alreadyOwned }) => {
          if (alreadyOwned) {
            Alert.alert('Already in Library', `"${book.title}" is already in your library.`)
          } else {
            Alert.alert(
              'Added!',
              `"${book.title}" is now in your library.`,
              [
                { text: 'Read Now', onPress: () => nav.navigate('Reader', {
                    book: { id: bookId, title: book.title, author: book.author, coverColor: '#2D3561' }
                  })
                },
                { text: 'Keep Browsing', style: 'cancel' },
              ]
            )
          }
        },
      }
    )
  }

  const handleBuy = async () => {
    setActionLoading(true)
    try {
      const order = await createOrder.mutateAsync({
        catalogBookId: book.id,
        bookTitle:     book.title,
        bookAuthor:    book.author,
      })
      const html = buildRazorpayHtml({
        orderId:   order.orderId,
        amount:    order.amount,
        currency:  order.currency,
        key:       order.key,
        bookTitle: book.title,
      })
      setCheckoutHtml(html)
      setCheckoutReady(false)   // State machine lock: hide cancel mechanics until handover
      setCheckoutVisible(true)
    } catch (err) {
      Alert.alert('Error', err?.error || 'Could not create payment order. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleWebViewMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data)
      
      // Handshake established: frame successfully parsed initialization script
      if (!checkoutReady) setCheckoutReady(true)

      if (msg.type === 'success') {
        setCheckoutVisible(false)
        verifyAndDownload.mutate(
          {
            paymentData: {
              razorpay_order_id:   msg.razorpay_order_id,
              razorpay_payment_id: msg.razorpay_payment_id,
              razorpay_signature:  msg.razorpay_signature,
            },
            book,
          },
          {
            onSuccess: ({ bookId }) => {
              Alert.alert(
                'Purchase Successful!',
                `"${book.title}" has been added to your library.`,
                [
                  { text: 'Read Now', onPress: () => nav.navigate('Reader', {
                      book: { id: bookId, title: book.title, author: book.author, coverColor: '#2D3561' }
                    })
                  },
                  { text: 'OK', style: 'cancel' },
                ]
              )
            },
          }
        )
      } else if (msg.type === 'dismissed') {
        setCheckoutVisible(false)
        setCheckoutReady(false)
      } else if (msg.type === 'failed') {
        setCheckoutVisible(false)
        Alert.alert('Payment Failed', msg.error || 'Please try again.')
      }
    } catch {}
  }

  const isBusy = getFreeBook.isPending || verifyAndDownload.isPending || actionLoading

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{book?.title}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        
        {/* ── UPGRADED COVER WRAP WITH EDGE CDN PROXY (600px width) ── */}
        <View style={s.coverWrap}>
          <OptimizedCover 
            url={getOptimizedCoverUrl(book?.coverUrl, 600)} 
            style={s.cover} 
            fallbackSize={56} 
          />
        </View>

        <View style={s.meta}>
          <Text style={s.title}>{book?.title}</Text>
          <Text style={s.author}>{book?.author}</Text>

          {book?.subjects?.length > 0 && (
            <View style={s.subjectRow}>
              {book.subjects.map(sub => (
                <View key={sub} style={s.subjectTag}>
                  <Text style={s.subjectTagText}>{sub}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.priceRow}>
            <View style={book?.isPaid ? s.priceBadgePaid : s.priceBadgeFree}>
              <Text style={s.priceText}>
                {book?.isPaid ? `₹${(book.price ?? 0) / 100}` : '✓ Free'}
              </Text>
            </View>
          </View>

          <View style={s.descBox}>
            {detailLoading && !book?.description ? (
              <View style={s.descLoading}>
                <ActivityIndicator size="small" color={MUTED} />
                <Text style={s.descLoadingText}>Loading description…</Text>
              </View>
            ) : book?.description ? (
              <Text style={s.desc}>{book.description}</Text>
            ) : (
              <Text style={s.descEmpty}>No description available.</Text>
            )}
          </View>
        </View>

        <View style={s.ctaArea}>
          {isDownloaded ? (
            <TouchableOpacity
              style={[s.ctaBtn, s.ctaBtnOwned]}
              onPress={() => {
                const slugHash = (book.id || '').replace(/\//g, '_').replace(/-/g, '').slice(0, 16)
                const bookId   = slugHash.padEnd(16, '0')
                nav.navigate('Reader', { book: { id: bookId, title: book.title, author: book.author, coverColor: '#2D3561' } })
              }}
            >
              <Text style={s.ctaBtnText}>📖  Read Now</Text>
            </TouchableOpacity>

          ) : book?.isPaid ? (
            isPurchased ? (
              <TouchableOpacity
                style={[s.ctaBtn, isBusy && s.ctaBtnDisabled]}
                onPress={() => getFreeBook.mutate({
                  slug:    book.id,
                  epubUrl: book.epubUrl,
                  title:   book.title,
                  author:  book.author,
                }, { onSuccess: () => setIsDownloaded(true) })}
                disabled={isBusy}
              >
                {isBusy
                  ? <ActivityIndicator color={BG} size="small" />
                  : <Text style={s.ctaBtnText}>⬇  Download to Library</Text>
                }
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.ctaBtn, isBusy && s.ctaBtnDisabled]}
                onPress={handleBuy}
                disabled={isBusy}
              >
                {isBusy
                  ? <ActivityIndicator color={BG} size="small" />
                  : <Text style={s.ctaBtnText}>Buy · ₹{(book.price ?? 0) / 100}</Text>
                }
              </TouchableOpacity>
            )

          ) : (
            <TouchableOpacity
              style={[s.ctaBtn, (isBusy || !book?.epubUrl) && s.ctaBtnDisabled]}
              onPress={() => getFreeBook.mutate({
                slug:    book.id,
                epubUrl: book.epubUrl,
                title:   book.title,
                author:  book.author,
              }, { onSuccess: () => setIsDownloaded(true) })}
              disabled={isBusy || !book?.epubUrl}
            >
              {isBusy
                ? <ActivityIndicator color={BG} size="small" />
                : <Text style={s.ctaBtnText}>
                    {book?.epubUrl ? '+ Add to Library — Free' : 'EPUB unavailable'}
                  </Text>
              }
            </TouchableOpacity>
          )}

          <Text style={s.ctaDisclaimer}>
            {book?.isPaid
              ? 'Secure payment via Razorpay · Test mode'
              : 'Public domain · Standard Ebooks'}
          </Text>
        </View>
      </ScrollView>

      {/* ── SECURE TRANSACTIONAL WEBVIEW LAYER ── */}
      <Modal
        visible={checkoutVisible}
        animationType="slide"
        onRequestClose={() => {
          // Hardware Back Button Intercept: State Machine Check
          if (checkoutReady) {
            setCheckoutVisible(false)
            setCheckoutReady(false)
          }
        }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
          <View style={s.checkoutHeader}>
            {checkoutReady ? (
              <TouchableOpacity onPress={() => {
                setCheckoutVisible(false)
                setCheckoutReady(false)
              }}>
                <Text style={{ color: MUTED, fontSize: 14 }}>✕ Cancel</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 60 }} />
            )}
            <Text style={{ color: TEXT, fontSize: 15, fontFamily: 'Georgia' }}>Checkout</Text>
            <View style={{ width: 60 }} />
          </View>
          <WebView
            source={{ html: checkoutHtml || '' }}
            onMessage={handleWebViewMessage}
            javaScriptEnabled
            originWhitelist={['*']}
            style={{ flex: 1, backgroundColor: BG }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  header:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn: { padding: 4 },
  backArrow:   { color: TEXT, fontSize: 22 },
  headerTitle: { flex: 1, color: LIGHT, fontSize: 14 },

  content:     { paddingBottom: 60 },
  coverWrap:   { alignItems: 'center', paddingVertical: 24 },
  cover:       { width: 160, height: 240, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  
  // Added spinner & fallback styles for the detail cover
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

  meta:    { paddingHorizontal: 24 },
  title:   { color: TEXT, fontSize: 22, fontFamily: 'Georgia', textAlign: 'center', marginBottom: 6 },
  author:  { color: MUTED, fontSize: 15, textAlign: 'center', marginBottom: 14 },

  subjectRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 16 },
  subjectTag:    { backgroundColor: ELV, borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  subjectTagText:{ color: MUTED, fontSize: 11 },

  priceRow:       { alignItems: 'center', marginBottom: 16 },
  priceBadgeFree: { backgroundColor: 'rgba(93,187,138,0.15)', borderWidth: 1, borderColor: GREEN, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
  priceBadgePaid: { backgroundColor: 'rgba(232,168,56,0.15)', borderWidth: 1, borderColor: ACCENT, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
  priceText:      { color: TEXT, fontSize: 13, fontWeight: '700' },

  descBox:         { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 24, minHeight: 80 },
  desc:            { color: LIGHT, fontSize: 14, lineHeight: 22 },
  descEmpty:       { color: MUTED, fontSize: 13, fontStyle: 'italic' },
  descLoading:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  descLoadingText: { color: MUTED, fontSize: 13 },

  ctaArea:       { paddingHorizontal: 24 },
  ctaBtn:        { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaBtnDisabled:{ opacity: 0.5 },
  ctaBtnText:    { color: BG, fontWeight: '700', fontSize: 15 },
  ctaBtnOwned:   { backgroundColor: '#2D6B4F' },
  ctaDisclaimer: { color: MUTED, fontSize: 11, textAlign: 'center', marginTop: 10 },

  checkoutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
})