const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'data', 'ai_cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// In-memory cache
const memoryCache = new Map();

/**
 * Normalizes cache key: (word, purpose, width, height)
 * E.g. "cat__chat__640x360"
 */
function getCacheKey(word, purpose, width, height) {
  const cleanW = (word || 'subject').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const cleanP = (purpose || 'chat').toLowerCase().trim();
  const w = width || 640;
  const h = height || 360;
  return `${cleanW}__${cleanP}__${w}x${h}`;
}

/**
 * Load all disk cache files into memory on startup
 */
function initCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = fs.readdirSync(CACHE_DIR);
    let count = 0;
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(CACHE_DIR, file);
          const raw = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(raw);
          const key = file.replace(/\.json$/, '');
          memoryCache.set(key, data);
          count++;
        } catch (e) {}
      }
    }
    if (count > 0) {
      console.log(`[AI Cache] Loaded ${count} cached images into memory from ${CACHE_DIR}`);
    }
  } catch (err) {
    console.warn('[AI Cache] Init warning:', err.message);
  }
}

/**
 * Get cached image by key or (word, purpose, width, height)
 */
function get(keyOrWord, purpose, width, height) {
  const key = (purpose !== undefined && width !== undefined)
    ? getCacheKey(keyOrWord, purpose, width, height)
    : keyOrWord;

  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }

  // Check disk
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      memoryCache.set(key, data);
      return data;
    }
  } catch (e) {
    console.warn('[AI Cache] Disk read error:', e.message);
  }

  return null;
}

/**
 * Save image to memory and disk cache
 */
function set(keyOrWord, entry, purpose, width, height) {
  let key = keyOrWord;
  let data = entry;
  if (purpose !== undefined && width !== undefined) {
    key = getCacheKey(keyOrWord, purpose, width, height);
  }

  if (!data.key) data.key = key;
  if (!data.cachedAt) data.cachedAt = Date.now();
  data.sourceTag = 'Cached';

  memoryCache.set(key, data);

  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[AI Cache] Disk write error:', err.message);
  }

  return data;
}

/**
 * Check if cached
 */
function has(keyOrWord, purpose, width, height) {
  return !!get(keyOrWord, purpose, width, height);
}

/**
 * List all cached entries summary
 */
function list() {
  const entries = [];
  for (const [key, val] of memoryCache.entries()) {
    entries.push({
      key,
      word: val.word,
      purpose: val.purpose,
      width: val.width,
      height: val.height,
      cachedAt: val.cachedAt,
      sizeBytes: val.imageBase64 ? Buffer.byteLength(val.imageBase64, 'base64') : 0
    });
  }
  return entries;
}

// Initialize on module load
initCache();

module.exports = {
  getCacheKey,
  initCache,
  get,
  set,
  has,
  list
};
