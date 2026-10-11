# FocusGen 🌿📷

**Eco-Adaptive AI Image Generator & Licensed Visual Intelligence Chatbot**

FocusGen is a production application designed around the concept of **"Focus + Energy + Photorealism"**. It saves up to 99.9% energy by prioritizing free, reusable licensed photographs from keyless databases (Wikimedia Commons & Openverse) and purpose-adapted Sharp compression before falling back to photorealistic DSLR AI image synthesis.

---

## Architecture Overview

FocusGen is divided into an Express-based Node.js backend with SQLite persistence and a responsive, ChatGPT-style frontend client:

```
focusgen/
├── server.js           # Express.js REST API server & static host
├── db.js               # SQLite database layer (better-sqlite3)
├── webSearch.js        # Keyless search engine (Wikimedia Commons + Openverse)
├── estimate.js         # Eco mathematical energy & carbon cost engine
├── app.js              # Client application & conversational chatbot logic
├── index.html          # ChatGPT-style web interface & modals
├── style.css           # Modern dark & light blue theme design system
├── test_suite.js       # 11-step integration & verification test suite
├── start.bat           # One-click Windows backend launcher
├── start.sh            # One-click macOS / Linux launcher
├── data/
│   └── focusgen.db     # SQLite persistence database
└── uploads/            # User-uploaded documents and images
```

---

## Backend Services & Modules

### 1. Web-First Keyless Image Search ([`webSearch.js`](webSearch.js))
- **Wikimedia Commons API**: Queries `commons.wikimedia.org` and `en.wikipedia.org` for authentic public domain & Creative Commons photographs.
- **Openverse API**: Parallel query against millions of open-licensed photographs.
- **Strict Quality Filtering**: Rejects non-photographic artifacts (drawings, logos, maps, cliparts, cartoons, icons) and enforces minimum resolution per purpose.
- **Reusable Licenses**: Accepts only CC0, Public Domain, CC BY, and CC BY-SA (rejects No-Derivatives licenses since images are resized and compressed).
- **24-Hour Memory Cache**: Prevents duplicate network roundtrips.

### 2. SQLite Database ([`db.js`](db.js))
- Automated schema migrations stored at `data/focusgen.db`.
- **Tables**: `users`, `chats`, `messages`, `uploads`.
- Supports user authentication, guest limits (5 free generations), chat history persistence, and user settings (theme, mode, language).

### 3. Smart Compress & Sharp Engine ([`server.js`](server.js))
- Server-side image resizing and compression powered by **Sharp**.
- Output formats: optimized WebP with tailored compression quality per purpose (`chat` 360p, `school` 720p, `poster` 900p, `print` 1080p).
- Direct SVG banner compositing via `GET /api/download-attributed` to embed permanent copyright and attribution on downloaded images.

### 4. Eco Energy & Carbon Engine ([`estimate.js`](estimate.js))
- Mathematical calculation of Wh, execution duration, and avoided CO₂ emissions.
- Calibrated against GPU MLPerf benchmarks: `Cost(Wh) = Σ zone[ pixels × steps × ENERGY_PER_PIXEL_STEP ] + overhead`.
- Every image result displays a compact cost chip: `Estimated 0.006 Wh · 0.3 s · 99.9% less than Max (1080p)`.

### 5. Document & File Analysis ([`server.js`](server.js))
- Uploads handled via **Multer**.
- PDF text extraction with **pdf-parse** and Word documents with **mammoth**.
- Extracted text is analyzed to suggest 3 visual photography prompt concepts.

---

## Quick Start / Running the Backend

### Windows (One-Click)
Double-click [`start.bat`](start.bat) in the project directory. It launches the backend server at `http://localhost:3000` and opens your default browser automatically.

### Terminal (npm)
1. Install dependencies (if not already installed):
   ```bash
   npm install
   ```
2. Start the backend:
   ```bash
   npm start
   ```
   Or for development:
   ```bash
   npm run dev
   ```
3. Open your browser at:
   ```
   http://localhost:3000
   ```

### Running Tests
Run the comprehensive 11-step integration test suite:
```bash
npm test
```

---

## REST API Reference

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | System status, version, uptime, and database check | No |
| `POST` | `/api/chat` | Unified chat workflow (search, greetings, AI generation, cost chip) | No |
| `GET` | `/api/config` | Provider configuration and active AI model info | No |
| `POST` | `/api/auth/signup` | Register new user account (`email`, `password`) | No |
| `POST` | `/api/auth/login` | Login and set HttpOnly JWT session cookie | No |
| `POST` | `/api/auth/guest` | Start a quick guest session (up to 5 generations) | No |
| `POST` | `/api/auth/logout` | Clear session cookie | No |
| `GET` | `/api/auth/me` | Retrieve current authenticated user profile | Yes |
| `POST` | `/api/user/settings` | Save user preferences (theme, language, mode) | Yes |
| `GET` | `/api/chats` | List user chat sessions | Yes |
| `POST` | `/api/chats` | Create a new chat session | Yes |
| `GET` | `/api/chats/:id` | Fetch chat details and message history | Yes |
| `PATCH` | `/api/chats/:id` | Rename chat session | Yes |
| `DELETE` | `/api/chats/:id` | Delete chat session | Yes |
| `POST` | `/api/chats/:id/messages` | Append message to chat | Yes |
| `POST` | `/api/search-licensed` | Keyless search on Wikimedia Commons & Openverse | No |
| `POST` | `/api/compress` | Sharp server-side resizing & WebP compression | No |
| `GET` | `/api/download-attributed` | Download image with embedded attribution banner | No |
| `POST` | `/api/generate` | AI photorealistic generation via Google Gemini | Optional |
| `POST` | `/api/upload` | Upload and extract visual ideas from PDF/Word/Image | Optional |
| `GET` | `/api/uploads` | Retrieve user uploads history | Yes |
| `DELETE` | `/api/uploads/:id` | Delete uploaded file | Yes |

---

## Environment Variables (`.env`)

```ini
PORT=3000
JWT_SECRET=your_jwt_secret_key_here

# Google Gemini API Key (Optional AI generation fallback)
GEMINI_API_KEY=your_key_here
IMAGE_MODEL=gemini-2.5-flash-image

# (Optional) Google OAuth
GOOGLE_CLIENT_ID=
```
*Note: Image search runs 100% keyless using built-in Wikimedia Commons and Openverse integrations.*
