// webSearch.js - Robust Keyless Licensed Photography Search Engine
// Sources: Wikimedia Commons (commons.wikimedia.org & en.wikipedia.org failover) + Openverse API
const https = require('https');

// 24-Hour Memory Cache
const searchCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Terms identifying non-photographic graphics
const NON_PHOTO_TERMS = [
  'logo', 'icon', 'map', 'diagram', 'drawing', 'illustration', 'sketch',
  'vector', 'clipart', 'flag', 'coat of arms', 'symbol', 'plan', 'chart',
  'blueprint', 'cartoon', 'stamp', 'sign', 'emblem', 'silhouette', 'graphic',
  'infographic', 'layout', 'schema', 'cad', '3d model', 'render', 'painting',
  'watercolor', 'anime', 'manga', 'caricature', 'doodle', 'stencil', 'poster'
];

// Minimum size requirements by purpose
const PURPOSE_MIN_DIMENSIONS = {
  chat: { minW: 360, minH: 240 },
  school: { minW: 640, minH: 360 },
  poster: { minW: 900, minH: 500 },
  print: { minW: 1000, minH: 600 }
};

/**
 * Robust IPv4 JSON fetcher with redirect and timeout support
 */
function fetchWithTimeout(url, headers = {}, timeoutMs = 7000, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return reject(new Error('Invalid URL'));
    }
    const client = url.startsWith('http:') ? require('http') : https;
    const req = client.get(url, {
      family: 4,
      headers: {
        'User-Agent': 'FocusGen-EcoApp/2.0 (https://focusgen.local; contact@focusgen.local; open-licensed-media-client)',
        'Accept': 'application/json',
        ...headers
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const parsed = new URL(url);
          redirectUrl = new URL(redirectUrl, parsed.origin).href;
        }
        return fetchWithTimeout(redirectUrl, headers, timeoutMs, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 429) {
        return reject(new Error('RATE_LIMITED'));
      }
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
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

/**
 * Checks if license is reusable: CC0, Public Domain, CC BY, CC BY-SA
 * Strictly rejects No-Derivatives (ND) and non-free licenses.
 */
function isReusableLicense(licenseStr) {
  if (!licenseStr || typeof licenseStr !== 'string') return false;
  const l = licenseStr.toLowerCase().trim();

  // Reject No-Derivatives (ND) - Cannot be resized or compressed
  if (l.includes('nd') || l.includes('no-derivative') || l.includes('noderiv') || l.includes('no derivative')) {
    return false;
  }
  // Reject non-free copyright
  if (l.includes('all rights reserved') || l.includes('fair use') || l.includes('copyrighted') || l.includes('restricted')) {
    return false;
  }

  // Allow only reusable licenses: CC0, Public Domain, CC BY, CC BY-SA
  const isPD = l.includes('cc0') || l.includes('public domain') || l.includes('pd') || l.includes('cc-zero');
  const isCC = l.includes('cc by') || l.includes('cc-by') || l.includes('by 2.') || l.includes('by 3.') || l.includes('by 4.') || l.includes('by-sa') || l.includes('by sa') || l.includes('attribution');

  return isPD || isCC;
}

/**
 * Checks if item is an authentic photograph (not a logo, vector, icon, drawing, map)
 */
function isPhotographicContent(title = '', tags = [], mime = '', url = '') {
  const fullText = `${title} ${tags.join(' ')} ${url}`.toLowerCase();

  for (const term of NON_PHOTO_TERMS) {
    const regex = new RegExp(`(^|[^a-z])${term}([^a-z]|$)`, 'i');
    if (regex.test(fullText)) {
      return false;
    }
  }

  const cleanUrl = (url.split('?')[0] || '').toLowerCase();
  const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
  const hasValidExt = validExts.some(ext => cleanUrl.endsWith(ext));
  if (!hasValidExt && mime && !mime.startsWith('image/jpeg') && !mime.startsWith('image/png') && !mime.startsWith('image/webp')) {
    return false;
  }

  return true;
}

/**
 * 1. Query Openverse API (Keyless)
 */
async function queryOpenverse(cleanQuery, purpose) {
  const items = [];
  try {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(cleanQuery)}&page_size=16&license_type=commercial,modification`;
    const data = await fetchWithTimeout(url, {}, 5500);

    if (data && Array.isArray(data.results)) {
      const minSpec = PURPOSE_MIN_DIMENSIONS[purpose] || PURPOSE_MIN_DIMENSIONS.chat;

      for (const r of data.results) {
        const title = r.title || cleanQuery;
        const width = r.width || 0;
        const height = r.height || 0;
        const imgUrl = r.url;

        if (!isPhotographicContent(title, r.tags ? r.tags.map(t => t.name) : [], '', imgUrl)) {
          continue;
        }

        if (width > 0 && height > 0) {
          if (width < minSpec.minW || height < minSpec.minH) continue;
        }

        const rawLicense = r.license ? `CC ${r.license.toUpperCase()} ${r.license_version || ''}`.trim() : 'CC BY';
        if (!isReusableLicense(rawLicense)) {
          continue;
        }

        const creatorName = r.creator || 'Openverse Contributor';
        const licenseUrl = r.license_url || 'https://creativecommons.org';

        items.push({
          id: `ov_${r.id}`,
          title: cleanTitle(title),
          creator: creatorName,
          photographer: creatorName,
          creatorUrl: r.creator_url || r.foreign_landing_url || imgUrl,
          photographerUrl: r.creator_url || r.foreign_landing_url || imgUrl,
          source: 'Openverse',
          sourceBadge: 'Openverse',
          sourceUrl: r.foreign_landing_url || imgUrl,
          license: rawLicense,
          licenseUrl,
          thumbUrl: r.thumbnail || imgUrl,
          fullUrl: imgUrl,
          width: width || 1280,
          height: height || 720,
          score: calculateRelevanceScore(cleanQuery, title, width, height)
        });
      }
    }
  } catch (err) {
    if (err.message === 'RATE_LIMITED') {
      console.warn('Openverse rate limit reached');
    }
  }
  return items;
}

/**
 * 2. Query Wikimedia Commons / Wikipedia API (Keyless with failover)
 */
async function queryWikimedia(cleanQuery, purpose) {
  const items = [];
  const minSpec = PURPOSE_MIN_DIMENSIONS[purpose] || PURPOSE_MIN_DIMENSIONS.chat;

  // Try commons.wikimedia.org, then en.wikipedia.org failover
  const endpoints = [
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrnamespace=6&gsrlimit=16&prop=imageinfo&iiprop=url|size|mime|user|extmetadata&iiurlwidth=800&format=json`,
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrnamespace=6&gsrlimit=16&prop=imageinfo&iiprop=url|size|mime|user|extmetadata&iiurlwidth=800&format=json`
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await fetchWithTimeout(endpoint, {}, 4500);
      if (data && data.query && data.query.pages) {
        for (const pageId of Object.keys(data.query.pages)) {
          const page = data.query.pages[pageId];
          if (page.imageinfo && page.imageinfo[0]) {
            const info = page.imageinfo[0];
            const imgUrl = info.url;
            const meta = info.extmetadata || {};
            const title = page.title ? page.title.replace('File:', '') : cleanQuery;
            const width = info.width || 0;
            const height = info.height || 0;

            if (!isPhotographicContent(title, [], info.mime, imgUrl)) {
              continue;
            }

            if (width > 0 && height > 0) {
              if (width < minSpec.minW || height < minSpec.minH) continue;
            }

            const licName = meta.LicenseShortName ? meta.LicenseShortName.value : (meta.License ? meta.License.value : 'CC BY-SA');
            if (!isReusableLicense(licName)) {
              continue;
            }

            const rawArtist = (meta.Artist ? meta.Artist.value : null) || info.user || 'Wikimedia Contributor';
            const cleanArtist = rawArtist.replace(/<[^>]*>?/gm, '').trim() || info.user;
            const cleanLic = licName.replace(/<[^>]*>?/gm, '').trim();

            items.push({
              id: `wm_${pageId}`,
              title: cleanTitle(title),
              creator: cleanArtist,
              photographer: cleanArtist,
              creatorUrl: `https://commons.wikimedia.org/wiki/User:${encodeURIComponent(info.user || '')}`,
              photographerUrl: `https://commons.wikimedia.org/wiki/User:${encodeURIComponent(info.user || '')}`,
              source: 'Wikimedia Commons',
              sourceBadge: 'Wikimedia',
              sourceUrl: info.descriptionurl || imgUrl,
              license: cleanLic,
              licenseUrl: meta.LicenseUrl ? meta.LicenseUrl.value : 'https://creativecommons.org',
              thumbUrl: info.thumburl || imgUrl,
              fullUrl: imgUrl,
              width: width || 1280,
              height: height || 720,
              score: calculateRelevanceScore(cleanQuery, title, width, height)
            });
          }
        }
        if (items.length > 0) break; // Succeeded, no need for second endpoint
      }
    } catch (err) {
      if (err.message === 'RATE_LIMITED') {
        console.warn('Wikimedia rate limit encountered');
      }
    }
  }

  return items;
}

function cleanTitle(str) {
  if (!str) return 'Untitled Photograph';
  const noExt = str.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  const clean = noExt.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function calculateRelevanceScore(query, title, width, height) {
  let score = 10;
  const qTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tLower = (title || '').toLowerCase();

  for (const term of qTerms) {
    if (tLower.includes(term)) score += 20;
  }

  // Bonus for high resolution
  if (width && height) {
    const px = width * height;
    if (px >= 1000000) score += 10; // > 1 Megapixel
    else if (px >= 500000) score += 5;
  }

  return score;
}

function extractSearchKeywords(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let str = raw.trim();
  str = str.replace(/^["'`]+|["'`]+$/g, '');
  str = str.replace(/^(can you (please )?|please |could you |i want (to see )?|give me |show me |find me |get me |search for |generate |create |draw |make )+/i, '');
  str = str.replace(/^(a |an |the |some )+/i, '');
  str = str.replace(/^(picture of |photo of |image of |photograph of |photos of |pictures of |images of )+/i, '');
  str = str.replace(/^(a |an |the )+/i, '');
  // Strip trailing purpose phrases (e.g., "for my whatsapp status", "poster for college fest", "for school project slide")
  const strippedPurpose = str.replace(/\s+(poster|wallpaper|slide|photo)?\s*(for\s+.*)$/i, '').replace(/\s+(poster|wallpaper|slide)$/i, '').trim();
  if (strippedPurpose && strippedPurpose.length >= 2) {
    str = strippedPurpose;
  }
  str = str.replace(/[?!.,;:]+$/g, '').trim();
  return str || raw.trim();
}

/**
 * Main Entry Point: Keyless Parallel Search Engine with 24-Hour Cache
 * Queries Wikimedia Commons & Openverse in parallel
 */
async function searchLicensedPhotos(query, purpose = 'chat') {
  const rawQuery = (query || '').trim();
  if (!rawQuery) return { success: false, photos: [] };

  const cleanQuery = extractSearchKeywords(rawQuery) || rawQuery;
  const cacheKey = `${cleanQuery.toLowerCase()}_${(purpose || 'chat').toLowerCase()}`;

  // Check 24-hour cache
  if (searchCache.has(cacheKey)) {
    const entry = searchCache.get(cacheKey);
    if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
      return { success: true, fromCache: true, photos: entry.photos };
    } else {
      searchCache.delete(cacheKey);
    }
  }

  // Search Wikimedia Commons & Openverse in parallel with timeout
  const [wmRes, ovRes] = await Promise.allSettled([
    queryWikimedia(cleanQuery, purpose),
    queryOpenverse(cleanQuery, purpose)
  ]);

  const allFound = [
    ...(wmRes.status === 'fulfilled' ? wmRes.value : []),
    ...(ovRes.status === 'fulfilled' ? ovRes.value : [])
  ];

  // Deduplicate by clean image URL
  const seenUrls = new Set();
  const deduped = [];

  for (const item of allFound) {
    const cleanUrl = item.fullUrl.split('?')[0].toLowerCase();
    if (!seenUrls.has(cleanUrl)) {
      seenUrls.add(cleanUrl);
      deduped.push(item);
    }
  }

  // Rank photos by relevance score and resolution
  deduped.sort((a, b) => b.score - a.score);

  const top4 = deduped.slice(0, 4);

  // Cache results for 24 hours
  if (top4.length > 0) {
    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      photos: top4
    });
  }

  return {
    success: true,
    count: top4.length,
    photos: top4
  };
}

module.exports = {
  searchLicensedPhotos,
  queryWikimedia,
  queryOpenverse,
  extractSearchKeywords,
  searchCache
};
