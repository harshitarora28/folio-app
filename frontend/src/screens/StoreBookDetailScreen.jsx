import { useState, useEffect }        from 'react'
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Modal, Alert,
} from 'react-native'
import { WebView }                     from 'react-native-webview'
import { SafeAreaView }                from 'react-native-safe-area-context'
import { useNavigation, useRoute }     from '@react-navigation/native'
import { useStoreBook, useGetFreeBook, useCreateOrder, useVerifyAndDownload, usePurchases } from '../hooks/useStore'
import { epubExists } from '../utils/bookStore'


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
  const [isDownloaded,    setIsDownloaded]    = useState(false)

  const getFreeBook       = useGetFreeBook()
  const createOrder       = useCreateOrder()
  const verifyAndDownload = useVerifyAndDownload()
  const { data: purchases = [] } = usePurchases()

  // Check if this paid book is already purchased
  const isPurchased = purchases.some(p => p.catalogBookId === book?.id)

  // Check if EPUB is already on device (free or paid)
  useEffect(() => {
    if (!book?.id) return
    // Derive the bookId the same way useGetFreeBook does
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
        <View style={s.coverWrap}>
          {book?.coverUrl
            ? <Image 
                source={{ 
                  uri: book.coverUrl,
                  headers: { 
                    'User-Agent': BROWSER_UA,
                    'Referer': 'https://standardebooks.org/'
                  } 
                }} 
                style={s.cover} 
                resizeMode="cover" 
              />
            : <View style={[s.cover, s.coverFallback]}><Text style={{ fontSize: 56 }}>📖</Text></View>
          }
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
          {/* ── Already downloaded — just open it ─────────────────────────── */}
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
            /* ── Paid book — show Buy or Purchased ─────────────────────────── */
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
            /* ── Free book ─────────────────────────────────────────────────── */
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

      <Modal
        visible={checkoutVisible}
        animationType="slide"
        onRequestClose={() => setCheckoutVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
          <View style={s.checkoutHeader}>
            <TouchableOpacity onPress={() => setCheckoutVisible(false)}>
              <Text style={{ color: MUTED, fontSize: 14 }}>✕ Cancel</Text>
            </TouchableOpacity>
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
  coverFallback: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },

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
  ctaBtnOwned:   { backgroundColor: '#2D6B4F' },  // green — already owned
  ctaDisclaimer: { color: MUTED, fontSize: 11, textAlign: 'center', marginTop: 10 },

  checkoutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
})