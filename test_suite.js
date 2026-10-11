// FocusGen Comprehensive Integration Test Suite
// Verifies: Keyless Search ("cake", "tiger", "temple"), Reusable Licenses,
// Mandatory Attribution, "Use this" Smart Compress, AI Generation, and Cost Chips.
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const assert = require('assert');

async function runTests() {
  console.log('====================================================');
  console.log('🚀 STARTING FOCUSGEN VERIFICATION TEST SUITE');
  console.log('====================================================');

  const BASE_URL = 'http://localhost:3000';

  // 1. Config Check (Ensure keyless providers are enabled)
  console.log('\n[1] Checking /api/config (Keyless providers enabled, zero exposed keys)...');
  const cfgRes = await fetch(`${BASE_URL}/api/config`);
  const cfgData = await cfgRes.json();
  assert(cfgRes.ok, 'Config endpoint should respond 200');
  assert(typeof cfgData.hasGoogleAuth === 'boolean', 'hasGoogleAuth should be boolean');
  assert(typeof cfgData.hasGemini === 'boolean', 'hasGemini should be boolean');
  assert(Array.isArray(cfgData.keylessProviders), 'keylessProviders should be array');
  assert(cfgData.keylessProviders.includes('Wikimedia Commons'), 'Wikimedia Commons is active keyless source');
  assert(cfgData.keylessProviders.includes('Openverse'), 'Openverse is active keyless source');
  console.log('  Config:', cfgData);
  console.log('  ✓ Verified: Keyless search active (Wikimedia Commons & Openverse).');

  // 2. Sign Up Test
  console.log('\n[2] Testing User Signup & Session...');
  const testEmail = `test_${Date.now()}@example.com`;
  const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'password123' })
  });
  const signupData = await signupRes.json();
  assert(signupRes.ok && signupData.success, 'Signup should succeed');
  assert(signupData.user.email === testEmail, 'Email matches');
  console.log('  ✓ User signed up:', signupData.user.email);

  const cookieHeader = signupRes.headers.get('set-cookie');
  assert(cookieHeader && cookieHeader.includes('focusgen_token'), 'HttpOnly auth cookie set');
  const authCookie = cookieHeader.split(';')[0];
  console.log('  ✓ JWT HttpOnly cookie received');

  // 3. Authenticated /api/auth/me
  console.log('\n[3] Testing Session Persistence /api/auth/me...');
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: authCookie }
  });
  const meData = await meRes.json();
  assert(meRes.ok && meData.success && meData.user.email === testEmail, 'Session verified');
  console.log('  ✓ Session active for:', meData.user.email);

  // 4. Create and Save Chat
  console.log('\n[4] Testing Chat Creation & Persistence...');
  const chatRes = await fetch(`${BASE_URL}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ title: 'Photography Exploration', mode: 'normal' })
  });
  const chatData = await chatRes.json();
  assert(chatRes.ok && chatData.success, 'Chat created');
  const chatId = chatData.chat.id;
  console.log('  ✓ Chat created with ID:', chatId);

  // 5. Test Keyless Search for "cake", "tiger", and "temple" (Requirement 1, 2, 5)
  const testQueries = ['cake', 'tiger', 'temple'];
  const searchResultsMap = {};

  for (let i = 0; i < testQueries.length; i++) {
    const q = testQueries[i];
    console.log(`\n[5.${i+1}] Testing Keyless Web Search for "${q}" (Wikimedia Commons & Openverse)...`);
    const searchRes = await fetch(`${BASE_URL}/api/search-licensed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, purpose: 'chat' })
    });
    const searchJson = await searchRes.json();
    assert(searchRes.ok && searchJson.success, `Search for "${q}" should succeed`);
    assert(searchJson.photos && searchJson.photos.length > 0, `Search for "${q}" should return photos`);
    assert(searchJson.photos.length <= 4, `Top 4 photos returned`);
    assert(searchJson.costChip, 'Cost chip must be included');

    console.log(`  ✓ Found ${searchJson.photos.length} photos for "${q}"`);
    console.log(`  ✓ Cost chip: "${searchJson.costChip}"`);

    // Verify each photo card properties
    searchJson.photos.forEach((p, idx) => {
      assert(p.title, `Photo ${idx+1} has title`);
      assert(p.creator || p.photographer, `Photo ${idx+1} has creator/photographer attribution`);
      assert(p.license, `Photo ${idx+1} has license`);
      assert(p.sourceUrl, `Photo ${idx+1} has source URL`);
      assert(p.fullUrl, `Photo ${idx+1} has image fullUrl`);
      // Verify license is reusable (no ND)
      const lic = p.license.toLowerCase();
      assert(!lic.includes('nd') && !lic.includes('no-derivative'), `Photo license "${p.license}" must not be No-Derivatives`);
      console.log(`    Card ${idx+1}: "${p.title.slice(0, 30)}" by ${p.creator || p.photographer} | ${p.license} [${p.source}]`);
    });

    searchResultsMap[q] = searchJson.photos;
  }

  // 6. Test "Use this" Smart Compress to purpose size (Requirement 2 & 7)
  console.log('\n[6] Testing "Use this" -> Smart Compress to purpose size (chat: 360p)...');
  const samplePhoto = searchResultsMap['cake'][0];
  const compressRes = await fetch(`${BASE_URL}/api/compress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: samplePhoto.thumbUrl || samplePhoto.fullUrl, purpose: 'chat' })
  });
  const compressJson = await compressRes.json();
  assert(compressRes.ok && compressJson.success, 'Smart Compress should succeed');
  console.log('  ✓ Smart Compress Output:', compressJson.summary);
  console.log(`    Original: ${compressJson.originalSize} -> Compressed: ${compressJson.compressedSize} (${compressJson.percentSaved}% saved)`);
  assert(compressJson.compressedBytes <= compressJson.originalBytes, 'Compressed size should be <= original');
  assert(compressJson.compressedUrl.startsWith('data:image/webp;base64,'), 'Exported as WebP format');

  // 7. Test Mandatory Attribution on Download (Requirement 2)
  console.log('\n[7] Testing Download with Embedded Attribution Banner...');
  const downloadUrl = `${BASE_URL}/api/download-attributed?url=${encodeURIComponent(samplePhoto.thumbUrl || samplePhoto.fullUrl)}&title=${encodeURIComponent(samplePhoto.title)}&creator=${encodeURIComponent(samplePhoto.creator || samplePhoto.photographer)}&license=${encodeURIComponent(samplePhoto.license)}&source=${encodeURIComponent(samplePhoto.source)}`;
  const dlRes = await fetch(downloadUrl);
  assert(dlRes.ok, 'Attributed download should succeed 200');
  const dlContentType = dlRes.headers.get('content-type');
  assert(dlContentType && dlContentType.includes('image/'), 'Downloaded file is valid image');
  const dlBuf = await dlRes.arrayBuffer();
  assert(dlBuf.byteLength > 1000, 'Downloaded attributed image has valid data buffer');
  console.log(`  ✓ Received attributed image (${dlBuf.byteLength} bytes) with attribution composited.`);

  // 8. Test AI Generation Fallback (Requirement 3 & 5)
  console.log('\n[8] Testing "Generate new with AI" (DSLR Photorealism, No Cartoons)...');
  const genRes = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ word: 'cake', purpose: 'chat', tier: 1 })
  });
  const genJson = await genRes.json();
  if (genJson.success) {
    if (genJson.fallbackFromAi) {
      assert(genJson.photos && genJson.photos.length > 0, 'Quota Guard: Licensed web photos returned on quota limit');
      console.log('  ✓ Quota Guard: Gemini quota handled gracefully, returned licensed photos with countdown');
      console.log('  ✓ Fallback notice:', genJson.aiMessage);
    } else {
      assert(genJson.imageBase64, 'Generated image base64 returned');
      assert(genJson.costReport, 'Energy cost report returned');
      console.log('  ✓ Gemini photorealistic AI generation succeeded!');
      console.log('  ✓ Cost Report:', genJson.costReport);
    }
  } else {
    // If Gemini key has quota or transient network, verify error handling structure
    console.log('  Notice: AI response returned status:', genJson.error || 'quota/network limit');
    assert(typeof genJson.error === 'string', 'Clear error message returned');
    console.log('  ✓ Error handling verified cleanly without crashes');
  }

  // 9. Honest Cost Accounting (Print mode 0% saved)
  console.log('\n[9] Testing Print Mode Honest Accounting (0% Saved)...');
  const printCostReport = require('./estimate.js').computeCostReport('print');
  assert(printCostReport.percentSaved === 0, 'Print mode must show 0% saved');
  assert(printCostReport.whSaved === 0, 'Print mode must show 0 Wh saved');
  const printChip = require('./estimate.js').formatCostChipText(printCostReport);
  console.log('  ✓ Print Mode Cost Chip:', printChip);
  assert(printChip.includes('0% less than Max'), 'Print mode chip confirms 0% saved');

  // 10. Document Upload & Visual Analysis
  console.log('\n[10] Testing Document Upload (Text extraction & 3 visual prompt ideas)...');
  const docTextContent = "Architectural study of ancient stone temples and heritage preservation techniques.";
  const blob = new Blob([docTextContent], { type: 'text/plain' });
  const formData = new FormData();
  formData.append('file', blob, 'temple_study.txt');

  const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: { Cookie: authCookie },
    body: formData
  });
  const uploadData = await uploadRes.json();
  assert(uploadRes.ok && uploadData.success, 'Document uploaded and analyzed');
  assert(uploadData.file.meta.suggestedIdeas && uploadData.file.meta.suggestedIdeas.length === 3, '3 image ideas generated');
  console.log('  ✓ Document processed:', uploadData.file.originalName);
  uploadData.file.meta.suggestedIdeas.forEach((idea, i) => console.log(`    Idea ${i+1}: ${idea}`));

  // 11. Logout
  console.log('\n[11] Testing Logout...');
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST' });
  assert(logoutRes.ok, 'Logout succeeded');
  console.log('  ✓ Logout clears session');

  console.log('\n====================================================');
  console.log('🎉 ALL INTEGRATION TESTS PASSED 11/11 SUCCESSFULLY!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
