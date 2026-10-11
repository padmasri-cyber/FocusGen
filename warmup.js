/**
 * FocusGen Warmup Script (npm run warmup)
 * Pre-generates and caches 3 demo requests:
 * 1. "cake for my whatsapp status" (Phone chat, 640x360)
 * 2. "temple poster for college fest" (Poster, 1280x720)
 * 3. "tiger for school project slide" (School project, 1024x576)
 *
 * Spaced 15 seconds apart to respect Pollinations anonymous tier rate limits.
 * Pre-caches both the AI generated images and licensed web photos.
 */

require('dotenv').config();
const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}
const sharp = require('sharp');
const aiCache = require('./aiCache');
const webSearch = require('./webSearch');
const purposeEngine = require('./purpose');
const estimate = require('./estimate');

const DEMO_REQUESTS = [
  {
    rawText: 'cake for my whatsapp status',
    defaultPurpose: 'chat',
    width: 640,
    height: 360,
    subject: 'cake'
  },
  {
    rawText: 'temple poster for college fest',
    defaultPurpose: 'poster',
    width: 1280,
    height: 720,
    subject: 'temple'
  },
  {
    rawText: 'tiger for school project slide',
    defaultPurpose: 'school',
    width: 1024,
    height: 576,
    subject: 'tiger'
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPollinationsImage(prompt, width, height) {
  const seed = Math.floor(Math.random() * 1000000);
  const cleanPrompt = `${prompt}, photorealistic, natural lighting, DSLR photo, no cartoon, no illustration`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=flux&width=${width}&height=${height}&seed=${seed}&nologo=true`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'FocusGen/2.0 (Eco-Adaptive Visual Intelligence Warmup; contact@focusgen.local)',
      'Accept': 'image/jpeg,image/png,image/webp,*/*'
    },
    signal: controller.signal
  });
  clearTimeout(timeoutId);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from Pollinations`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function runWarmup() {
  console.log('================================================================');
  console.log('⚡ FOCUSGEN DEMO WARMUP: PRE-GENERATING & CACHING DEMO REQUESTS');
  console.log('================================================================\n');

  const summary = [];

  for (let i = 0; i < DEMO_REQUESTS.length; i++) {
    const item = DEMO_REQUESTS[i];
    console.log(`[${i + 1}/3] Processing: "${item.rawText}"...`);

    // 1. Infer purpose
    const inferred = await purposeEngine.inferPurpose(item.rawText);
    const purpose = inferred.purposeKey || item.defaultPurpose;
    const cleanSubject = webSearch.extractSearchKeywords(item.rawText) || item.subject;
    const width = item.width;
    const height = item.height;

    console.log(`   Subject: "${cleanSubject}" | Purpose: ${purpose} (${width}×${height})`);

    // 2. Pre-cache licensed web photos
    try {
      console.log(`   Searching licensed web photos for "${cleanSubject}"...`);
      const searchRes = await webSearch.searchLicensedPhotos(cleanSubject, purpose);
      console.log(`   ✓ Web search cached: ${searchRes.photos?.length || 0} photos found.`);
    } catch (wErr) {
      console.warn(`   Web search warning:`, wErr.message);
    }

    // 3. Generate Pollinations image (Check cache first)
    const existingCache = aiCache.get(cleanSubject, purpose, width, height) || aiCache.get(item.rawText, purpose, width, height);
    if (existingCache && existingCache.imageBase64) {
      console.log(`   ⚡ Already in cache (${existingCache.sizeFormatted || 'available'})! Skipping external API call.`);
      summary.push({
        prompt: item.rawText,
        subject: cleanSubject,
        purpose,
        size: `${width}×${height}`,
        bytes: existingCache.sizeFormatted || 'Cached',
        time: 'Instant',
        status: 'CACHED'
      });
      continue;
    }

    const startTime = Date.now();
    console.log(`   Calling Pollinations FLUX API (${width}×${height})...`);
    let rawBuffer = null;
    let elapsedSecs = '0.0';

    try {
      try {
        rawBuffer = await fetchPollinationsImage(cleanSubject, width, height);
      } catch (firstErr) {
        if (firstErr.message && firstErr.message.includes('402')) {
          console.warn('   ⚠️ 402 anonymous rate limit hit. Waiting 16s before single retry...');
          for (let s = 16; s > 0; s--) {
            process.stdout.write(`\r   Backoff: ${s}s remaining...`);
            await sleep(1000);
          }
          process.stdout.write('\r   Backoff complete. Retrying now...\n');
          rawBuffer = await fetchPollinationsImage(cleanSubject, width, height);
        } else if (firstErr.message && (firstErr.message.includes('fetch failed') || firstErr.message.includes('abort') || firstErr.message.includes('timeout'))) {
          console.warn(`   ⚠️ Transient error (${firstErr.message}). Waiting 4s before single retry...`);
          await sleep(4000);
          rawBuffer = await fetchPollinationsImage(cleanSubject, width, height);
        } else {
          throw firstErr;
        }
      }

      elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(1);

      // Process and optimize with sharp
      const webpBuffer = await sharp(rawBuffer)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const imageBase64 = webpBuffer.toString('base64');
      const costReport = estimate.computeCostReport(purpose, false, true, 0, inferred.tier || 'Standard');
      const costChip = estimate.formatCostChipText(costReport);

      const entry = {
        word: cleanSubject,
        rawText: item.rawText,
        purpose,
        width,
        height,
        imageBase64,
        mimeType: 'image/webp',
        sourceTag: 'Cached',
        costReport,
        costChip,
        prompt: cleanSubject,
        sizeFormatted: `${(webpBuffer.length / 1024).toFixed(1)} KB`,
        cachedAt: Date.now()
      };

      // Save under both clean subject and full prompt keys
      const key1 = aiCache.getCacheKey(cleanSubject, purpose, width, height);
      const key2 = aiCache.getCacheKey(item.rawText, purpose, width, height);
      aiCache.set(key1, entry);
      aiCache.set(key2, entry);

      console.log(`   ✅ Successfully cached (${(webpBuffer.length / 1024).toFixed(1)} KB in ${elapsedSecs}s)`);
      summary.push({
        prompt: item.rawText,
        subject: cleanSubject,
        purpose,
        size: `${width}×${height}`,
        bytes: `${(webpBuffer.length / 1024).toFixed(1)} KB`,
        time: `${elapsedSecs}s`,
        status: 'CACHED'
      });
    } catch (err) {
      console.error(`   ❌ Generation failed for "${item.rawText}":`, err.message);
      summary.push({
        prompt: item.rawText,
        subject: cleanSubject,
        purpose,
        size: `${width}×${height}`,
        bytes: 'N/A',
        time: 'Failed',
        status: `ERROR: ${err.message}`
      });
    }

    // 4. Rate-limiting interval (16s spacing between requests)
    if (i < DEMO_REQUESTS.length - 1) {
      console.log('\n⏳ Waiting 16 seconds to respect Pollinations anonymous tier rate limit...');
      for (let s = 16; s > 0; s--) {
        process.stdout.write(`\r   Countdown: ${s}s remaining...`);
        await sleep(1000);
      }
      process.stdout.write('\r   Countdown: Complete! Resuming next request.\n\n');
    }
  }

  console.log('\n================================================================');
  console.log('WARMUP SUMMARY TABLE');
  console.log('================================================================');
  console.table(summary);
  console.log('🎉 All demo images pre-cached on disk and in memory!');
  console.log('Now these requests will load INSTANTLY in FocusGen.');
  console.log('================================================================\n');
}

if (require.main === module) {
  runWarmup().catch(err => {
    console.error('Warmup fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runWarmup };
