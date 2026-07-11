import axios from 'axios'

// Point to your backend — change IP for your local network or production URL
const BASE_URL = __DEV__
  ? 'http://192.168.0.183:3001/api'
  : 'https://your-production-url.com/api'

const client = axios.create({ baseURL: BASE_URL, timeout: 30000 })

// Clerk token getter — set by TokenBridge in App.jsx after Clerk loads
// Using a module-level variable avoids hook rules violations in axios interceptor
let _getToken = null
export function setTokenGetter(fn) {
  _getToken = fn
}

// Attach Clerk JWT to every request automatically
client.interceptors.request.use(async (cfg) => {
  try {
    if (_getToken) {
      const token = await _getToken()
      if (token) cfg.headers.Authorization = `Bearer ${token}`
    }
  } catch {}
  return cfg
})

client.interceptors.response.use(
  (r)   => r.data,
  (err) => Promise.reject(err.response?.data ?? err)
)

// ── User sync ─────────────────────────────────────────────────────────────────
export const syncUser = (data) => client.post('/users/sync', data)
export const getMe    = ()     => client.get('/users/me')

// ── Books ─────────────────────────────────────────────────────────────────────
export const registerBook = (bookId, meta) => client.post('/books', { bookId, ...meta })

// ── Progress ──────────────────────────────────────────────────────────────────
export const getProgress  = (bookId)       => client.get(`/books/${bookId}/progress`)
export const saveProgress = (bookId, data) => client.post(`/books/${bookId}/progress`, data)

// ── Highlights ────────────────────────────────────────────────────────────────
export const getHighlights    = (bookId)       => client.get(`/books/${bookId}/highlights`)
export const saveHighlight    = (bookId, data) => client.post(`/books/${bookId}/highlights`, data)
export const deleteHighlight  = (bookId, id)   => client.delete(`/books/${bookId}/highlights/${id}`)
export const getHighlightCount = ()            => client.get('/highlights/count')

// ── Shelves ───────────────────────────────────────────────────────────────────
export const getShelves      = ()                => client.get('/shelves')
export const createShelf     = (name)            => client.post('/shelves', { name })
export const renameShelf     = (id, name)        => client.patch(`/shelves/${id}`, { name })
export const deleteShelf     = (id)              => client.delete(`/shelves/${id}`)
export const addBookToShelf  = (shelfId, bookId) => client.post(`/shelves/${shelfId}/add-book`, { bookId })
export const removeFromShelf = (shelfId, bookId) => client.delete(`/shelves/${shelfId}/remove-book`, { data: { bookId } })

// ── AI ────────────────────────────────────────────────────────────────────────
export const aiQuery   = (data)         => client.post('/ai/query', data)
export const aiImagine = (data)         => client.post('/ai/imagine', data)
export const getRecap  = (bookId, data) => client.post(`/books/${bookId}/recap`, data)

// ── Chat ──────────────────────────────────────────────────────────────────────
export const getChatSessions   = (bookId)           => client.get(`/chats?bookId=${bookId}`)
export const createChatSession = (bookId, title)    => client.post('/chats', { bookId, title })
export const getChatMessages   = (sessionId)        => client.get(`/chats/${sessionId}/messages`)
export const sendChatMessage   = (sessionId, data)  => client.post(`/chats/${sessionId}/messages`, data)
export const deleteChatSession = (sessionId)        => client.delete(`/chats/${sessionId}`)

// ── Storage ───────────────────────────────────────────────────────────────────
export const uploadEpub     = (bookId, formData) => client.post(`/storage/upload/${bookId}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const getDownloadUrl = (bookId)           => client.get(`/storage/download-url/${bookId}`)
// ── Books (cloud) ─────────────────────────────────────────────────────────────
// Used by useLibrary for cross-device sync — returns books user has in backend
export const getBooks = () => client.get('/books')

// ── Store ─────────────────────────────────────────────────────────────────────
// Featured rails — top picks + new releases (no params needed)
export const getStoreFeatured = () => client.get('/store/featured')

// Browse/search — all params optional:
//   search   (string)  — token-based, matches title+author
//   page     (number)  — default 1, 20 per page
//   subject  (string)  — exact match e.g. "Science Fiction"
//   isPaid   ('true'|'false') — omit for all
//   sort     ('title'|'popular'|'newest') — default 'title'
export const getStoreBooks = (params) => client.get('/store/books', { params })

// Book detail by SE slug — triggers lazy description hydration on backend
// slug example: "mary-shelley/frankenstein"
export const getStoreBook = (slug) => client.get(`/store/books/${slug}`)

// Subject list for filter chips + genre rows
// Returns [{ name: 'Fiction', count: 870 }, ...] sorted by count desc
export const getStoreSubjects = () => client.get('/store/subjects')

// Catalog seeding status — used by StoreScreen "loading" empty state
export const getCatalogStatus = () => client.get('/store/catalog/status')

// Purchase flow — catalogBookId is the SE slug of a paid book
export const createStoreOrder = (data) => client.post('/store/purchase/create-order', data)
export const verifyStoreOrder  = (data) => client.post('/store/purchase/verify', data)
export const getMyPurchases    = ()     => client.get('/store/purchases')