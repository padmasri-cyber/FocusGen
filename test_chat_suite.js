// test_chat_suite.js - FocusGen Chat Box & Single sendMessage Flow Test Suite
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const assert = require('assert');

async function testChatWorkflow() {
  console.log('========================================================');
  console.log('🧪 TESTING FOCUSGEN UNIFIED CHAT WORKFLOW (/api/chat)');
  console.log('========================================================');

  const BASE_URL = 'http://localhost:3000';

  // 1. Health endpoint test
  console.log('\n[1] Testing GET /api/health endpoint...');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert(healthRes.ok, 'Health route should return HTTP 200');
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, 'online', 'Status should be online');
  assert(healthData.uptime !== undefined, 'Uptime reported');
  console.log('  ✓ /api/health online! Uptime:', healthData.uptime, 's');

  // 2. Chat sending as Guest (Cookie automatic creation)
  console.log('\n[2] Testing POST /api/chat as Guest (Single-word "cake")...');
  const guestChatRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'cake', purpose: 'chat', webFirst: true })
  });
  assert(guestChatRes.ok, 'Chat request should return HTTP 200');
  const guestCookie = guestChatRes.headers.get('set-cookie');
  assert(guestCookie && guestCookie.includes('focusgen_token'), 'HttpOnly guest session cookie set');
  const guestData = await guestChatRes.json();
  assert(guestData.success, 'Chat response success should be true');
  assert.strictEqual(guestData.type, 'web_photos', 'Type should be web_photos');
  assert(Array.isArray(guestData.photos) && guestData.photos.length > 0, 'Top licensed photos returned');
  assert(guestData.costChip, 'Cost chip must be returned');
  console.log(`  ✓ Received ${guestData.photos.length} photos for "cake"`);
  console.log('  ✓ Cost chip:', guestData.costChip);

  // 3. Conversational greeting check
  console.log('\n[3] Testing POST /api/chat for Greeting ("hello FocusGen")...');
  const greetingRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello FocusGen' })
  });
  assert(greetingRes.ok, 'Greeting should return HTTP 200');
  const greetingData = await greetingRes.json();
  assert(greetingData.success && greetingData.type === 'greeting', 'Greeting response returned');
  assert(greetingData.reply && greetingData.suggestions.length > 0, 'Suggestions returned');
  console.log('  ✓ Greeting reply:', greetingData.reply.slice(0, 50) + '...');
  console.log('  ✓ Suggestions:', greetingData.suggestions);

  // 4. Authenticated chat session
  console.log('\n[4] Testing POST /api/chat as Authenticated User...');
  const userEmail = `chat_test_${Date.now()}@example.com`;
  const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: userEmail, password: 'password123' })
  });
  const authCookie = signupRes.headers.get('set-cookie').split(';')[0];

  const userChatRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
    body: JSON.stringify({ message: 'bengal tiger', purpose: 'poster', webFirst: true })
  });
  assert(userChatRes.ok, 'Authenticated chat request should return HTTP 200');
  const userData = await userChatRes.json();
  assert(userData.success, 'Authenticated chat success should be true');
  assert.strictEqual(userData.type, 'web_photos', 'Web photos returned for tiger');
  console.log(`  ✓ Authenticated user received ${userData.photos.length} photos for tiger`);

  // 5. Input validation (Empty message should return 400)
  console.log('\n[5] Testing Empty Input Validation...');
  const emptyRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '   ' })
  });
  assert.strictEqual(emptyRes.status, 400, 'Empty message should return HTTP 400');
  console.log('  ✓ Empty input rejected with HTTP 400 cleanly');

  console.log('\n========================================================');
  console.log('🎉 ALL CHAT WORKFLOW TESTS PASSED 5/5 SUCCESSFULLY!');
  console.log('========================================================\n');
}

testChatWorkflow().catch(err => {
  console.error('❌ Chat workflow test failed:', err);
  process.exit(1);
});
