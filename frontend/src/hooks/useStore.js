import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as FileSystem from 'expo-file-system/legacy'
import { useNavigation }  from '@react-navigation/native'
import * as api           from '../services/api'
import { useUIStore }     from '../stores/uiStore'
import { bookKeys }       from './useBooks'
import {
  saveBook, saveEpub, getAllBooks,
  randomCoverColor, hashEpubFile,
} from '../utils/bookStore'

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const storeKeys = {
  featured:  ()                            => ['store', 'featured'],
  books:     (search, page, subject, isPaid, sort) => ['store', 'books', search, page, subject, isPaid, sort],
  book:      (slug)                        => ['store', 'book', slug],
  subjects:  ()                            => ['store', 'subjects'],
  status:    ()                            => ['store', 'status'],
  purchases: ()                            => ['store', 'purchases'],
}

export function useStoreFeatured() {
  return useQuery({
    queryKey: storeKeys.featured(),
    queryFn:  api.getStoreFeatured,
    staleTime: 300_000,
    gcTime:    600_000,
  })
}

export function useStoreBooks({ search = '', page = 1, subject = '', isPaid = '', sort = 'title' } = {}) {
  return useQuery({
    queryKey: storeKeys.books(search, page, subject, isPaid, sort),
    queryFn:  () => api.getStoreBooks({ search, page, subject, isPaid, sort }),
    staleTime: 60_000,
    placeholderData: prev => prev,
  })
}

export function useStoreBook(slug) {
  return useQuery({
    queryKey: storeKeys.book(slug),
    queryFn:  () => api.getStoreBook(slug),
    enabled:  !!slug,
    staleTime: 86_400_000,
  })
}

export function useStoreSubjects() {
  return useQuery({
    queryKey: storeKeys.subjects(),
    queryFn:  api.getStoreSubjects,
    staleTime: 3_600_000,
    gcTime:    7_200_000,
  })
}

export function useCatalogStatus() {
  return useQuery({
    queryKey: storeKeys.status(),
    queryFn:  api.getCatalogStatus,
    staleTime: 30_000,
    refetchInterval: (query) => {
      return query.state.data?.seeded ? false : 10_000
    },
  })
}

export function usePurchases() {
  return useQuery({
    queryKey: storeKeys.purchases(),
    queryFn:  api.getMyPurchases,
    staleTime: 60_000,
  })
}

export function useGetFreeBook() {
  const qc       = useQueryClient()
  const addToast = useUIStore(s => s.addToast)

  return useMutation({
    mutationFn: async ({ slug, epubUrl, title, author, coverUrl }) => {
      console.log(`\n--- [STORE: DOWNLOAD START] ---`)
      console.log(`Target: ${title} (${slug})`)
      
      if (!epubUrl) throw new Error('No EPUB URL for this book')

      const directDownloadUrl = epubUrl.includes('?') ? `${epubUrl}&source=download` : `${epubUrl}?source=download`
      console.log(`URL: ${directDownloadUrl}`)

      const slugHash = slug.replace(/\//g, '_').replace(/-/g, '').slice(0, 16)
      const bookId   = slugHash.padEnd(16, '0')
      console.log(`Computed Book ID: ${bookId}`)

      const existing = await getAllBooks()
      if (existing.find(b => b.id === bookId)) {
        console.log(`Book already exists in library.`)
        return { bookId, alreadyOwned: true }
      }

      const tempUri = `${FileSystem.cacheDirectory}${bookId}_temp.epub`

      const dlRes = await FileSystem.downloadAsync(directDownloadUrl, tempUri, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Referer': 'https://standardebooks.org/',
          'Accept': 'application/epub+zip,application/octet-stream,*/*'
        }
      })
      
      console.log(`HTTP Status: ${dlRes.status}`)
      if (dlRes.status !== 200) {
        throw new Error(`Download failed: HTTP ${dlRes.status}`)
      }

      const info = await FileSystem.getInfoAsync(tempUri)
      console.log(`File Size: ${info.size} bytes`)

      const magicBytes = await FileSystem.readAsStringAsync(tempUri, { 
        length: 10, 
        encoding: FileSystem.EncodingType.Base64 
      })
      
      if (!magicBytes.startsWith('UEsDB')) {
        console.log(`!!! INVALID EPUB DETECTED !!!`)
        await FileSystem.deleteAsync(tempUri, { idempotent: true })
        throw new Error('Server returned HTML instead of EPUB.')
      }

      const permanentUri = await saveEpub(bookId, tempUri)

      try {
        await FileSystem.deleteAsync(tempUri, { idempotent: true })
      } catch (e) {}

      console.log(`Saving metadata to AsyncStorage...`)
      await saveBook({
        id:         bookId,
        title,
        author,
        coverColor: randomCoverColor(),
        coverUri:   coverUrl || null,
        addedAt:    new Date().toISOString(),
        seSlug:     slug,
      })

      console.log(`Registering book with backend...`)
      await api.registerBook(bookId, { title, author }).catch((e) => {
        console.log(`Backend registration failed: ${e.message}`)
      })

      try {
        console.log(`Uploading EPUB to Supabase storage...`)
        const formData = new FormData()
        formData.append('epub', { uri: permanentUri, type: 'application/epub+zip', name: `${bookId}.epub` })
        await api.uploadEpub(bookId, formData)
        console.log(`Supabase upload complete.`)
      } catch (e) {
        console.log(`Supabase upload failed: ${e.message}`)
      }

      console.log(`--- [STORE: DOWNLOAD SUCCESS] ---\n`)
      return { bookId, alreadyOwned: false }
    },

    onSuccess: ({ alreadyOwned, bookId }) => {
      qc.invalidateQueries({ queryKey: bookKeys.library() })
      addToast(alreadyOwned ? 'Already in your library' : 'Added to your library!', 'success')
    },
    onError: (err) => {
      console.error(`[STORE ERROR]`, err)
      addToast(err.message || 'Download failed', 'error')
    },
  })
}

export function useCreateOrder() {
  return useMutation({
    mutationFn: ({ catalogBookId, bookTitle, bookAuthor }) =>
      api.createStoreOrder({ catalogBookId, bookTitle, bookAuthor }),
  })
}

export function useVerifyAndDownload() {
  const qc       = useQueryClient()
  const addToast = useUIStore(s => s.addToast)
  const getFreeBook = useGetFreeBook()

  return useMutation({
    mutationFn: async ({ paymentData, book }) => {
      console.log(`\n--- [STORE: PAYMENT VERIFICATION START] ---`)
      console.log(`Order ID: ${paymentData.razorpay_order_id}`)
      
      await api.verifyStoreOrder({
        razorpay_order_id:   paymentData.razorpay_order_id,
        razorpay_payment_id: paymentData.razorpay_payment_id,
        razorpay_signature:  paymentData.razorpay_signature,
      }).catch(err => {
        console.log(`Payment Verification Failed on Backend: ${err.message}`)
        throw new Error('VERIFICATION_FAILED')
      })

      console.log(`Payment verified. Forwarding to download...`)
      return getFreeBook.mutateAsync({
        slug:     book.id,
        epubUrl:  book.epubUrl,
        title:    book.title,
        author:   book.author,
        coverUrl: book.coverUrl,
      })
    },

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storeKeys.purchases() })
      qc.invalidateQueries({ queryKey: bookKeys.library() })
      addToast('Purchase successful! Book added to your library.', 'success')
    },
    onError: (err) => {
      if (err.message === 'VERIFICATION_FAILED') {
        addToast('Payment verification failed on server', 'error')
      } else {
        addToast(err.message || 'Payment succeeded, but download failed.', 'error')
      }
    },
  })
}