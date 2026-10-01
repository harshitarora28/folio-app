# Folio

**Folio is an offline-first Android EPUB reading companion with progress-aware AI assistance.** It lets readers import and read EPUB files locally, resume across sessions, organise books and highlights, and ask for contextual help without uploading the book itself by default.

Built as a summer-internship project by **Harshit Arora**.

## The problem

Reading apps are good at remembering a page number, but they do little to help when a reader returns to a dense book after a break. Existing AI features can also reveal future plot points or require a user to hand over their library.

Folio addresses that gap with an EPUB reader that keeps book files on-device and provides assistance that is aware of the reader's current progress.

## What it does

- Imports EPUB files from device storage and renders them with `epub.js` inside a React Native WebView.
- Stores reading position using EPUB Canonical Fragment Identifiers (CFIs), so the reader can resume at the same location after typography changes.
- Creates a stable, content-derived book ID from a SHA-256 hash of the file prefix. The backend can associate state with a book without receiving the book file.
- Saves reading progress, highlights, notes, shelves, summaries and chat history per authenticated user.
- Provides passage-level **Explain**, **Summarise** and **Define** actions.
- Generates spoiler-aware recaps and reading-companion responses using the reader's current percentage progress as context.
- Generates scene visualisations with fallback image providers and a text-description fallback.
- Includes a searchable Standard Ebooks catalogue and a Razorpay test-mode purchase flow with server-side signature verification.
- Supports optional EPUB backup through object storage; local reading does not depend on that backup.

## Why Folio is interesting

### Privacy-first synchronisation

The client computes a truncated SHA-256 identifier from the opening portion of an EPUB. The server stores only metadata and reader state against that ID, not the original book. As a result, compatible devices can synchronise state for the same file without a default full-book upload.

### Progress-aware AI

AI requests include the reader's progress in the book. This gives recap and chat prompts a concrete boundary intended to reduce spoilers rather than relying on a generic instruction alone.

### Cache-first assistance

Repeated AI requests are cached in Redis using the book ID, action and a hash of the selected passage. This avoids repeat model calls for identical requests and improves response time.

### Resilient external integrations

Text and image features have defined fallback behaviour. If an image provider is unavailable, Folio can still return a generated scene description instead of failing the reader experience entirely.

## Architecture

```text
React Native / Expo client
  |-- Local EPUB storage and content-derived book identity
  |-- epub.js renderer in a WebView
  |-- React Navigation, Zustand and TanStack Query
  |
  +-- Authenticated REST API --> Node.js / Express
                                 |-- Prisma ORM --> PostgreSQL
                                 |-- Redis response cache
                                 |-- Gemini text generation
                                 |-- Image-generation providers
                                 |-- Supabase object storage (opt-in backup)
                                 +-- Razorpay test-mode payments
```

## Technology stack

| Area | Technologies |
| --- | --- |
| Mobile client | React Native, Expo SDK 54, React 19, React Navigation |
| Reader | `epub.js` in `react-native-webview`, EPUB CFI locations |
| State and networking | Zustand, TanStack Query, Axios |
| Backend | Node.js, Express, Prisma |
| Data | PostgreSQL, Redis |
| Authentication | Clerk |
| AI | Google Gemini for text; Hugging Face and Cloudflare Workers AI fallbacks for images |
| Storage and payments | Supabase Storage, Razorpay |
| Styling | NativeWind and Tailwind CSS |

## Repository layout

```text
.
|-- frontend/                 # Expo / React Native application
|   |-- src/
|   |   |-- screens/          # Library, reader, chat, catalogue and profile UI
|   |   |-- hooks/            # Server-state hooks and mutations
|   |   |-- services/         # Authenticated API client
|   |   |-- stores/           # Local UI and reader state
|   |   `-- utils/            # EPUB bridge, hashing and local book storage
|   `-- app.json              # Expo application configuration
|-- backend/                  # Express REST service
|   |-- prisma/               # Schema and migrations
|   `-- src/
|       |-- controllers/      # AI request orchestration
|       |-- middleware/       # Clerk authentication
|       |-- routes/           # Books, shelves, AI, chat, storage and catalogue APIs
|       `-- services/         # Catalogue seeding
`-- docker-compose.yml        # Local backend and Redis composition
```

## Run locally

### Prerequisites

- Node.js 20 or newer
- npm
- Android device with Expo Go or an Android emulator
- PostgreSQL and Redis, either managed services or Docker
- Credentials for the integrations you choose to enable

### 1. Start the backend

```bash
cd backend
npm install
```

Create `backend/.env` and provide the required values. At minimum, configure the database, Redis, Clerk and CORS settings for the features you plan to use.

```bash
npx prisma generate
npx prisma migrate deploy
npm run dev
```

The API listens on port `3001` by default. Confirm it is running at:

```text
http://localhost:3001/health
```

### 2. Start the mobile client

```bash
cd ../frontend
npm install
npx expo start
```

Use Expo Go to scan the displayed QR code, or start an Android emulator. When testing on a physical device, set the client API base URL to a backend address reachable from that device on the same network.

### Optional: run the backend with Docker

```bash
docker compose up --build
```

## Environment variables

Do not commit `.env` files or credentials. The backend uses these integrations when configured:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL` | PostgreSQL connection strings |
| `REDIS_URL` | Redis cache connection |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | Server-side authentication |
| `GEMINI_API_KEY` | Text assistance and recap generation |
| `HF_TOKEN` | Hugging Face image-generation access |
| `CF_IMAGE_URL`, `CF_IMAGE_KEY` | Cloudflare image-generation fallback |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Optional EPUB backup storage |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Test-mode checkout and signature verification |
| `CORS_ORIGIN`, `PORT`, `NODE_ENV` | Service configuration |

The client requires `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for Clerk authentication.

## API areas

All application routes are mounted under `/api`; all except `/health` require an authenticated bearer token.

| Area | Examples |
| --- | --- |
| User | `POST /api/users/sync`, `GET /api/users/me` |
| Library | Books, progress, highlights, summaries and recaps |
| Organisation | Shelves and cross-library highlights |
| AI | Passage queries and scene visualisation |
| Conversations | Chat sessions and messages for a book |
| Storage | Optional EPUB upload and signed download URLs |
| Catalogue | Featured books, search, subjects, refresh and status |
| Purchases | Create order, verify payment and purchase history |

## Engineering notes and current limitations

- The project was verified manually on Android; it does not yet include an automated test suite.
- The reader experience has been tested for Android. iOS support is configured but not yet validated end to end.
- AI answers are based on the selected passage and the provided reading progress. Folio does not yet build an on-device retrieval index over the complete EPUB.
- The catalogue scraper depends on the upstream Standard Ebooks page structure.
- The checkout flow is intended for demonstration and uses Razorpay test-mode credentials.

## Suggested next steps

1. Add unit, integration and end-to-end tests for book identification, API routes and the import-to-reader flow.
2. Package the EPUB rendering assets with the app to remove the first-launch network dependency.
3. Add on-device retrieval over each imported book for stronger context while retaining the privacy model.
4. Validate the full application on iOS and improve cross-device conflict handling for reading progress.

## Project report

The accompanying summer-internship report describes the motivation, design decisions, implementation, evaluation and future scope in detail.
