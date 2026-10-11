// FocusGen Production Express Backend Server
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const https = require('https');
const db = require('./db');
const estimate = require('./estimate');
const webSearch = require('./webSearch');
const purposeEngine = require('./purpose');
const focusEngine = require('./focus');
const aiCache = require('./aiCache');
const aiQueue = require('./aiQueue');

/**
 * Robust IPv4 JSON fetcher that avoids Windows IPv6 connect timeouts
 */
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      family: 4,
      headers: {
        'User-Agent': 'FocusGen-EcoApp/1.0 (contact@focusgen.local)',
        ...headers
      }
    }, (res) => {
      if (res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

function getCleanDirectUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('wikimedia.org') && url.includes('/thumb/')) {
    const match = url.match(/(https?:\/\/[^\/]+\/wikipedia\/commons\/)thumb\/([^\/]+\/[^\/]+\/[^\/]+)\/.*$/i);
    if (match) {
      return 'https://upload.wikimedia.org/wikipedia/commons/' + match[2];
    }
  }
  return url;
}

/**
 * Robust IPv4 Binary fetcher with redirect following for Sharp operations
 */
function fetchBuffer(url, maxRedirects = 5, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return reject(new Error('Invalid URL'));
    }
    const client = url.startsWith('http:') ? require('http') : https;
    const req = client.get(url, {
      family: 4,
      headers: {
        'User-Agent': 'FocusGenApp/2.0 (https://focusgen.local; contact@focusgen.local; open-licensed-media-client)',
        'Accept': 'image/*,*/*'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const parsed = new URL(url);
          redirectUrl = new URL(redirectUrl, parsed.origin).href;
        }
        return fetchBuffer(redirectUrl, maxRedirects - 1, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) {
        // If thumbnail failed, try direct canonical URL
        const directUrl = getCleanDirectUrl(url);
        if (directUrl !== url) {
          return fetchBuffer(directUrl, maxRedirects, timeoutMs).then(resolve).catch(reject);
        }
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', (err) => {
      const directUrl = getCleanDirectUrl(url);
      if (directUrl !== url) {
        return fetchBuffer(directUrl, maxRedirects, timeoutMs).then(resolve).catch(reject);
      }
      reject(err);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Connection timeout'));
    });
  });
}

const app = express();
app.set('trust proxy', 1);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'focusgen_default_fallback_jwt_secret_2026';
const isProduction = process.env.NODE_ENV === 'production';

// Allowed CORS origins from environment variable (default: same-origin)
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Production-ready cookie configuration
const authCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? (allowedOrigins.length > 0 ? 'none' : 'lax') : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

// Create uploads directory
const uploadsBaseDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsBaseDir)) {
  fs.mkdirSync(uploadsBaseDir, { recursive: true });
}

// CORS Middleware (reads from CORS_ORIGIN env var, defaults to same-origin)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    let allow = false;
    if (allowedOrigins.length > 0) {
      allow = allowedOrigins.includes('*') || allowedOrigins.includes(origin);
    } else {
      // Default to same-origin
      const host = req.headers.host;
      if (host && origin.includes(host)) {
        allow = true;
      }
    }
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Middleware
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// GET /api/health - System Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    port: PORT,
    database: 'sqlite_connected',
    providers: ['Wikimedia Commons', 'Openverse', 'Pollinations FLUX'],
    aiEngine: process.env.IMAGE_PROVIDER || 'pollinations',
    compressionEngine: 'sharp',
    uptime: Math.floor(process.uptime())
  });
});

// Rate Limiter for Login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 attempts
  message: { success: false, error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Authentication Middleware: extracts JWT from focusgen_token cookie
 */
function authMiddleware(req, res, next) {
  const token = req.cookies.focusgen_token;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.findUserById(decoded.userId);
    req.user = user || null;
  } catch (err) {
    req.user = null;
  }
  next();
}

app.use(authMiddleware);

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

function sanitizeMessage(msg, ...keys) {
  if (!msg || typeof msg !== 'string') return 'An error occurred';
  let cleaned = msg;
  const envSecrets = [
    process.env.CLOUDFLARE_API_TOKEN,
    process.env.CLOUDFLARE_ACCOUNT_ID,
    process.env.GEMINI_API_KEY,
    process.env.JWT_SECRET,
    ...keys
  ];
  for (const secret of envSecrets) {
    if (secret && typeof secret === 'string' && secret.trim().length > 4) {
      cleaned = cleaned.replaceAll(secret.trim(), '[REDACTED_KEY]');
    }
  }
  cleaned = cleaned.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED_TOKEN]');
  return cleaned;
}

/**
 * Short photorealistic prompt (under 60 words) to reduce latency
 */
function expandPhotorealisticPrompt(word, purpose) {
  const cleanWord = (word || 'subject').trim();
  return `${cleanWord}, photorealistic, natural lighting, DSLR photo, no cartoon, no illustration`;
}

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !email.includes('@') || !password || password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid email and password with at least 6 characters.'
    });
  }

  const existing = db.findUserByEmail(email);
  if (existing) {
    return res.status(409).json({
      success: false,
      error: 'An account with this email already exists. Please log in.'
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.createUser(email, passwordHash);

  const token = jwt.sign(
    { userId: user.id, isGuest: false, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('focusgen_token', token, authCookieOptions);

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      isGuest: false,
      guestGenerations: 0,
      settings: user.settings
    }
  });
});

// POST /api/auth/login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const user = db.findUserByEmail(email);
  if (!user || user.is_guest || !user.password_hash) {
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }

  const token = jwt.sign(
    { userId: user.id, isGuest: false, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('focusgen_token', token, authCookieOptions);

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      isGuest: false,
      guestGenerations: user.guest_generations,
      settings: user.settings
    }
  });
});

// POST /api/auth/guest
app.post('/api/auth/guest', (req, res) => {
  // If user already has a guest session, reuse it
  if (req.user && req.user.is_guest) {
    return res.json({
      success: true,
      user: {
        id: req.user.id,
        email: null,
        isGuest: true,
        guestGenerations: req.user.guest_generations,
        settings: req.user.settings
      }
    });
  }

  const guest = db.createGuestUser();
  const token = jwt.sign(
    { userId: guest.id, isGuest: true, email: null },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('focusgen_token', token, authCookieOptions);

  res.json({
    success: true,
    user: {
      id: guest.id,
      email: null,
      isGuest: true,
      guestGenerations: 0,
      settings: guest.settings
    }
  });
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.json({ success: false, user: null });
  }
  res.json({
    success: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      isGuest: !!req.user.is_guest,
      guestGenerations: req.user.guest_generations || 0,
      settings: req.user.settings || {}
    }
  });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('focusgen_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? (allowedOrigins.length > 0 ? 'none' : 'lax') : 'lax'
  });
  res.json({ success: true });
});

// POST /api/user/settings
app.post('/api/user/settings', requireAuth, (req, res) => {
  const settings = req.body || {};
  const updated = db.updateUserSettings(req.user.id, settings);
  res.json({ success: true, settings: updated });
});

// ============================================================================
// CLOUDFLARE WORKERS AI & MODEL SELECTION HELPERS
// ============================================================================

/**
 * Read the active Cloudflare model from CLOUDFLARE_IMAGE_MODEL in .env.
 * Never hard-code or silently switch the model.
 * If empty, default to @cf/black-forest-labs/flux-1-schnell and log the default.
 */
function getCloudflareModel() {
  const envModel = (process.env.CLOUDFLARE_IMAGE_MODEL || '').trim();
  if (envModel) {
    return envModel;
  }
  console.log('[Cloudflare Workers AI] CLOUDFLARE_IMAGE_MODEL is empty in .env; defaulting to @cf/black-forest-labs/flux-1-schnell');
  return '@cf/black-forest-labs/flux-1-schnell';
}

function getCloudflareFallbackModel() {
  return (process.env.CLOUDFLARE_FALLBACK_MODEL || '').trim();
}

function getAvailableCloudflareModels() {
  const primary = getCloudflareModel();
  const fallback = getCloudflareFallbackModel();
  const list = [primary];
  if (fallback && fallback !== primary) {
    list.push(fallback);
  }
  return list;
}

// ============================================================================
// CLOUDFLARE ALLOCATION GUARD & IN-MEMORY LOCK STATE (Error 3036 & 429)
// ============================================================================

function getNextUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return next.getTime();
}

let aiAllocationLock = {
  blocked: false,
  reason: null,
  errorCode: null,
  blockedUntil: 0,
  resetTimeLabel: '00:00 UTC (5:30 AM IST)',
  message: ''
};

function isAiBlocked(forProvider = null) {
  const currentProvider = (forProvider || process.env.IMAGE_PROVIDER || 'pollinations').toLowerCase().trim();
  if (currentProvider !== 'cloudflare') {
    return false;
  }
  return !!aiAllocationLock.blocked;
}

function isAfterResetTime() {
  if (!aiAllocationLock.blocked) return true;
  return Date.now() >= aiAllocationLock.blockedUntil;
}

function setAiBlocked3036(customMessage = null) {
  const nextUtc = getNextUtcMidnight();
  aiAllocationLock = {
    blocked: true,
    reason: 'error_3036',
    errorCode: 3036,
    blockedUntil: nextUtc,
    resetTimeLabel: '00:00 UTC (5:30 AM IST)',
    message: customMessage || 'Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).'
  };
  console.log(`[Cloudflare AI Guard] Error 3036 triggered! AI blocked until next 00:00 UTC (${new Date(nextUtc).toISOString()}). All AI calls will be skipped.`);
  return aiAllocationLock;
}

function clearAiBlocked() {
  console.log('[Cloudflare AI Guard] Clearing AI allocation block flag following successful manual verification.');
  aiAllocationLock = {
    blocked: false,
    reason: null,
    errorCode: null,
    blockedUntil: 0,
    resetTimeLabel: '00:00 UTC (5:30 AM IST)',
    message: ''
  };
  return aiAllocationLock;
}

/**
 * Parse real Cloudflare error details and categorize without leaking tokens or keys.
 * Differentiates: 429 quota/rate limit (and Error 3036 allocation exhausted),
 * 401/403 token/permission, 404 model not found, 5xx outage, network/timeout.
 */
function parseCloudflareError(status, rawBody, model) {
  let realError = '';
  let errorCode = null;

  try {
    const parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    if (parsed && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      realError = parsed.errors.map(e => e.message || String(e)).join('; ');
      errorCode = parsed.errors[0]?.code || null;
    } else if (parsed && parsed.error) {
      realError = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
    } else if (parsed && parsed.messages && parsed.messages.length > 0) {
      realError = parsed.messages.map(m => m.message || String(m)).join('; ');
    }
  } catch (_) {
    if (typeof rawBody === 'string') {
      realError = rawBody.slice(0, 300);
    }
  }

  // Never leak keys or tokens or raw account credentials
  const cfToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const cfAccount = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  realError = sanitizeMessage(realError, cfToken);
  if (cfAccount && realError.includes(cfAccount)) {
    realError = realError.replace(new RegExp(cfAccount, 'gi'), '[ACCOUNT_ID]');
  }

  let category = 'api_error';
  let categoryLabel = `HTTP ${status} Error`;
  let userExplanation = '';

  const is3036 = errorCode === 3036 ||
                 String(rawBody).includes('3036') ||
                 realError.includes('3036') ||
                 (status === 429 && (realError.toLowerCase().includes('allocation') || realError.toLowerCase().includes('neuron') || realError.toLowerCase().includes('daily free')));

  if (is3036) {
    category = 'quota_rate_limit';
    categoryLabel = '429 Daily Allocation Exhausted (Error 3036)';
    userExplanation = 'Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).';
    setAiBlocked3036(userExplanation);
  } else if (status === 429) {
    category = 'quota_rate_limit';
    categoryLabel = '429 Quota / Rate Limit';
    userExplanation = 'Daily allocation of neurons exhausted or request rate limit exceeded. Web photos are automatically displayed.';
  } else if (status === 401 || status === 403) {
    category = 'auth_permission';
    categoryLabel = `${status} Token / Permission Problem`;
    userExplanation = 'Cloudflare API token is invalid, expired, or missing "Workers AI: Read" permissions.';
  } else if (status === 404 || (status === 400 && realError.toLowerCase().includes('no route'))) {
    category = 'model_not_found';
    categoryLabel = `${status} Model Not Found`;
    userExplanation = `The model "${model}" or AI route was not found in your Cloudflare account. Check CLOUDFLARE_IMAGE_MODEL in .env.`;
  } else if (status >= 500 && status <= 599) {
    category = 'cloudflare_outage';
    categoryLabel = `${status} Cloudflare Outage`;
    userExplanation = `Cloudflare Workers AI servers encountered an internal error (${status}). Workers AI infrastructure may be degraded.`;
  } else {
    category = 'api_error';
    categoryLabel = `HTTP ${status} API Error`;
    userExplanation = `Cloudflare returned HTTP ${status}: ${realError || 'Unexpected response'}`;
  }

  return {
    status,
    category,
    categoryLabel,
    errorCode,
    is3036,
    realError: realError || userExplanation,
    userExplanation
  };
}

// GET /api/config
app.get('/api/config', (req, res) => {
  const provider = (process.env.IMAGE_PROVIDER || 'cloudflare').toLowerCase().trim();
  const cfAccountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const cfApiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const cfModel = getCloudflareModel();
  const cfFallback = getCloudflareFallbackModel();
  const cfModels = getAvailableCloudflareModels();
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const hasGemini = geminiKey.length > 5 && geminiKey !== 'PASTE_YOUR_KEY_HERE';

  res.json({
    provider,
    hasCloudflare: cfAccountId.length > 5 && cfApiToken.length > 5,
    cloudflareModel: cfModel,
    cloudflareFallbackModel: cfFallback,
    cloudflareModels: cfModels,
    hasGemini,
    geminiModel: (process.env.IMAGE_MODEL || 'gemini-2.5-flash-image').trim(),
    hasGoogleAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID.trim()),
    keylessProviders: ['Wikimedia Commons', 'Openverse', 'Pollinations AI'],
    aiBlocked: isAiBlocked(provider),
    blockedUntil: isAiBlocked(provider) ? aiAllocationLock.blockedUntil : 0,
    resetTimeLabel: aiAllocationLock.resetTimeLabel,
    aiBlockedMessage: isAiBlocked(provider) ? aiAllocationLock.message : '',
    isAfterResetTime: isAfterResetTime()
  });
});

// GET and POST /api/diagnose - Diagnose AI Engine
async function handleDiagnose(req, res) {
  const provider = (process.env.IMAGE_PROVIDER || 'pollinations').toLowerCase().trim();
  const cfAccountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const cfApiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const availableModels = getAvailableCloudflareModels();

  // Selected probe model from query, body, or default from .env
  const requestedModel = (req.query?.model || req.body?.model || '').trim();
  const cfModel = requestedModel || getCloudflareModel();

  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const geminiModel = (process.env.IMAGE_MODEL || 'gemini-2.5-flash-image').trim();

  let keyLoaded = false;
  let modelReachable = false;
  let status = 'error';
  let httpStatus = null;
  let category = 'unknown';
  let categoryLabel = 'Unknown';
  let realError = null;
  let message = '';
  let modelName = '';
  let clearedBlock = false;

  if (provider === 'pollinations') {
    modelName = 'flux (Pollinations FLUX)';
    keyLoaded = true;
    modelReachable = true;
    status = 'ok';
    httpStatus = 200;
    category = 'ok';
    categoryLabel = 'Keyless AI Operational';
    message = 'Pollinations FLUX is active and keyless. 15-second rate limiting queue is protecting anonymous access.';
    return res.json({
      provider: 'pollinations',
      model: 'flux',
      availableModels: ['flux'],
      keyLoaded: true,
      modelReachable: true,
      httpStatus: 200,
      category: 'ok',
      categoryLabel: 'Keyless AI Operational',
      status: 'ok',
      blocked: false,
      message
    });
  }

  if (provider === 'cloudflare') {
    modelName = cfModel;
    keyLoaded = cfAccountId.length > 5 && cfApiToken.length > 5;
    if (!keyLoaded) {
      status = 'error';
      httpStatus = 400;
      category = 'auth_permission';
      categoryLabel = 'Missing Credentials';
      realError = 'Missing Cloudflare credentials in .env (CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN).';
      message = realError;
    } else if (isAiBlocked() && !isAfterResetTime()) {
      // Still blocked before 00:00 UTC! Never call Cloudflare API.
      return res.json({
        provider,
        model: cfModel,
        availableModels,
        keyLoaded: true,
        modelReachable: false,
        httpStatus: 429,
        category: 'quota_rate_limit',
        categoryLabel: '429 Daily Allocation Exhausted (Error 3036)',
        realError: aiAllocationLock.message,
        status: 'blocked',
        blocked: true,
        blockedUntil: aiAllocationLock.blockedUntil,
        resetTimeLabel: aiAllocationLock.resetTimeLabel,
        message: aiAllocationLock.message,
        canRetest: false
      });
    } else {
      try {
        const testEndpoint = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${cfModel}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const probeRes = await fetch(testEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfApiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prompt: 'test probe', steps: 1 }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        httpStatus = probeRes.status;

        if (probeRes.ok) {
          modelReachable = true;
          status = 'ok';
          category = 'ok';
          categoryLabel = 'Operational';
          realError = null;
          if (isAiBlocked()) {
            clearAiBlocked();
            clearedBlock = true;
            message = `Cloudflare Workers AI (${cfModel}) is online and reachable. HTTP 200 OK. Allocation lock cleared!`;
          } else {
            message = `Cloudflare Workers AI (${cfModel}) is online and reachable. HTTP 200 OK.`;
          }
        } else {
          modelReachable = false;
          status = 'error';
          const errText = await probeRes.text().catch(() => '');
          const cfErr = parseCloudflareError(probeRes.status, errText, cfModel);
          category = cfErr.category;
          categoryLabel = cfErr.categoryLabel;
          realError = cfErr.realError;
          message = `${cfErr.categoryLabel}: ${cfErr.realError}`;
        }
      } catch (err) {
        modelReachable = false;
        status = 'error';
        if (err.name === 'AbortError') {
          httpStatus = 504;
          category = 'network_timeout';
          categoryLabel = 'Network Timeout';
          realError = 'Connection timed out after 15s while probing Cloudflare Workers AI.';
        } else {
          httpStatus = 0;
          category = 'network_error';
          categoryLabel = 'Network Error';
          realError = `Network connection error: ${sanitizeMessage(err.message, cfApiToken)}`;
        }
        message = `${categoryLabel}: ${realError}`;
      }
    }
  } else if (provider === 'gemini') {
    modelName = geminiModel;
    keyLoaded = geminiKey.length > 5 && geminiKey !== 'PASTE_YOUR_KEY_HERE';
    if (!keyLoaded) {
      status = 'error';
      httpStatus = 400;
      category = 'auth_permission';
      categoryLabel = 'Missing Key';
      realError = 'Gemini API key is not configured in .env. Please fill in GEMINI_API_KEY.';
      message = realError;
    } else {
      try {
        const testEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}?key=${geminiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        const probeRes = await fetch(testEndpoint, { signal: controller.signal });
        clearTimeout(timeoutId);

        httpStatus = probeRes.status;
        if (probeRes.ok) {
          modelReachable = true;
          status = 'ok';
          category = 'ok';
          categoryLabel = 'Operational';
          realError = null;
          message = `Google Gemini (${geminiModel}) is online and reachable.`;
        } else {
          modelReachable = false;
          status = 'error';
          const errText = await probeRes.text().catch(() => '');
          realError = sanitizeMessage(errText, geminiKey);
          if (probeRes.status === 429) {
            category = 'quota_rate_limit';
            categoryLabel = '429 Quota Exceeded';
            realError = 'HTTP 429: No image quota remaining on this Gemini API key.';
          } else if (probeRes.status === 401 || probeRes.status === 403) {
            category = 'auth_permission';
            categoryLabel = `${probeRes.status} Invalid Key`;
          } else {
            category = 'api_error';
            categoryLabel = `HTTP ${probeRes.status}`;
          }
          message = `${categoryLabel}: ${realError}`;
        }
      } catch (err) {
        modelReachable = false;
        status = 'error';
        httpStatus = err.name === 'AbortError' ? 504 : 0;
        category = err.name === 'AbortError' ? 'network_timeout' : 'network_error';
        categoryLabel = err.name === 'AbortError' ? 'Network Timeout' : 'Network Error';
        realError = err.message;
        message = `${categoryLabel}: ${realError}`;
      }
    }
  } else if (provider === 'none') {
    modelName = 'None (Web Photography Only)';
    keyLoaded = true;
    modelReachable = true;
    status = 'ok';
    httpStatus = 200;
    category = 'ok';
    categoryLabel = 'Web Photography Active';
    realError = null;
    message = 'AI image generation is disabled (IMAGE_PROVIDER=none). Operating in keyless open photography mode (Wikimedia Commons & Openverse).';
  } else {
    modelName = 'Unknown';
    keyLoaded = false;
    modelReachable = false;
    status = 'error';
    httpStatus = 400;
    category = 'api_error';
    categoryLabel = 'Configuration Error';
    realError = `Unknown IMAGE_PROVIDER="${provider}". Set IMAGE_PROVIDER=cloudflare, gemini, or none.`;
    message = realError;
  }

  res.json({
    provider,
    model: modelName,
    availableModels,
    keyLoaded,
    modelReachable,
    httpStatus,
    category,
    categoryLabel,
    realError,
    status,
    error: realError,
    message
  });
}

app.get('/api/diagnose', handleDiagnose);
app.post('/api/diagnose', handleDiagnose);

// POST /api/infer - Deterministic Purpose & Tier Inference Engine
app.post('/api/infer', async (req, res) => {
  const { request, context = {} } = req.body || {};
  if (!request || typeof request !== 'string') {
    return res.status(400).json({ success: false, error: 'Request string is required' });
  }

  try {
    const userId = req.user ? req.user.id : null;
    const isGuest = req.user ? !!req.user.is_guest : true;
    const result = await purposeEngine.inferPurpose(request, {
      ...context,
      userId,
      isGuest,
      db
    });
    res.json(result);
  } catch (err) {
    console.error('Inference error:', err);
    res.status(500).json({ success: false, error: 'Failed to infer purpose: ' + err.message });
  }
});

// POST /api/override - Learn from User Override (Logged in users only)
app.post('/api/override', (req, res) => {
  const { keyword, proposedPurpose, chosenPurpose } = req.body || {};
  if (!keyword || !chosenPurpose) {
    return res.status(400).json({ success: false, error: 'keyword and chosenPurpose are required' });
  }

  if (!req.user || req.user.is_guest) {
    // Guests do not persist overrides
    return res.json({ success: true, saved: false, reason: 'guest' });
  }

  try {
    const id = db.recordOverride(req.user.id, keyword, proposedPurpose || 'school', chosenPurpose);
    res.json({ success: true, saved: true, id });
  } catch (err) {
    console.error('Error recording override:', err);
    res.status(500).json({ success: false, error: 'Failed to save override' });
  }
});

// POST /api/override/reset - Reset User's Override History
app.post('/api/override/reset', requireAuth, (req, res) => {
  if (req.user.is_guest) {
    return res.json({ success: true });
  }
  db.resetUserOverrides(req.user.id);
  res.json({ success: true, message: 'All purpose preferences have been reset.' });
});

// GET /api/override - Get User's Override History
app.get('/api/override', requireAuth, (req, res) => {
  if (req.user.is_guest) {
    return res.json({ success: true, overrides: [] });
  }
  const overrides = db.getUserOverrides(req.user.id);
  res.json({ success: true, overrides });
});

// ============================================================================
// CHAT & MESSAGE ROUTES
// ============================================================================

// GET /api/chats
app.get('/api/chats', requireAuth, (req, res) => {
  if (req.user.is_guest) {
    // Guest chats are not saved in sidebar history
    return res.json({ success: true, chats: [] });
  }
  const chats = db.getChatsByUser(req.user.id);
  res.json({ success: true, chats });
});

// POST /api/chats
app.post('/api/chats', requireAuth, (req, res) => {
  const { title, mode } = req.body || {};
  if (req.user.is_guest) {
    // Ephemeral chat ID for guest
    return res.json({
      success: true,
      chat: { id: 'ephemeral_' + Date.now(), title: title || 'Guest Chat', mode: mode || 'normal' }
    });
  }
  const chat = db.createChat(req.user.id, title || 'New Chat', mode || 'normal');
  res.json({ success: true, chat });
});

// GET /api/chats/:id
app.get('/api/chats/:id', requireAuth, (req, res) => {
  const chatId = req.params.id;
  if (req.user.is_guest) {
    return res.json({ success: true, chat: { id: chatId, title: 'Guest Chat' }, messages: [] });
  }
  const chat = db.getChatById(chatId, req.user.id);
  if (!chat) {
    return res.status(404).json({ success: false, error: 'Chat not found' });
  }
  const messages = db.getMessagesByChat(chatId);
  res.json({ success: true, chat, messages });
});

// PATCH /api/chats/:id
app.patch('/api/chats/:id', requireAuth, (req, res) => {
  const chatId = req.params.id;
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ success: false, error: 'Title is required' });
  if (req.user.is_guest) return res.json({ success: true });
  const updated = db.renameChat(chatId, req.user.id, title);
  res.json({ success: true, chat: updated });
});

// DELETE /api/chats/:id
app.delete('/api/chats/:id', requireAuth, (req, res) => {
  const chatId = req.params.id;
  if (!req.user.is_guest) {
    db.deleteChat(chatId, req.user.id);
  }
  res.json({ success: true });
});

// POST /api/chats/:id/messages
app.post('/api/chats/:id/messages', requireAuth, (req, res) => {
  const chatId = req.params.id;
  const { role, content, imageData } = req.body || {};
  if (!role || (!content && !imageData)) {
    return res.status(400).json({ success: false, error: 'Invalid message payload' });
  }
  if (req.user.is_guest) {
    return res.json({
      success: true,
      message: { id: 'msg_' + Date.now(), chat_id: chatId, role, content, image_data: imageData }
    });
  }
  const msg = db.addMessage(chatId, role, content, imageData);
  res.json({ success: true, message: msg });
});

// ============================================================================
// UNIFIED AI IMAGE GENERATION (Cloudflare FLUX default, Gemini optional, None)
// ============================================================================

/**
 * Unified AI Image Generation Wrapper
 * Calls Cloudflare Workers AI REST API, Google Gemini, or None.
 * Server calls Cloudflare REST API with token in Authorization header.
 * Resizes and compresses with sharp to purpose size.
 * Checks if model output is smaller than target size and notes honestly in sizeNotice.
 * Never exposes, logs or returns keys.
 */
async function generateImage(provider, prompt, size = {}) {
  const activeProvider = (provider || process.env.IMAGE_PROVIDER || 'cloudflare').toLowerCase().trim();

  // Extract purpose and target dimensions
  let targetPurpose = 'chat';
  let targetW = 640;
  let targetH = 360;
  if (typeof size === 'string') {
    targetPurpose = size.toLowerCase();
  } else if (size && typeof size === 'object') {
    targetPurpose = (size.purpose || 'chat').toLowerCase();
    if (size.width) targetW = size.width;
    if (size.height) targetH = size.height;
  }

  const purposeDimensions = {
    chat: { w: 640, h: 360, label: 'Phone chat (640×360)', tier: 'Sketch', quality: 60 },
    school: { w: 1024, h: 576, label: 'School project (1024×576)', tier: 'Standard', quality: 75 },
    project: { w: 1024, h: 576, label: 'Project (1024×576)', tier: 'Standard', quality: 75 },
    poster: { w: 1280, h: 720, label: 'Poster (1280×720)', tier: 'Detailed', quality: 85 },
    print: { w: 1920, h: 1080, label: 'Print (1920×1080)', tier: 'Max', quality: 95 }
  };
  const pConfig = purposeDimensions[targetPurpose] || purposeDimensions.chat;
  if (!size?.width) targetW = pConfig.w;
  if (!size?.height) targetH = pConfig.h;
  const quality = pConfig.quality;

  // Instant In-Memory + Disk Cache Lookup keyed by (word, purpose, size)
  const lookupKeys = [
    size?.word,
    size?.rawText,
    prompt,
    webSearch.extractSearchKeywords(prompt)
  ].filter(Boolean);

  let cached = null;
  for (const k of lookupKeys) {
    const key = aiCache.getCacheKey(k, targetPurpose, targetW, targetH);
    cached = aiCache.get(key);
    if (cached) break;
  }

  if (cached) {
    console.log(`[generateImage] Cache HIT for "${prompt}" (${targetPurpose}, ${targetW}x${targetH})`);
    return {
      ...cached,
      sourceTag: 'Cached',
      statusTag: 'Cached',
      fromCache: true
    };
  }

  // 1. PROVIDER: NONE (Web photos only)
  if (activeProvider === 'none') {
    const err = new Error('AI generation is disabled (IMAGE_PROVIDER=none). Showing licensed web photos.');
    err.reason = 'provider_none';
    err.isNone = true;
    throw err;
  }

  // 1b. PROVIDER: POLLINATIONS (Keyless, Fast Flux Model)
  if (activeProvider === 'pollinations') {
    const seed = Math.floor(Math.random() * 1000000);
    const cleanPrompt = expandPhotorealisticPrompt(prompt, targetPurpose);
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=flux&width=${targetW}&height=${targetH}&seed=${seed}&nologo=true`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout per request

    let rawBuffer = null;
    try {
      const response = await fetch(pollinationsUrl, {
        headers: {
          'User-Agent': 'FocusGen/2.0 (Eco-Adaptive Visual Intelligence; contact@focusgen.local)',
          'Accept': 'image/jpeg,image/png,image/webp,*/*'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const err = new Error(`Pollinations API returned status ${response.status}: ${errText.slice(0, 160)}`);
        err.statusCode = response.status;
        err.reason = 'pollinations_error';
        err.realError = err.message;
        throw err;
      }

      const arrayBuf = await response.arrayBuffer();
      rawBuffer = Buffer.from(arrayBuf);
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        const err = new Error('Pollinations generation timed out after 25s.');
        err.statusCode = 504;
        err.isTimeout = true;
        err.reason = 'timeout';
        throw err;
      }
      throw fetchErr;
    }

    const originalMeta = await sharp(rawBuffer).metadata();
    const origW = originalMeta.width || targetW;
    const origH = originalMeta.height || targetH;

    let sizeNotice = null;
    if (origW < targetW || origH < targetH) {
      sizeNotice = `Model native output is ${origW}×${origH}, which is smaller than the purpose size (${targetW}×${targetH} ${pConfig.label}). Preserved authentic native resolution without artificial upscaling.`;
    }

    const processedBuffer = await sharp(rawBuffer)
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    let focusData = null;
    let finalBuffer = processedBuffer;

    if (size?.focusClarity !== false) {
      try {
        const focusResult = await focusEngine.applyFocusClarity(rawBuffer, {
          purpose: targetPurpose,
          hintText: prompt,
          quality
        });
        if (focusResult && focusResult.success) {
          finalBuffer = focusResult.focusedBuffer || processedBuffer;
          focusData = {
            focusBox: focusResult.focusBox,
            clarityAllocation: focusResult.clarityAllocation,
            modeLabel: focusResult.modeLabel,
            focusedUrl: focusResult.focusedDataUrl,
            uniformUrl: focusResult.uniformDataUrl,
            focusedSizeBytes: focusResult.focusedSizeBytes,
            uniformSizeBytes: focusResult.uniformSizeBytes,
            percentSavedBytes: focusResult.percentSavedBytes,
            isPrint: focusResult.isPrint,
            printNotice: focusResult.printNotice,
            method: focusResult.method
          };
        }
      } catch (fErr) {
        console.warn('Focus clarity processing warning:', fErr.message);
      }
    }

    const finalMeta = await sharp(finalBuffer).metadata();
    const costReport = estimate.computeCostReport(targetPurpose, false, false, 0, pConfig.tier || 'Standard');
    const costChip = estimate.formatCostChipText(costReport);

    const result = {
      imageBase64: finalBuffer.toString('base64'),
      mimeType: 'image/webp',
      provider: 'pollinations',
      model: 'flux',
      sourceTag: 'Pollinations (AI)',
      statusTag: 'Pollinations (AI)',
      sizeNotice,
      width: finalMeta.width,
      height: finalMeta.height,
      sizeFormatted: `${(finalBuffer.length / 1024).toFixed(1)} KB`,
      costReport,
      costChip,
      focusData
    };

    // Save to in-memory and disk cache
    if (size?.word) aiCache.set(size.word, result, targetPurpose, targetW, targetH);
    if (size?.rawText) aiCache.set(size.rawText, result, targetPurpose, targetW, targetH);
    aiCache.set(prompt, result, targetPurpose, targetW, targetH);
    return result;
  }

  // 2. PROVIDER: CLOUDFLARE WORKERS AI (Default)
  if (activeProvider === 'cloudflare') {
    // Allocation Lock Guard: If daily free allocation is exhausted (Error 3036), skip all AI calls
    if (isAiBlocked()) {
      const err = new Error(aiAllocationLock.message || 'Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).');
      err.statusCode = 429;
      err.category = 'quota_rate_limit';
      err.categoryLabel = '429 Daily Allocation Exhausted (Error 3036)';
      err.realError = err.message;
      err.reason = 'quota_exceeded';
      err.is429 = true;
      err.is3036 = true;
      err.blockedUntil = aiAllocationLock.blockedUntil;
      throw err;
    }

    const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
    // Always read model from CLOUDFLARE_IMAGE_MODEL in .env (or explicit size.modelOverride).
    // Never hardcode or silently switch. If empty, getCloudflareModel() defaults to flux-1-schnell and logs.
    const model = (size && size.modelOverride) ? size.modelOverride.trim() : getCloudflareModel();

    if (!accountId || !apiToken) {
      const err = new Error('Cloudflare Workers AI credentials missing in .env (CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN).');
      err.reason = 'missing_key';
      err.statusCode = 400;
      err.category = 'auth_permission';
      err.categoryLabel = 'Missing Credentials';
      err.realError = err.message;
      throw err;
    }

    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    let rawBuffer = null;
    try {
      const cfRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!cfRes.ok) {
        const errText = await cfRes.text().catch(() => '');
        const cfErr = parseCloudflareError(cfRes.status, errText, model);

        const err = new Error(cfErr.realError);
        err.statusCode = cfRes.status;
        err.category = cfErr.category;
        err.categoryLabel = cfErr.categoryLabel;
        err.realError = cfErr.realError;
        err.reason = cfErr.category === 'quota_rate_limit' ? 'quota_exceeded' : (cfErr.category === 'auth_permission' ? 'auth_error' : 'api_error');
        err.is429 = (cfRes.status === 429);
        err.is3036 = !!cfErr.is3036;
        err.model = model;
        throw err;
      }

      const contentType = cfRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await cfRes.json();
        if (!json.success && json.errors && json.errors.length > 0) {
          const cfErr = parseCloudflareError(cfRes.status, json, model);
          const err = new Error(cfErr.realError);
          err.statusCode = cfRes.status || 502;
          err.category = cfErr.category;
          err.categoryLabel = cfErr.categoryLabel;
          err.realError = cfErr.realError;
          err.reason = 'api_error';
          err.is429 = (cfRes.status === 429);
          throw err;
        }
        // FLUX model returns { result: { image: "<base64>" } } or { image: "<base64>" }
        const base64Str = json.result?.image || json.image;
        if (!base64Str) {
          const err = new Error('Cloudflare Workers AI responded without image data.');
          err.statusCode = 502;
          err.category = 'api_error';
          err.categoryLabel = 'Empty Response';
          err.reason = 'no_image_in_response';
          throw err;
        }
        rawBuffer = Buffer.from(base64Str, 'base64');
      } else {
        const arrayBuf = await cfRes.arrayBuffer();
        rawBuffer = Buffer.from(arrayBuf);
      }
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        const err = new Error('Cloudflare Workers AI request timed out after 45s.');
        err.statusCode = 504;
        err.category = 'network_timeout';
        err.categoryLabel = 'Network Timeout';
        err.realError = err.message;
        err.reason = 'timeout';
        throw err;
      }
      throw fetchErr;
    }

    // Sharp Resize and Compression with Honest Size Accounting
    const originalMeta = await sharp(rawBuffer).metadata();
    const origW = originalMeta.width || 1024;
    const origH = originalMeta.height || 1024;

    let sizeNotice = null;
    const isSmallerThanTarget = origW < targetW || origH < targetH;
    if (isSmallerThanTarget) {
      sizeNotice = `Model native output is ${origW}×${origH}, which is smaller than the purpose size (${targetW}×${targetH} ${pConfig.label}). Preserved authentic native resolution without artificial upscaling.`;
    }

    const processedBuffer = await sharp(rawBuffer)
      .resize(targetW, targetH, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality })
      .toBuffer();

    let focusData = null;
    let finalBuffer = processedBuffer;

    if (size?.focusClarity !== false) {
      try {
        const focusResult = await focusEngine.applyFocusClarity(rawBuffer, {
          purpose: targetPurpose,
          hintText: prompt,
          quality
        });
        if (focusResult && focusResult.success) {
          finalBuffer = focusResult.focusedBuffer || processedBuffer;
          focusData = {
            focusBox: focusResult.focusBox,
            clarityAllocation: focusResult.clarityAllocation,
            modeLabel: focusResult.modeLabel,
            focusedUrl: focusResult.focusedDataUrl,
            uniformUrl: focusResult.uniformDataUrl,
            focusedSizeBytes: focusResult.focusedSizeBytes,
            uniformSizeBytes: focusResult.uniformSizeBytes,
            percentSavedBytes: focusResult.percentSavedBytes,
            isPrint: focusResult.isPrint,
            printNotice: focusResult.printNotice,
            method: focusResult.method
          };
        }
      } catch (fErr) {
        console.warn('Focus clarity processing warning:', fErr.message);
      }
    }

    const finalMeta = await sharp(finalBuffer).metadata();

    const result = {
      success: true,
      provider: 'cloudflare',
      model,
      sourceTag: 'Cloudflare (AI)',
      statusTag: 'Cloudflare (AI)',
      imageBase64: finalBuffer.toString('base64'),
      mimeType: 'image/webp',
      width: finalMeta.width,
      height: finalMeta.height,
      nativeWidth: origW,
      nativeHeight: origH,
      sizeNotice,
      purpose: targetPurpose,
      focusData
    };
    if (size?.word) aiCache.set(size.word, result, targetPurpose, targetW, targetH);
    if (size?.rawText) aiCache.set(size.rawText, result, targetPurpose, targetW, targetH);
    aiCache.set(prompt, result, targetPurpose, targetW, targetH);
    return result;
  }

  // 3. PROVIDER: GEMINI (Optional)
  if (activeProvider === 'gemini') {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const model = (process.env.IMAGE_MODEL || 'gemini-2.5-flash-image').trim();

    if (!apiKey || apiKey === 'PASTE_YOUR_KEY_HERE') {
      const err = new Error('Gemini API key is not configured in .env (GEMINI_API_KEY).');
      err.reason = 'missing_key';
      err.statusCode = 400;
      throw err;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    let rawBuffer = null;
    let endpoint;
    let requestBody;

    if (model.startsWith('imagen')) {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
      requestBody = {
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: (targetW / targetH > 1.5) ? '16:9' : '1:1' }
      };
    } else {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      };
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const is429 = response.status === 429;
        const errText = await response.text().catch(() => '');
        const sanitized = sanitizeMessage(errText, apiKey);
        const err = new Error(is429 ? 'AI image quota is full right now (HTTP 429).' : `Gemini API returned status ${response.status}: ${sanitized.slice(0, 160)}`);
        err.statusCode = response.status;
        err.reason = is429 ? 'quota_exceeded' : 'api_error';
        err.is429 = is429;
        throw err;
      }

      const data = await response.json();
      let imageBase64 = null;

      if (data.candidates?.[0]?.content?.parts) {
        for (const part of data.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data;
            break;
          }
          if (part.inline_data?.data) {
            imageBase64 = part.inline_data.data;
            break;
          }
        }
      }

      if (!imageBase64 && data.predictions?.[0]) {
        const pred = data.predictions[0];
        imageBase64 = pred.bytesBase64Encoded || pred.image?.imageBytes;
      }

      if (!imageBase64) {
        const err = new Error('Gemini model responded without an image.');
        err.statusCode = 502;
        err.reason = 'no_image_in_response';
        throw err;
      }

      rawBuffer = Buffer.from(imageBase64, 'base64');
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        const err = new Error('Gemini generation timed out after 35s.');
        err.statusCode = 504;
        err.reason = 'timeout';
        throw err;
      }
      throw fetchErr;
    }

    const originalMeta = await sharp(rawBuffer).metadata();
    const origW = originalMeta.width || 1024;
    const origH = originalMeta.height || 1024;

    let sizeNotice = null;
    if (origW < targetW || origH < targetH) {
      sizeNotice = `Model native output is ${origW}×${origH}, which is smaller than the purpose size (${targetW}×${targetH} ${pConfig.label}). Preserved authentic native resolution without artificial upscaling.`;
    }

    const processedBuffer = await sharp(rawBuffer)
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    let focusData = null;
    let finalBuffer = processedBuffer;

    if (size?.focusClarity !== false) {
      try {
        const focusResult = await focusEngine.applyFocusClarity(rawBuffer, {
          purpose: targetPurpose,
          hintText: prompt,
          quality
        });
        if (focusResult && focusResult.success) {
          finalBuffer = focusResult.focusedBuffer || processedBuffer;
          focusData = {
            focusBox: focusResult.focusBox,
            clarityAllocation: focusResult.clarityAllocation,
            modeLabel: focusResult.modeLabel,
            focusedUrl: focusResult.focusedDataUrl,
            uniformUrl: focusResult.uniformDataUrl,
            focusedSizeBytes: focusResult.focusedSizeBytes,
            uniformSizeBytes: focusResult.uniformSizeBytes,
            percentSavedBytes: focusResult.percentSavedBytes,
            isPrint: focusResult.isPrint,
            printNotice: focusResult.printNotice,
            method: focusResult.method
          };
        }
      } catch (fErr) {
        console.warn('Focus clarity processing warning:', fErr.message);
      }
    }

    const finalMeta = await sharp(finalBuffer).metadata();

    return {
      success: true,
      provider: 'gemini',
      model,
      sourceTag: 'Gemini AI',
      statusTag: 'Gemini AI',
      imageBase64: finalBuffer.toString('base64'),
      mimeType: 'image/webp',
      width: finalMeta.width,
      height: finalMeta.height,
      nativeWidth: origW,
      nativeHeight: origH,
      sizeNotice,
      purpose: targetPurpose,
      focusData
    };
  }

  const err = new Error(`Unknown image provider: "${activeProvider}". Supported: pollinations, cloudflare, gemini, none.`);
  err.statusCode = 400;
  throw err;
}

// Register generateImage with AiQueue
aiQueue.setGenerator(generateImage);

// GET /api/ai-job/:id - Status of background AI image generation
app.get('/api/ai-job/:id', (req, res) => {
  const job = aiQueue.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  const isQueued = job.status === 'queued';
  const isGen = job.status === 'generating';
  let statusText = '';
  if (isQueued) {
    statusText = `Position in queue: ${job.position}`;
  } else if (isGen) {
    statusText = 'Synthesizing photorealistic image with Pollinations FLUX...';
  } else if (job.status === 'completed') {
    statusText = 'New AI image ready';
  } else if (job.status === 'timeout') {
    statusText = 'AI image is taking long, showing licensed photos';
  } else {
    statusText = job.error || 'Generation failed';
  }

  res.json({
    success: true,
    id: job.id,
    status: job.status,
    position: job.position,
    statusText,
    result: job.result,
    error: job.error
  });
});

// POST /api/chat - Unified Chat Message, Purpose Inference & Generation
app.post('/api/chat', async (req, res) => {
  const { message, purpose, chatId, mode = 'normal', webFirst = true, uploadedDoc, isOverridden, fromTier, toTier } = req.body || {};
  const rawText = (message || '').trim();
  if (!rawText) {
    return res.status(400).json({ success: false, error: 'Message text is required' });
  }

  // Ensure user session (auth or guest)
  let user = req.user;
  if (!user) {
    user = db.createGuestUser();
    const guestToken = jwt.sign(
      { userId: user.id, isGuest: true, email: null },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie('focusgen_token', guestToken, authCookieOptions);
  }

  // Enforce guest generation limit
  if (user.is_guest && (user.guest_generations || 0) >= 5) {
    return res.status(403).json({
      success: false,
      limitReached: true,
      error: 'Guest generation limit reached (5/5). Please sign in or create an account to continue unlimited generations and save your chats.'
    });
  }

  // 1. Conversational Greeting & Assistance Check
  const lower = rawText.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const greetings = ['hi', 'hello', 'hey', 'vanakkam', 'halo', 'namaste', 'hola', 'yo', 'good morning', 'good afternoon', 'good evening', 'who are you', 'what can you do', 'what is this', 'help', 'how does this work', 'how are you', 'how do you work', 'tell me about focusgen', 'what is focusgen'];
  const isGreeting = greetings.some(g => lower === g || lower.startsWith(g + ' ') || lower.endsWith(' ' + g)) || lower.startsWith('who are you') || lower.startsWith('what can you do') || lower.startsWith('help') || lower.startsWith('how to');

  if (isGreeting) {
    return res.json({
      success: true,
      type: 'greeting',
      reply: "Hello! I'm FocusGen, your eco-adaptive visual intelligence chatbot. Tell me any subject you want to see (e.g. 'cake', 'tiger for slide', 'temple poster', or 'whatsapp status cake') to search licensed photos or generate photorealistic DSLR images.",
      suggestions: ['cake for whatsapp status', 'tiger for school project slide', 'temple poster for fest', 'print cake photo']
    });
  }

  if (lower === 'thank you' || lower === 'thanks' || lower === 'nandri' || lower === 'dhanyavad') {
    return res.json({
      success: true,
      type: 'conversational',
      reply: "You're very welcome! Feel free to type any subject whenever you'd like to explore more licensed photography or photorealistic AI images."
    });
  }

  const cleanSubject = webSearch.extractSearchKeywords(rawText) || rawText;

  // 2. PURPOSE INFERENCE: Infer purpose if not explicitly provided
  let chosenPurpose = purpose;
  let inferred = null;
  if (!chosenPurpose) {
    try {
      inferred = await purposeEngine.inferPurpose(rawText, {
        mode,
        uploadedDoc,
        userId: user?.id,
        isGuest: !!user?.is_guest,
        db
      });
      chosenPurpose = inferred?.purposeKey || 'chat';
    } catch (inferErr) {
      console.warn('Purpose inference error:', inferErr);
      chosenPurpose = 'chat';
    }
  } else {
    chosenPurpose = purposeEngine.normalizePurpose(chosenPurpose);
  }

  // 3. TARGET DIMENSIONS (Smallest size the purpose needs: Phone chat 640x360, Project 1024x576, Poster 1280x720, Print 1920x1080)
  const purposeDimensions = {
    chat: { w: 640, h: 360, label: 'Phone chat (640×360)', tier: 'Sketch' },
    school: { w: 1024, h: 576, label: 'School project (1024×576)', tier: 'Standard' },
    project: { w: 1024, h: 576, label: 'Project (1024×576)', tier: 'Standard' },
    poster: { w: 1280, h: 720, label: 'Poster (1280×720)', tier: 'Detailed' },
    print: { w: 1920, h: 1080, label: 'Print (1920×1080)', tier: 'Max' }
  };
  const pConfig = purposeDimensions[chosenPurpose] || purposeDimensions.chat;

  const isDemo = req.body?.demoMode === true;
  const isBlocked = isAiBlocked();

  // 4. INSTANT CACHE CHECK keyed by (word, purpose, size)
  const lookupKeys = [
    cleanSubject,
    rawText,
    expandPhotorealisticPrompt(cleanSubject, chosenPurpose)
  ].filter(Boolean);

  let cachedImage = null;
  for (const k of lookupKeys) {
    const key = aiCache.getCacheKey(k, chosenPurpose, pConfig.w, pConfig.h);
    cachedImage = aiCache.get(key);
    if (cachedImage) break;
  }

  // 5. SEARCH LICENSED WEB PHOTOS (Wikimedia Commons & Openverse)
  let searchResult = { photos: [] };
  try {
    searchResult = await webSearch.searchLicensedPhotos(cleanSubject, chosenPurpose);
  } catch (err) {
    console.warn('Web search error in /api/chat:', err.message);
  }

  const costReport = estimate.computeWebImageReport(chosenPurpose);
  let costChip = estimate.formatCostChipText(costReport);
  if (isOverridden && fromTier && toTier) {
    const fromE = purposeEngine.getTierEnergy(fromTier);
    const toE = purposeEngine.getTierEnergy(toTier);
    const deltaWh = (toE.wh - fromE.wh).toFixed(1);
    const sign = toE.wh >= fromE.wh ? '+' : '';
    costChip = `Overridden (${fromTier} -> ${toTier}: ${sign}${deltaWh} Wh) · ${costChip}`;
  }

  if (chatId && !user.is_guest) {
    db.addMessage(chatId, 'user', rawText);
    db.addMessage(chatId, 'assistant', `Visual response for ${cleanSubject}`);
  }

  // 6. IF CACHED: Return instantly! Web photos + cached image + purpose suggestion
  if (cachedImage) {
    return res.json({
      success: true,
      type: 'web_photos',
      word: cleanSubject,
      rawText,
      purpose: chosenPurpose,
      photos: searchResult.photos || [],
      cachedImage,
      inferred,
      costReport: cachedImage.costReport || costReport,
      costChip: cachedImage.costChip || costChip,
      fromCache: true,
      statusTag: 'Cached',
      sourceTag: 'Cached',
      statusLine: 'Loaded instantly from cache.',
      aiBlocked: isBlocked,
      demoMode: isDemo,
      isOverridden: !!isOverridden,
      fromTier,
      toTier
    });
  }

  // 7. IF DEMO MODE OR AI BLOCKED: Return licensed web photos only (no AI calls)
  if (isBlocked || isDemo) {
    const statusLine = isBlocked
      ? 'AI paused (daily limit). Using licensed photos.'
      : 'Demo mode active. Using licensed photos.';

    return res.json({
      success: true,
      type: 'web_photos',
      word: cleanSubject,
      rawText,
      purpose: chosenPurpose,
      photos: searchResult.photos || [],
      inferred,
      costReport,
      costChip,
      statusTag: 'Web photo',
      sourceTag: 'Web photo',
      statusLine,
      aiBlocked: isBlocked,
      demoMode: isDemo,
      blockedUntil: isBlocked ? aiAllocationLock.blockedUntil : 0,
      resetNotice: isBlocked ? aiAllocationLock.message : null,
      isOverridden: !!isOverridden,
      fromTier,
      toTier
    });
  }

  // 8. BACKGROUND AI GENERATION QUEUE (Pollinations or Cloudflare)
  const provider = (process.env.IMAGE_PROVIDER || 'pollinations').toLowerCase().trim();
  const expandedPrompt = expandPhotorealisticPrompt(cleanSubject, chosenPurpose);

  // Enqueue job with 15-second spacing for Pollinations
  const job = aiQueue.enqueue(provider, cleanSubject, {
    purpose: chosenPurpose,
    width: pConfig.w,
    height: pConfig.h,
    word: cleanSubject,
    rawText,
    prompt: expandedPrompt
  });

  const queuePositionText = job.position > 1
    ? `Position in queue: ${job.position}`
    : `Position in queue: ${job.position} · Generating AI image in background...`;

  return res.json({
    success: true,
    type: 'web_photos',
    word: cleanSubject,
    rawText,
    purpose: chosenPurpose,
    photos: searchResult.photos || [],
    inferred,
    costReport,
    costChip,
    statusTag: 'Web photo',
    sourceTag: 'Web photo',
    statusLine: queuePositionText,
    aiJob: {
      id: job.id,
      position: job.position,
      status: job.status
    },
    aiBlocked: isBlocked,
    demoMode: isDemo,
    isOverridden: !!isOverridden,
    fromTier,
    toTier
  });
});

// ============================================================================
// WEB-FIRST LICENSED IMAGE SEARCH
// ============================================================================

// POST /api/search-licensed
app.post('/api/search-licensed', async (req, res) => {
  const { query, purpose } = req.body || {};
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return res.status(400).json({ success: false, error: 'Missing query' });
  }

  try {
    const searchResult = await webSearch.searchLicensedPhotos(cleanQuery, purpose || 'chat');
    const costReport = estimate.computeWebImageReport(purpose || 'chat');
    const costChip = estimate.formatCostChipText(costReport);

    if (searchResult.success && searchResult.photos && searchResult.photos.length > 0) {
      return res.json({
        success: true,
        count: searchResult.photos.length,
        photos: searchResult.photos,
        fromCache: !!searchResult.fromCache,
        costReport,
        costChip
      });
    }

    // No reusable photos found matching criteria
    return res.json({
      success: false,
      count: 0,
      photos: [],
      message: 'No reusable licensed photos found matching criteria. You can generate with AI.',
      costReport,
      costChip
    });

  } catch (err) {
    console.warn('Licensed photo search error:', err.message);
    const costReport = estimate.computeWebImageReport(purpose || 'chat');
    const costChip = estimate.formatCostChipText(costReport);

    return res.status(500).json({
      success: false,
      error: 'Licensed image search is momentarily busy or rate-limited. Please retry in a moment or generate with AI.',
      canRetry: true,
      costReport,
      costChip
    });
  }
});

// GET /api/download-attributed (Embeds mandatory attribution banner directly on image)
app.get('/api/download-attributed', async (req, res) => {
  const { url, title, creator, license, source } = req.query || {};
  if (!url) return res.status(400).send('Missing url parameter');

  try {
    const buffer = await fetchBuffer(url);

    const metadata = await sharp(buffer).metadata();
    const w = metadata.width || 1200;
    const h = metadata.height || 800;

    // Create bottom attribution bar
    const bannerH = Math.max(36, Math.round(h * 0.055));
    const fontSize = Math.max(12, Math.round(bannerH * 0.42));
    const cleanT = (title || 'Photo').replace(/<[^>]*>?/gm, '').slice(0, 50);
    const cleanC = (creator || 'Creator').replace(/<[^>]*>?/gm, '').slice(0, 40);
    const cleanL = (license || 'CC').replace(/<[^>]*>?/gm, '').slice(0, 30);
    const cleanS = (source || 'Web').replace(/<[^>]*>?/gm, '').slice(0, 25);

    function escapeXml(unsafe) {
      return (unsafe || '').replace(/[<>&'"]/g, c => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
        }
      });
    }

    const bannerSvg = Buffer.from(`
      <svg width="${w}" height="${bannerH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${w}" height="${bannerH}" fill="rgba(10, 18, 32, 0.90)"/>
        <text x="16" y="${Math.round(bannerH * 0.65)}" font-family="sans-serif" font-size="${fontSize}" font-weight="600" fill="#3B82F6">
          FocusGen Attribution:
        </text>
        <text x="${Math.round(fontSize * 13)}" y="${Math.round(bannerH * 0.65)}" font-family="sans-serif" font-size="${fontSize}" fill="#EAF1FB">
          ${escapeXml(cleanT)} by ${escapeXml(cleanC)} · ${escapeXml(cleanL)} · via ${escapeXml(cleanS)}
        </text>
      </svg>
    `);

    const outputBuffer = await sharp(buffer)
      .composite([
        { input: bannerSvg, top: h - bannerH, left: 0 }
      ])
      .jpeg({ quality: 90 })
      .toBuffer();

    const safeFilename = (title || 'photo').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 30) + '-attributed.jpg';
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.send(outputBuffer);

  } catch (err) {
    console.error('Attributed download error:', err);
    res.redirect(url);
  }
});

// ============================================================================
// AI IMAGE GENERATION (Photorealistic, No Cartoons)
// ============================================================================

// POST /api/generate
app.post('/api/generate', async (req, res) => {
  const { word, purpose = 'chat', tier, width, height, provider: reqProvider, isOverridden, fromTier, toTier } = req.body || {};

  if (!word || typeof word !== 'string' || !word.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: word'
    });
  }

  // Guest usage check
  if (req.user && req.user.is_guest) {
    if ((req.user.guest_generations || 0) >= 5) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        error: 'Guest limit reached (5/5 generations). Please sign up or log in to continue unlimited generations and save your chats.'
      });
    }
  }

  const cleanSubject = word.trim();
  const targetPurpose = purposeEngine.normalizePurpose(purpose);
  const isDemo = req.body?.demoMode === true;
  const isBlocked = isAiBlocked();

  // If AI is blocked (error 3036 daily limit) OR Demo mode is active:
  // Run whole flow with web photos only, with no errors shown to the user.
  if (isBlocked || isDemo) {
    try {
      const fallbackSearch = await webSearch.searchLicensedPhotos(cleanSubject, targetPurpose);
      const costReport = estimate.computeWebImageReport(targetPurpose);
      let costChip = estimate.formatCostChipText(costReport);
      if (isOverridden && fromTier && toTier) {
        const fromE = purposeEngine.getTierEnergy(fromTier);
        const toE = purposeEngine.getTierEnergy(toTier);
        const deltaWh = (toE.wh - fromE.wh).toFixed(1);
        const sign = toE.wh >= fromE.wh ? '+' : '';
        costChip = `Overridden (${fromTier} -> ${toTier}: ${sign}${deltaWh} Wh) · ${costChip}`;
      }

      const statusLine = isBlocked
        ? 'AI paused (daily limit). Using licensed photos.'
        : 'Demo mode active. Using licensed photos.';

      return res.json({
        success: true,
        type: 'web_photos',
        word: cleanSubject,
        purpose: targetPurpose,
        photos: fallbackSearch.photos || [],
        costReport,
        costChip,
        statusTag: 'Web photo',
        sourceTag: 'Web photo',
        statusLine,
        aiBlocked: isBlocked,
        demoMode: isDemo,
        blockedUntil: isBlocked ? aiAllocationLock.blockedUntil : 0,
        resetNotice: isBlocked ? aiAllocationLock.message : null,
        isOverridden: !!isOverridden,
        fromTier,
        toTier
      });
    } catch (eFallback) {
      console.warn('Web search fallback error in /api/generate:', eFallback.message);
    }
  }

  const provider = (reqProvider || process.env.IMAGE_PROVIDER || 'cloudflare').toLowerCase().trim();
  const expandedPrompt = expandPhotorealisticPrompt(cleanSubject, targetPurpose);

  try {
    const genResult = await generateImage(provider, expandedPrompt, { purpose: targetPurpose, width, height });

    if (req.user && req.user.is_guest) {
      db.incrementGuestUsage(req.user.id);
    }

    const costReport = estimate.computeCostReport(
      targetPurpose,
      true,
      false,
      0,
      tier || null,
      genResult.focusData ? {
        focusBox: genResult.focusData.focusBox,
        savedBytesPercent: genResult.focusData.percentSavedBytes
      } : null
    );
    let costChip = estimate.formatCostChipText(costReport);

    if (isOverridden && fromTier && toTier) {
      const fromE = purposeEngine.getTierEnergy(fromTier);
      const toE = purposeEngine.getTierEnergy(toTier);
      const deltaWh = (toE.wh - fromE.wh).toFixed(1);
      const sign = toE.wh >= fromE.wh ? '+' : '';
      costChip = `Overridden (${fromTier} -> ${toTier}: ${sign}${deltaWh} Wh) · ${costChip}`;
    }

    return res.json({
      success: true,
      type: 'ai_image',
      imageBase64: genResult.imageBase64,
      mimeType: genResult.mimeType,
      prompt: expandedPrompt,
      costReport,
      costChip,
      width: genResult.width,
      height: genResult.height,
      sizeNotice: genResult.sizeNotice,
      statusTag: genResult.statusTag,
      sourceTag: genResult.sourceTag,
      focusData: genResult.focusData,
      isOverridden: !!isOverridden,
      fromTier,
      toTier
    });
  } catch (err) {
    const sanitizedError = sanitizeMessage(err.message || String(err));
    console.warn(`Generation failed: ${sanitizedError}`);

    const is429 = err.statusCode === 429 || err.is429;
    const is3036 = err.is3036 || (is429 && sanitizedError.includes('3036'));
    if (is3036) {
      setAiBlocked3036();
    }

    // Quota/Failure Guard: Automatically fallback to licensed web photos
    try {
      const fallbackSearch = await webSearch.searchLicensedPhotos(cleanSubject, purpose);
      const costReport = estimate.computeWebImageReport(purpose);
      let costChip = estimate.formatCostChipText(costReport);
      if (isOverridden && fromTier && toTier) {
        const fromE = purposeEngine.getTierEnergy(fromTier);
        const toE = purposeEngine.getTierEnergy(toTier);
        const deltaWh = (toE.wh - fromE.wh).toFixed(1);
        const sign = toE.wh >= fromE.wh ? '+' : '';
        costChip = `Overridden (${fromTier} -> ${toTier}: ${sign}${deltaWh} Wh) · ${costChip}`;
      }

      let aiMessage = '';
      if (isAiBlocked() || is3036) {
        aiMessage = 'Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).';
      } else if (is429) {
        aiMessage = 'AI image quota is full right now, showing real licensed photos instead.';
      } else if (err.isNone) {
        aiMessage = 'AI generation is disabled (IMAGE_PROVIDER=none). Showing licensed web photos.';
      } else {
        const statusText = err.statusCode ? `HTTP ${err.statusCode}` : 'Error';
        const label = err.categoryLabel || statusText;
        aiMessage = `AI generation failed [${label}]: ${err.realError || err.message}. Showing real licensed photos instead.`;
      }

      const statusLine = isAiBlocked() || is3036
        ? 'AI paused (daily limit). Using licensed photos.'
        : null;

      return res.json({
        success: true,
        type: 'web_photos',
        fallbackFromAi: true,
        is429,
        is3036: isAiBlocked() || is3036,
        aiBlocked: isAiBlocked(),
        statusLine,
        aiMessage,
        retryDelay: is429 ? 60 : 0,
        word: cleanSubject,
        purpose,
        photos: fallbackSearch.photos,
        costReport,
        costChip,
        statusTag: 'Web photo',
        sourceTag: 'Web photo',
        isOverridden: !!isOverridden,
        fromTier,
        toTier
      });
    } catch (eFallback) {}

    return res.status(err.statusCode || 500).json({
      success: false,
      reason: is429 ? 'quota_exceeded' : (err.category || err.reason || 'generation_failed'),
      error: sanitizeMessage(err.realError || err.message || 'Generation failed. Please retry.'),
      is429,
      is3036: isAiBlocked() || is3036,
      aiBlocked: isAiBlocked(),
      canRetry: !isAiBlocked(),
      retryDelay: is429 ? 60 : 0,
      word: cleanSubject
    });
  }
});

// ============================================================================
// SMART COMPRESS (AI-Assisted Server-Side Sharp Compression)
// ============================================================================

// Helper to format bytes to readable string
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// POST /api/compress
app.post('/api/compress', async (req, res) => {
  const { imageUrl, imageBase64, purpose, box, focusClarity, hintText } = req.body || {};

  let inputBuffer = null;
  let originalMime = 'image/jpeg';

  try {
    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      inputBuffer = Buffer.from(base64Data, 'base64');
    } else if (imageUrl) {
      if (imageUrl.startsWith('data:')) {
        const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
        inputBuffer = Buffer.from(base64Data, 'base64');
      } else {
        inputBuffer = await fetchBuffer(imageUrl);
      }
    } else {
      return res.status(400).json({ success: false, error: 'Provide imageUrl or imageBase64' });
    }

    const originalBytes = inputBuffer.length;
    const originalMetadata = await sharp(inputBuffer).metadata();

    // Purpose dimensions & quality definitions
    const targetPurpose = (purpose || 'chat').toLowerCase();
    let targetW = 640;
    let targetH = 360;
    let quality = 60;
    let format = 'webp';

    switch (targetPurpose) {
      case 'chat':
        targetW = 640;
        targetH = 360;
        quality = 60;
        break;
      case 'school':
      case 'project':
        targetW = 1280;
        targetH = 720;
        quality = 75;
        break;
      case 'poster':
        targetW = 1600;
        targetH = 900;
        quality = 85;
        break;
      case 'print':
        targetW = 1920;
        targetH = 1080;
        quality = 95;
        break;
      default:
        targetW = 1280;
        targetH = 720;
        quality = 75;
    }

    let focusResult = null;
    try {
      focusResult = await focusEngine.applyFocusClarity(inputBuffer, {
        box: box || null,
        purpose: targetPurpose,
        hintText: hintText || '',
        quality,
        enabled: focusClarity !== false
      });
    } catch (fErr) {
      console.warn('Focus clarity in /api/compress warning:', fErr.message);
    }

    let compressedBuffer = null;
    let uniformBuffer = null;

    if (focusResult && focusResult.success) {
      compressedBuffer = focusResult.focusedBuffer;
      uniformBuffer = focusResult.uniformBuffer;
    } else {
      compressedBuffer = await sharp(inputBuffer)
        .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      uniformBuffer = compressedBuffer;
    }

    const compressedBytes = compressedBuffer.length;
    const uniformBytes = uniformBuffer.length;
    const compressedMetadata = await sharp(compressedBuffer).metadata();

    const percentSaved = Math.max(0, ((originalBytes - compressedBytes) / originalBytes) * 100);
    const originalDataUrl = `data:${originalMetadata.format || 'image/jpeg'};base64,${inputBuffer.toString('base64')}`;
    const compressedDataUrl = `data:image/webp;base64,${compressedBuffer.toString('base64')}`;
    const uniformDataUrl = `data:image/webp;base64,${uniformBuffer.toString('base64')}`;

    const isPrint = targetPurpose === 'print';
    const printNotice = isPrint ? 'Print needs full clarity, focus map off' : null;
    const summary = isPrint
      ? `Original ${formatBytes(originalBytes)} -> ${formatBytes(compressedBytes)} (Print needs full clarity, focus map off)`
      : (focusResult?.clarityAllocation?.summaryText || `Original ${formatBytes(originalBytes)} -> ${formatBytes(compressedBytes)} (${percentSaved.toFixed(0)}% smaller)`);

    res.json({
      success: true,
      originalSize: formatBytes(originalBytes),
      compressedSize: formatBytes(compressedBytes),
      originalBytes,
      compressedBytes,
      focusedBytes: compressedBytes,
      uniformBytes,
      percentSaved: Number(percentSaved.toFixed(1)),
      percentSavedBytes: focusResult?.percentSavedBytes || 0,
      summary,
      originalUrl: originalDataUrl,
      compressedUrl: compressedDataUrl,
      focusedUrl: compressedDataUrl,
      uniformUrl: uniformDataUrl,
      purpose: targetPurpose,
      dimensions: {
        original: `${originalMetadata.width}×${originalMetadata.height}`,
        compressed: `${compressedMetadata.width}×${compressedMetadata.height}`
      },
      quality,
      format: 'webp',
      focusBox: focusResult?.focusBox || { x: 20, y: 15, width: 60, height: 70, feather: 15 },
      clarityAllocation: focusResult?.clarityAllocation || {
        subjectPercent: isPrint ? 100 : 50,
        backgroundPercent: isPrint ? 0 : 50,
        savedBytesPercent: focusResult?.percentSavedBytes || 0,
        summaryText: summary
      },
      modeLabel: focusResult?.modeLabel || (isPrint ? 'Focus clarity (Print - full clarity)' : 'Focus clarity (post-process)'),
      isPrint,
      printNotice
    });

  } catch (err) {
    console.error('Compression failed:', err);
    res.status(500).json({ success: false, error: 'Compression failed: ' + err.message });
  }
});

// POST /api/focus/detect - Saliency Focus Region Detection (Methods A & B & C)
app.post('/api/focus/detect', async (req, res) => {
  const { imageUrl, imageBase64, hintText, userBox, purpose } = req.body || {};
  try {
    let inputBuffer = null;
    if (imageBase64) {
      inputBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    } else if (imageUrl) {
      inputBuffer = imageUrl.startsWith('data:')
        ? Buffer.from(imageUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')
        : await fetchBuffer(imageUrl);
    } else {
      return res.status(400).json({ success: false, error: 'Provide imageUrl or imageBase64' });
    }

    const detection = await focusEngine.detectFocusRegion(inputBuffer, {
      hintText: hintText || '',
      userBox: userBox || null,
      purpose: purpose || 'chat'
    });

    res.json({
      success: true,
      ...detection
    });
  } catch (err) {
    console.warn('Focus detection fallback:', err.message);
    res.json({
      success: true,
      box: { x: 20, y: 15, width: 60, height: 70, feather: 15 },
      method: 'centered_fallback',
      confidence: 0.5,
      isPrint: (purpose || '').toLowerCase() === 'print',
      flat: true
    });
  }
});

// POST /api/focus/apply - Apply Focus Clarity Pipeline
app.post('/api/focus/apply', async (req, res) => {
  const { imageUrl, imageBase64, box, purpose, hintText, enabled } = req.body || {};
  try {
    let inputBuffer = null;
    if (imageBase64) {
      inputBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    } else if (imageUrl) {
      inputBuffer = imageUrl.startsWith('data:')
        ? Buffer.from(imageUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')
        : await fetchBuffer(imageUrl);
    } else {
      return res.status(400).json({ success: false, error: 'Provide imageUrl or imageBase64' });
    }

    const result = await focusEngine.applyFocusClarity(inputBuffer, {
      box: box || null,
      purpose: purpose || 'chat',
      hintText: hintText || '',
      enabled: enabled !== false
    });

    res.json({
      success: true,
      focusedUrl: result.focusedDataUrl,
      uniformUrl: result.uniformDataUrl,
      focusedSizeBytes: result.focusedSizeBytes,
      uniformSizeBytes: result.uniformSizeBytes,
      percentSavedBytes: result.percentSavedBytes,
      focusBox: result.focusBox,
      isPrint: result.isPrint,
      printNotice: result.printNotice,
      clarityAllocation: result.clarityAllocation,
      modeLabel: result.modeLabel,
      method: result.method
    });
  } catch (err) {
    console.warn('Focus apply error:', err.message);
    res.status(500).json({ success: false, error: 'Focus clarity processing failed: ' + err.message });
  }
});


// ============================================================================
// FILE & DOCUMENT UPLOADS
// ============================================================================

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user ? req.user.id : 'guest_temp';
    const userDir = path.join(uploadsBaseDir, userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB Max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Only JPG, PNG, WebP, PDF, TXT, and DOCX are allowed.'));
    }
  }
});

// POST /api/upload
app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  const { filename, originalname, mimetype, size, path: filePath } = req.file;
  const isImage = mimetype.startsWith('image/');
  let thumbnailPath = null;
  let docMeta = {};

  try {
    if (isImage) {
      // Generate thumbnail
      const thumbFilename = 'thumb_' + filename + '.webp';
      thumbnailPath = path.join(path.dirname(filePath), thumbFilename);
      await sharp(filePath)
        .resize(200, 200, { fit: 'cover' })
        .webp({ quality: 70 })
        .toFile(thumbnailPath);
    } else {
      // Extract document text
      let extractedText = '';
      if (mimetype === 'application/pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        extractedText = (pdfData.text || '').slice(0, 3000);
      } else if (mimetype === 'text/plain') {
        extractedText = fs.readFileSync(filePath, 'utf8').slice(0, 3000);
      } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const docxResult = await mammoth.extractRawText({ path: filePath });
        extractedText = (docxResult.value || '').slice(0, 3000);
      }

      // Generate 3 realistic image prompt suggestions from document content
      const words = extractedText.replace(/[^\w\s]/gi, ' ').split(/\s+/).filter(w => w.length > 3);
      const topWords = [...new Set(words)].slice(0, 6);
      const subject1 = topWords.slice(0, 2).join(' ') || 'project topic overview';
      const subject2 = topWords.slice(2, 4).join(' ') || 'detailed analytical chart';
      const subject3 = topWords.slice(4, 6).join(' ') || 'futuristic concept illustration';

      docMeta = {
        textSnippet: extractedText.slice(0, 280),
        detectedPurpose: extractedText.length > 400 ? 'school' : 'poster',
        suggestedIdeas: [
          `Photorealistic presentation slide photo depicting ${subject1}`,
          `High detail editorial textbook photograph of ${subject2}`,
          `Realistic exhibition poster visual showcasing ${subject3}`
        ]
      };
    }

    const record = db.addUpload(req.user.id, {
      filename,
      originalName: originalname,
      mimeType: mimetype,
      sizeBytes: size,
      filePath,
      thumbnailPath,
      meta: docMeta
    });

    res.json({
      success: true,
      file: {
        id: record.id,
        filename: record.filename,
        originalName: record.original_name,
        mimeType: record.mime_type,
        sizeBytes: record.size_bytes,
        sizeFormatted: formatBytes(record.size_bytes),
        isImage,
        meta: docMeta
      }
    });

  } catch (err) {
    console.error('Upload processing error:', err);
    res.status(500).json({ success: false, error: 'Upload failed: ' + err.message });
  }
});

// GET /api/uploads
app.get('/api/uploads', requireAuth, (req, res) => {
  const uploads = db.getUploadsByUser(req.user.id);
  res.json({ success: true, uploads });
});

// DELETE /api/uploads/:id
app.delete('/api/uploads/:id', requireAuth, (req, res) => {
  const success = db.deleteUpload(req.params.id, req.user.id);
  res.json({ success });
});

// GET /api/uploads/file/:id
app.get('/api/uploads/file/:id', requireAuth, (req, res) => {
  const upload = db.getUploadById(req.params.id, req.user.id);
  if (!upload || !fs.existsSync(upload.file_path)) {
    return res.status(404).send('File not found');
  }
  res.sendFile(upload.file_path);
});

// GET /api/uploads/thumb/:id
app.get('/api/uploads/thumb/:id', requireAuth, (req, res) => {
  const upload = db.getUploadById(req.params.id, req.user.id);
  if (!upload) return res.status(404).send('File not found');
  if (upload.thumbnail_path && fs.existsSync(upload.thumbnail_path)) {
    return res.sendFile(upload.thumbnail_path);
  }
  if (upload.file_path && fs.existsSync(upload.file_path)) {
    return res.sendFile(upload.file_path);
  }
  res.status(404).send('Thumbnail not found');
});

// ============================================================================
// ALLOCATION LOCK & TESTING ENDPOINTS (Cloudflare Error 3036 Protection)
// ============================================================================

// GET /api/ai-status - Current AI status, block info & countdown target
app.get('/api/ai-status', (req, res) => {
  res.json({
    blocked: isAiBlocked(),
    isAfterResetTime: isAfterResetTime(),
    blockedUntil: aiAllocationLock.blockedUntil,
    resetTimeLabel: aiAllocationLock.resetTimeLabel,
    message: aiAllocationLock.message
  });
});

// POST /api/test/simulate-3036 - Simulate Cloudflare Error 3036 response
app.post('/api/test/simulate-3036', (req, res) => {
  const lock = setAiBlocked3036(req.body?.message);
  res.json({
    success: true,
    simulated: 3036,
    blocked: lock.blocked,
    blockedUntil: lock.blockedUntil,
    resetTimeLabel: lock.resetTimeLabel,
    message: lock.message
  });
});

// POST /api/test/set-reset-passed - Simulate that 00:00 UTC reset time has passed
app.post('/api/test/set-reset-passed', (req, res) => {
  if (aiAllocationLock.blocked) {
    aiAllocationLock.blockedUntil = Date.now() - 5000;
  }
  res.json({
    success: true,
    blocked: aiAllocationLock.blocked,
    blockedUntil: aiAllocationLock.blockedUntil,
    isAfterResetTime: isAfterResetTime()
  });
});

// POST /api/test/clear-block - Clear allocation block flag
app.post('/api/test/clear-block', (req, res) => {
  const lock = clearAiBlocked();
  res.json({
    success: true,
    blocked: lock.blocked
  });
});

// Fallback to index.html for any GET routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`FocusGen listening on port ${PORT} (bound to ${HOST})`);
  });
}

module.exports = {
  app,
  generateImage,
  expandPhotorealisticPrompt,
  sanitizeMessage,
  getCloudflareModel,
  getCloudflareFallbackModel,
  getAvailableCloudflareModels,
  parseCloudflareError,
  setAiBlocked3036,
  clearAiBlocked,
  isAiBlocked,
  isAfterResetTime
};
