import { File, Directory, Paths } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ── User scoping ──────────────────────────────────────────────────────────────
// CRITICAL: every user on the same device must have an isolated library.
// initBookStore(clerkId) must be called on sign-in (and with null on sign-out)
// before any read/write touches AsyncStorage — see App.jsx UserSyncBridge.
let _userId = null

export function initBookStore(clerkId) {
  _userId = clerkId ?? null
}

function getBooksKey() {
  // Falls back to an "anonymous" bucket only if something reads before
  // sign-in resolves — should never persist real data under this key.
  return _userId ? `folio_books_${_userId}` : 'folio_books_anonymous'
}

// ── Paths ─────────────────────────────────────────────────────────────────────
// Pass Paths.document directly as the first argument, followed by the folder name
function booksDir()        { return new Directory(Paths.document, 'books') }
function coversDir()       { return new Directory(Paths.document, 'covers') }

// You can chain off the directory object, or pass multiple segments
function epubFile(bookId)  { return new File(Paths.document, 'books', `${bookId}.epub`) }
function coverFile(bookId) { return new File(Paths.document, 'covers', `${bookId}.jpg`) }

function ensureDir(dir) {
  if (!dir.exists) dir.create()
}

// ── File existence check (sync) ───────────────────────────────────────────────
export function epubExists(bookId) {
  try { return epubFile(bookId).exists } catch { return false }
}

// ── AsyncStorage ──────────────────────────────────────────────────────────────
export async function getAllBooks() {
  const raw = await AsyncStorage.getItem(getBooksKey())
  return raw ? JSON.parse(raw) : []
}

export async function saveBook(meta) {
  const existing = await getAllBooks()
  const updated  = [meta, ...existing.filter(b => b.id !== meta.id)]
  await AsyncStorage.setItem(getBooksKey(), JSON.stringify(updated))
}

export async function updateBookMeta(bookId, updates) {
  const existing = await getAllBooks()
  const updated  = existing.map(b => b.id === bookId ? { ...b, ...updates } : b)
  await AsyncStorage.setItem(getBooksKey(), JSON.stringify(updated))
}

export async function deleteBook(bookId) {
  const existing = await getAllBooks()
  await AsyncStorage.setItem(getBooksKey(), JSON.stringify(existing.filter(b => b.id !== bookId)))
  try { epubFile(bookId).delete()  } catch {}
  try { coverFile(bookId).delete() } catch {}
  try { await AsyncStorage.removeItem(`folio_locs_${bookId}`) } catch {}
}

export async function clearAllBooks() {
  await AsyncStorage.removeItem(getBooksKey())
}

// ── EPUB file ─────────────────────────────────────────────────────────────────
export async function saveEpub(bookId, sourceUri) {
  ensureDir(booksDir())
  const src  = new File(sourceUri)
  const dest = epubFile(bookId)

  // FIX: delete destination first if it already exists.
  // expo-file-system SDK 54 copy() throws if destination exists — unlike the
  // legacy copyAsync which silently overwrites. This happens when:
  // 1. Same book uploaded by two different accounts on the same device
  // 2. Book re-uploaded after a failed previous attempt
  if (dest.exists) {
    dest.delete()
  }

  src.copy(dest)
  return dest.uri
}



export function getEpubPath(bookId) {
  return epubFile(bookId).uri
}

export async function readEpubBase64(bookId) {
  const file = epubFile(bookId)
  if (!file.exists) throw new Error(`EPUB not found: ${file.uri}`)
  
  // Use the native base64 method available in SDK 54
  const base64 = await file.base64()
  return base64.replace(/^data:[^;]+;base64,/, '')
}

// ── Cover image ───────────────────────────────────────────────────────────────
export async function saveCoverFromDataUrl(bookId, dataUrl) {
  try {
    ensureDir(coversDir())
    const base64 = dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '')
    const bytes  = base64ToUint8Array(base64)
    const file   = coverFile(bookId)
    file.write(bytes)
    await updateBookMeta(bookId, { coverUri: file.uri })
    return file.uri
  } catch (e) {
    console.error('Failed to save cover:', e)
    return null
  }
}

export function getCoverPath(bookId) {
  return coverFile(bookId).uri
}

// ── Hash ──────────────────────────────────────────────────────────────────────
export async function hashEpubFile(uri) {
  const file   = new File(uri)
  const base64 = await file.base64()
  const raw    = base64.replace(/^data:[^;]+;base64,/, '')
  // Hash first ~64KB (87380 base64 chars ≈ 65536 bytes)
  const chunk  = raw.slice(0, 87380)
  const hash   = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    chunk
  )
  return hash.slice(0, 16)
}

export async function getBookLocations(bookId) {
  try {
    return await AsyncStorage.getItem(`folio_locs_${bookId}`)
  } catch {
    return null
  }
}

export async function saveBookLocations(bookId, locations) {
  try {
    await AsyncStorage.setItem(`folio_locs_${bookId}`, locations)
  } catch {}
}

// ── Download EPUB from URL (lazy load on first open) ─────────────────────────
// Called by useOpenBook when user taps a cloud-synced book that hasn't been
// downloaded yet. Downloads from Supabase Storage signed URL or SE CDN.
// Returns the local URI of the saved file.
export async function downloadEpubFromUrl(bookId, url) {
  const dest = epubFile(bookId)
  if (dest.exists) return dest.uri  // already on device — return immediately

  ensureDir(booksDir())

  // Use legacy downloadAsync — most reliable for URL→file on Android in Expo Go
  // The new File API has no built-in download method
  const { downloadAsync, cacheDirectory } = await import('expo-file-system/legacy')
  const cacheUri = `${cacheDirectory}${bookId}_dl.epub`

  const result = await downloadAsync(
    url.includes('?') ? url : `${url}?source=download`,
    cacheUri
  )
  if (result.status !== 200) {
    throw new Error(`Download failed: HTTP ${result.status}`)
  }

  // Validate ZIP magic bytes (PK\x03\x04) — catches HTML error pages served as 200
  const srcFile = new File(result.uri)
  const bytes   = await srcFile.bytes()
  if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
    try { srcFile.delete() } catch {}
    throw new Error('Downloaded file is not a valid EPUB (failed ZIP validation)')
  }

  // Move from cache to permanent books directory
  if (dest.exists) dest.delete()
  srcFile.copy(dest)
  try { srcFile.delete() } catch {}

  return dest.uri
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function base64ToUint8Array(base64) {
  const binary = atob(base64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const COVER_COLORS = [
  '#2D3561','#8B3A3A','#2D6B4F',
  '#4A3728','#3D2D6B','#6B4A2D',
  '#284A3D','#6B2D4A',
]
export const randomCoverColor = () =>
  COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)]