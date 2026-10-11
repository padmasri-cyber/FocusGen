# FocusGen 🌿📷

**Eco-Adaptive Visual Intelligence Platform & Keyless AI Image Assistant**

FocusGen is an eco-adaptive visual intelligence web application built on the principle of **"Focus + Energy + Photorealism"**. It saves up to 99.9% energy by prioritizing free, reusable licensed photographs from keyless databases (Wikimedia Commons & Openverse), purpose-adapted Sharp compression, and smart focus clarity region detection before falling back to photorealistic DSLR AI image generation.

---

## Features

- **Keyless AI Generation**: Built-in support for Pollinations FLUX (`IMAGE_PROVIDER=pollinations`) requiring **no API keys**.
- **15-Second Spacing Queue**: Automatic server-side queueing prevents rate-limiting on anonymous tiers and displays real-time queue position in chat.
- **Instant Dual-Tier Caching**: In-memory and disk cache (`data/ai_cache/`) keyed by `(word, purpose, size)`. Cached requests load in **<10ms**.
- **Smart Focus Clarity Regions**: High clarity on critical subjects and energy-saving compression on backgrounds using sharp saliency detection.
- **Web-First Fallback Chain**: Pollinations / Cloudflare $\rightarrow$ Wikimedia Commons & Openverse licensed photos. Never crashes, never displays raw errors.
- **Purpose-Adapted Dimensions**: Automatically sizes to minimum required dimensions:
  - Phone chat: **640×360**
  - Project/School: **1024×576**
  - Poster: **1280×720**
  - Print: **1920×1080**
- **Demo Mode**: Instant presentation mode using only cached images and licensed web photos with zero external AI calls.
- **Honest Energy & Cost Estimation**: Transparent energy estimations and source attribution on every image (`Pollinations (AI)`, `Cloudflare (AI)`, `Web photo`, or `Cached`).

---

## Local Development

### 1. Prerequisites
- **Node.js**: Version 18 or higher (`node -v`)
- **npm**: Version 8 or higher (`npm -v`)

### 2. Installation
Clone the repository and install all dependencies:
```bash
git clone https://github.com/padmasri-cyber/FocusGen.git
cd FocusGen
npm install
```

### 3. Environment Setup
Copy the template environment file:
```bash
cp .env.example .env
```
*(Even with all variables empty, FocusGen runs out-of-the-box using the keyless Pollinations provider and licensed photo search).*

### 4. Demo Warmup (Pre-Caching)
Pre-generate demo requests (`cake`, `temple`, `tiger`) so they load instantly:
```bash
npm run warmup
```

### 5. Start the Server
```bash
npm start
```
Access the application at:
```
http://localhost:3000
```

---

## Environment Variables Reference

All environment variables can be configured in `.env` (or via the host dashboard in production):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port on which the Express server listens. |
| `NODE_ENV` | `development` | Set to `production` on live hosting for secure cookies and optimized headers. |
| `JWT_SECRET` | Auto fallback | Secret key used for signing session JWT authentication tokens. |
| `IMAGE_PROVIDER` | `pollinations` | Primary AI provider: `pollinations` (keyless Flux), `cloudflare`, `gemini`, or `none`. |
| `CLOUDFLARE_ACCOUNT_ID` | *Empty* | Cloudflare account ID (optional, for Cloudflare Workers AI). |
| `CLOUDFLARE_API_TOKEN` | *Empty* | Cloudflare API token with Workers AI permissions. |
| `CLOUDFLARE_IMAGE_MODEL` | `@cf/black-forest-labs/flux-1-schnell` | Model override for Cloudflare Workers AI. |
| `GEMINI_API_KEY` | *Empty* | Google Gemini API key (optional). |
| `IMAGE_MODEL` | `gemini-2.5-flash-image` | Model identifier for Gemini AI. |
| `DB_PATH` | `./data/focusgen.db` | File path for SQLite persistence database. |
| `GOOGLE_CLIENT_ID` | *Empty* | Google OAuth Client ID for sign-in (optional). |
| `CORS_ORIGIN` | *Same-origin* | Comma-separated list of allowed CORS origins or `*`. Defaults to same-origin. |

---

## Deploying on Render (Free Web Service)

FocusGen includes a ready-to-use [`render.yaml`](render.yaml) blueprint for one-click deployment.

### Method A: Blueprint Deployment
1. Push your repository to GitHub.
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** $\rightarrow$ **Blueprint**.
4. Connect `https://github.com/padmasri-cyber/FocusGen.git`.
5. Render automatically configures:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
6. Click **Apply**.

### Method B: Manual Web Service
1. In the Render Dashboard, click **New +** $\rightarrow$ **Web Service**.
2. Connect your GitHub repository.
3. Configure the settings:
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
4. In **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `IMAGE_PROVIDER`: `pollinations`
   - `JWT_SECRET`: *(A long random string)*

---

## Free-Tier Hosting Limits & Behavior

When deploying on Render's free tier, keep the following host limitations in mind:

> [!WARNING]
> **Ephemeral Storage & Database Resets**:
> Free cloud instances feature ephemeral disks. Any time the web service restarts, sleeps, or redeploys, files written to disk (including the SQLite database at `./data/focusgen.db` and upload folders) will reset. FocusGen is architected to safely handle missing or reset databases by **automatically recreating all tables and schemas on startup** without throwing errors. For permanent persistence across restarts, attach a persistent Render Disk or configure an external database.

> [!NOTE]
> **Inactivity Sleep (Spin-down)**:
> Free web services spin down after 15 minutes of inactivity. When a new visitor accesses your deployed URL, Render spins the container back up. This initial "cold start" request may take 30 to 50 seconds to respond. Subsequent requests respond instantly.

> [!TIP]
> **Pollinations Rate Limiting**:
> Pollinations anonymous tier operates with approximately one request every 15 seconds. FocusGen handles this transparently with an automated server-side queue ([`aiQueue.js`](aiQueue.js)) that displays the user's position in queue while instantly serving licensed web photos in the foreground.

---

## REST API Endpoints

- `GET /api/health` - Health check status (`{ "status": "ok", ... }`).
- `POST /api/chat` - Unified chat query (instant web photos + background AI generation).
- `GET /api/ai-job/:id` - Background AI generation queue polling endpoint.
- `POST /api/auth/signup` - Register a new account.
- `POST /api/auth/login` - User login with HttpOnly secure session cookie.
- `POST /api/auth/guest` - Ephemeral guest session (up to 5 free generations).
- `POST /api/auth/logout` - Clear session authentication cookies.
- `GET /api/auth/me` - Authenticated user profile and settings.
- `POST /api/search-licensed` - Direct search on Wikimedia Commons & Openverse.
- `POST /api/focus/apply` - Run smart focus clarity pipeline with Sharp.
