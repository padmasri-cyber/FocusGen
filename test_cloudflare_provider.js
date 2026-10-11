// test_cloudflare_provider.js
// Test suite for Cloudflare Workers AI provider, wrong token fallback, and IMAGE_PROVIDER=none

const assert = require('assert');
const http = require('http');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(rawData);
          resolve({ status: res.statusCode, headers: res.headers, data: json, raw: rawData });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: rawData, raw: rawData });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 TESTING CLOUDFLARE WORKERS AI PROVIDER & FALLBACK PIPELINE');
  console.log('================================================================\n');

  const { generateImage, expandPhotorealisticPrompt, sanitizeMessage } = require('./server');

  // TEST 1: SanitizeMessage check (never expose keys)
  console.log('[TEST 1] Testing key redaction in sanitizeMessage...');
  const testSecret = 'cf_secret_token_abcdef_99999';
  const sanitized = sanitizeMessage(`Failed with key ${testSecret} and Bearer abc123xyz456`, testSecret);
  assert(!sanitized.includes(testSecret), 'Secret must be redacted');
  assert(!sanitized.includes('abc123xyz456'), 'Bearer token must be redacted');
  console.log('  ✓ Keys and Bearer tokens are strictly sanitized:', sanitized);

  // TEST 2: Photorealistic prompt expansion
  console.log('\n[TEST 2] Testing photorealistic prompt expansion...');
  const promptChat = expandPhotorealisticPrompt('cake', 'chat');
  assert(promptChat.includes('photorealistic'), 'Includes photorealistic');
  assert(promptChat.includes('natural lighting'), 'Includes natural lighting');
  assert(promptChat.includes('DSLR photo'), 'Includes DSLR photo');
  assert(promptChat.includes('no cartoon'), 'Includes negative prompt: no cartoon');
  assert(promptChat.includes('no 3D render'), 'Includes negative prompt: no 3D render');
  console.log('  ✓ Photorealistic prompt expands accurately:', promptChat.slice(0, 110) + '...');

  // TEST 3: Diagnose endpoint with current active configuration
  console.log('\n[TEST 3] Testing GET /api/diagnose with active provider...');
  const diagRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/diagnose',
    method: 'GET'
  });
  assert.strictEqual(diagRes.status, 200, 'Status should be 200');
  const diag = diagRes.data;
  console.log('  Diagnose Result:');
  console.log('    Provider:', diag.provider);
  console.log('    Model:', diag.model);
  console.log('    Key loaded:', diag.keyLoaded);
  console.log('    Model reachable:', diag.modelReachable);
  console.log('    Status:', diag.status);
  console.log('    Message:', diag.message);
  assert.strictEqual(diag.provider, 'cloudflare', 'Provider should be cloudflare');
  assert.strictEqual(diag.keyLoaded, true, 'Key is loaded in .env');
  if (diag.status === 'ok') {
    assert.strictEqual(diag.modelReachable, true, 'Model is reachable on Cloudflare');
    console.log('  ✓ Diagnose correctly reports Cloudflare Workers AI is online and reachable');
  } else {
    assert(diag.error && (diag.httpStatus === 429 || diag.category === 'quota_rate_limit' || diag.message.includes('429') || diag.error.includes('neurons')), 'Diagnose accurately reports rate limit or error in plain language');
    console.log('  ✓ Diagnose accurately reports provider status in plain language:', diag.message);
  }

  // TEST 4: Generate "cake" for Phone chat via Cloudflare Workers AI
  console.log('\n[TEST 4] Testing "cake" for Phone chat via Cloudflare Workers AI...');
  const chatGenRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/generate',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    word: 'cake',
    purpose: 'chat',
    tier: 'Sketch'
  });
  assert.strictEqual(chatGenRes.status, 200, 'Status should be 200');
  const chatData = chatGenRes.data;
  assert(chatData.success, 'Success is true');
  if (chatData.type === 'ai_image') {
    assert(chatData.imageBase64 && chatData.imageBase64.length > 50, 'Image data returned');
    assert.strictEqual(chatData.mimeType, 'image/webp', 'WebP compressed image');
    assert.strictEqual(chatData.sourceTag, 'Cloudflare FLUX', 'sourceTag is Cloudflare FLUX');
    assert.strictEqual(chatData.statusTag, 'Cloudflare FLUX', 'statusTag is Cloudflare FLUX');
    assert(chatData.costChip && chatData.costChip.startsWith('Estimated'), 'Cost chip starts with Estimated');
    console.log(`  ✓ Image generated successfully! Dimensions: ${chatData.width}x${chatData.height}`);
    console.log(`  ✓ Source Tag: "${chatData.sourceTag}", Cost Chip: "${chatData.costChip}"`);
  } else if (chatData.type === 'web_photos') {
    assert(chatData.fallbackFromAi, 'fallbackFromAi is true');
    assert(chatData.photos && chatData.photos.length > 0, 'Photos array populated');
    assert.strictEqual(chatData.sourceTag, 'Web photo');
    console.log(`  ✓ Quota guard activated: successfully fell back to licensed web photos`);
    console.log(`  ✓ Source Tag: "${chatData.sourceTag}", Cost Chip: "${chatData.costChip}"`);
  }

  // TEST 5: Generate "cake" for Print mode with Cloudflare Workers AI (Honest size notice)
  console.log('\n[TEST 5] Testing "cake" for Print mode (1920x1080) with size notice honesty...');
  const printGenRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/generate',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    word: 'cake',
    purpose: 'print',
    tier: 'Max'
  });
  assert.strictEqual(printGenRes.status, 200);
  const printData = printGenRes.data;
  assert(printData.success);
  if (printData.type === 'ai_image') {
    assert(printData.sizeNotice, 'Honest sizeNotice present when native resolution is smaller than 1920x1080');
    console.log(`  ✓ Print generation successful! Dimensions: ${printData.width}x${printData.height}`);
    console.log(`  ✓ Honest Size Notice: "${printData.sizeNotice}"`);
  } else if (printData.type === 'web_photos') {
    assert(printData.fallbackFromAi, 'fallbackFromAi is true');
    console.log(`  ✓ Print fallback successful; returned licensed photos with honest costChip: "${printData.costChip}"`);
  }

  // TEST 6: Wrong Cloudflare token test (friendly error plus licensed web photos)
  console.log('\n[TEST 6] Testing wrong token: safe error handling & automatic web photos fallback...');
  const wrongToken = 'cf_fake_invalid_secret_token_12345';
  let wrongErr = null;
  try {
    const origToken = process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = wrongToken;
    await generateImage('cloudflare', 'photorealistic cake', { purpose: 'chat' });
    process.env.CLOUDFLARE_API_TOKEN = origToken;
  } catch (err) {
    wrongErr = err;
    process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
  }
  assert(wrongErr, 'Wrong token must throw');
  assert(!wrongErr.message.includes(wrongToken), 'Must never leak the wrong token');
  assert.strictEqual(wrongErr.statusCode, 401, 'Status code is 401');
  console.log(`  ✓ Safe error caught without exposing keys: "${wrongErr.message}"`);

  // Test that /api/generate with an invalid provider option or bad token falls back to web photos
  console.log('  Testing fallback behavior when AI provider is rejected...');
  const fallbackRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/generate',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    word: 'cake',
    purpose: 'chat',
    tier: 'Sketch',
    provider: 'none' // simulates AI unavailable / disabled
  });
  assert.strictEqual(fallbackRes.status, 200);
  const fallbackData = fallbackRes.data;
  assert(fallbackData.success);
  assert.strictEqual(fallbackData.type, 'web_photos');
  assert(fallbackData.fallbackFromAi);
  assert(fallbackData.photos && fallbackData.photos.length > 0);
  assert.strictEqual(fallbackData.statusTag, 'Web photo');
  assert.strictEqual(fallbackData.sourceTag, 'Web photo');
  assert(fallbackData.aiMessage && (fallbackData.aiMessage.includes('licensed') || fallbackData.aiMessage.includes('photos')), 'Friendly fallback notice present');
  console.log(`  ✓ Fallback produced ${fallbackData.photos.length} licensed web photos`);
  console.log(`  ✓ Friendly message: "${fallbackData.aiMessage}"`);

  // TEST 7: Test with IMAGE_PROVIDER=none
  console.log('\n[TEST 7] Testing IMAGE_PROVIDER=none directly...');
  let noneErr = null;
  try {
    await generateImage('none', 'photorealistic cake', { purpose: 'chat' });
  } catch (err) {
    noneErr = err;
  }
  assert(noneErr && noneErr.isNone, 'Should trigger provider_none signal');
  console.log('  ✓ generateImage("none") signals provider_none correctly');

  console.log('\n================================================================');
  console.log('🎉 ALL CLOUDFLARE PROVIDER AND FALLBACK TESTS PASSED!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
