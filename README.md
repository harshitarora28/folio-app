# 📖 Folio — AI-Powered EPUB Reading Companion

A production-grade mobile ebook reader with AI features, built with React Native (Expo) + Node.js.

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   React Native (Expo)                    │
│                                                          │
│  HomeScreen  ──→  ReaderScreen  ──→  ProfileScreen       │
│      │                  │                                │
│  BookCard           WebView                              │
│  ShelfSection     (epub.js)                              │
│  FAB             AI Modal                                │
│                  Recap Modal                             │
│                  TTS (expo-speech)                       │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API (JWT)
┌──────────────────────▼──────────────────────────────────┐
│                Node.js / Express                         │
│                                                          │
│  /auth    /books    /shelves    /ai    /highlights        │
│     │         │         │        │          │            │
│  bcrypt   progress  shelf_books  Redis    pg highlights   │
│  jwt      highlights  shelf_books cache                  │
└──────────┬──────────────────────────────────────────────┘
           │
   ┌───────┴──────────┐
   │   PostgreSQL      │   Redis
   │   (metadata)      │   (AI cache, rate limits)
   └───────────────────┘
```

**Key constraint:** EPUB files **never leave the device**. The backend stores only metadata, progress, and highlights.

---

## 📂 Full Project Structure

```
epub-companion/
├── docker-compose.yml
│
├── frontend/                        # React Native (Expo)
│   ├── App.js                       # Root navigation + auth gate
│   ├── app.json                     # Expo config
│   ├── package.json
│   │
│   ├── screens/
│   │   ├── HomeScreen.js            # Library + shelves + continue reading
│   │   ├── ReaderScreen.js          # EPUB reader with AI + TTS
│   │   ├── ProfileScreen.js         # User stats + settings
│   │   └── LoginScreen.js           # Auth (login / register)
│   │
│   ├── components/
│   │   ├── BookCard.js              # Book cover card
│   │   ├── ContinueReadingCard.js   # Hero continue-reading card
│   │   ├── ShelfSection.js          # Horizontal shelf with books
│   │   └── FAB.js                   # Floating action button
│   │
│   ├── contexts/
│   │   └── AuthContext.js
│   │
│   ├── services/
│   │   └── api.js                   # Axios API client (all endpoints)
│   │
│   └── utils/
│       ├── theme.js                 # Colors, fonts, spacing, shadows
│       └── epubRenderer.js          # Builds WebView HTML for epub.js
│
└── backend/                         # Node.js + Express
    ├── Dockerfile
    ├── .env.example
    ├── package.json
    │
    └── src/
        ├── server.js                # Entry point
        │
        ├── config/
        │   └── redis.js             # Redis client + cache helpers
        │
        ├── db/
        │   ├── pool.js              # PostgreSQL connection pool
        │   ├── schema.sql           # Complete DB schema
        │   └── migrate.js           # Migration runner
        │
        ├── middleware/
        │   └── auth.js              # JWT verify + signToken
        │
        ├── controllers/
        │   └── aiController.js      # OpenAI integration + mock fallback
        │
        └── routes/
            ├── auth.js              # /api/auth/*
            ├── books.js             # /api/books/* (progress, highlights, recap)
            ├── shelves.js           # /api/shelves/*
            ├── ai.js                # /api/ai/query
            └── highlights.js        # /api/highlights/*
```

---

## 🗃 Database Schema

```sql
users               → id, name, email, password_hash
books               → id (hash), user_id, title, author, cover_url
reading_progress    → user_id, book_id, cfi, percentage   [UNIQUE user+book]
highlights          → user_id, book_id, cfi, text, note, color
ai_chats            → user_id, book_id, cfi, action, query_text, response
chapter_summaries   → book_id, chapter_cfi, summary       [UNIQUE book+chapter]
shelves             → id, user_id, name
shelf_books         → shelf_id, book_id                   [composite PK]
```

---

## 🔌 API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Get JWT token |
| GET | `/api/auth/me` | ✓ | Current user profile |
| POST | `/api/books` | ✓ | Register book metadata |
| GET | `/api/books` | ✓ | List user's books |
| GET | `/api/books/:id/progress` | ✓ | Get reading position |
| POST | `/api/books/:id/progress` | ✓ | Save reading position (CFI) |
| GET | `/api/books/:id/highlights` | ✓ | Get highlights for book |
| POST | `/api/books/:id/highlights` | ✓ | Save highlight |
| DELETE | `/api/books/:id/highlights/:hid` | ✓ | Delete highlight |
| POST | `/api/books/:id/recap` | ✓ | Generate AI recap (cached) |
| GET | `/api/books/:id/summaries` | ✓ | Get chapter summaries |
| GET | `/api/shelves` | ✓ | List shelves |
| POST | `/api/shelves` | ✓ | Create shelf |
| PATCH | `/api/shelves/:id` | ✓ | Rename shelf |
| DELETE | `/api/shelves/:id` | ✓ | Delete shelf |
| POST | `/api/shelves/:id/add-book` | ✓ | Add book to shelf |
| DELETE | `/api/shelves/:id/remove-book` | ✓ | Remove book from shelf |
| POST | `/api/ai/query` | ✓ | AI explain/summarize/define |
| GET | `/api/highlights/count` | ✓ | Total highlights count |

---

## 🚀 Setup Instructions

### Option A: Docker (Recommended)

```bash
# 1. Clone / enter the project root
cd epub-companion

# 2. Copy and edit env (set JWT_SECRET at minimum)
cp backend/.env.example backend/.env
# nano backend/.env  ← set JWT_SECRET and optionally OPENAI_API_KEY

# 3. Start everything
docker compose up -d

# 4. Verify all services are healthy
docker compose ps

# Backend: http://localhost:3001/health
```

---

### Option B: Local Development

#### Backend

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your DB / Redis credentials

# Start PostgreSQL and Redis (via Docker or local install)
docker run -d --name folio_pg \
  -e POSTGRES_DB=folio -e POSTGRES_USER=folio -e POSTGRES_PASSWORD=folio_secret \
  -p 5432:5432 postgres:16-alpine

docker run -d --name folio_redis -p 6379:6379 redis:7-alpine

# Run database migration
npm run migrate

# Start dev server
npm run dev
# → Listening on http://localhost:3001
```

#### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Update API base URL for your machine (frontend/services/api.js)
# Change localhost to your machine's LAN IP if testing on a physical device
# e.g. 'http://192.168.1.100:3001/api'

# Start Expo dev server
npx expo start

# Scan QR code with Expo Go app on iOS/Android
# Or press 'a' for Android emulator, 'i' for iOS simulator
```

---

## ⚙️ Configuration

### Adding a Real AI (OpenAI)

```env
# In backend/.env
OPENAI_API_KEY=sk-...your-key...
```

Without a key the app uses built-in mock responses — fully functional for development.

### Production Checklist

- [ ] Set a strong `JWT_SECRET` (32+ random chars)
- [ ] Set `OPENAI_API_KEY` for real AI features
- [ ] Configure CORS in `server.js` to your app's domain
- [ ] Use HTTPS in production
- [ ] Set `NODE_ENV=production`
- [ ] Back up PostgreSQL `postgres_data` volume

---

## 📱 Feature Summary

| Feature | Implementation |
|---------|----------------|
| EPUB Rendering | epub.js inside React Native WebView |
| Offline Reading | EPUB stored locally via `expo-file-system` |
| Book Identification | SHA-256 hash of file prefix |
| Reading Position | EPUB CFI string, synced to backend |
| Highlights | CFI range + text, stored in PostgreSQL |
| AI Assistant | OpenAI GPT-4o-mini (mock fallback if no key) |
| AI Caching | Redis, keyed by bookId + action + text hash |
| Text-to-Speech | `expo-speech` native TTS |
| Recap | Per-book, cached by progress bucket |
| Shelves | Custom user collections, many-to-many |
| Auth | JWT, bcrypt password hashing, 30d expiry |
| Dark/Light/Sepia | Injected into epub.js via WebView bridge |
| Font Size | Adjustable 12px–28px via epub.js themes |
| Swipe Navigation | Touch events in WebView → next/prev page |

---

## 🔑 Design Decisions

**Why WebView + epub.js?**
epub.js is battle-tested for EPUB 2/3 rendering with CFI support, pagination, themes, and highlights — reinventing this in React Native would be months of work.

**Why no file upload to backend?**
Privacy-first design. The backend never sees book content — only the SHA-derived ID. Users own their files.

**Why Redis for AI caching?**
AI calls are expensive and often repetitive (same passage, same action). Redis eliminates duplicate API calls with minimal complexity.

**Why PostgreSQL over SQLite/MongoDB?**
Relational integrity between users → books → highlights → shelves is exactly what SQL excels at. Deployed in Docker it requires zero extra configuration.
