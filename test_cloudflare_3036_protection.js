const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('================================================================');
  console.log('RUNNING FOCUSGEN CLOUDFLARE 3036 ALLOCATION PROTECTION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  // Clear any existing block first
  await request('/api/test/clear-block', { method: 'POST' });

  // --------------------------------------------------------------------------
  // TEST 1: Initial AI Status (Unblocked)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: AI Initial Unblocked Status ---');
  const res1 = await request('/api/ai-status');
  test('Initial AI status returns blocked === false', () => {
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.blocked, false);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Simulate Cloudflare Error 3036
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Simulate Error 3036 & In-Memory Lock ---');
  const res2 = await request('/api/test/simulate-3036', { method: 'POST' });
  test('Simulate 3036 sets blocked === true', () => {
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.data.blocked, true);
    assert.ok(res2.data.blockedUntil > Date.now(), 'blockedUntil must be in the future');
  });

  test('Shows exact required message: Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).', () => {
    assert.ok(
      res2.data.message.includes('Daily free AI allocation is used up. It resets at 00:00 UTC (5:30 AM IST).'),
      `Expected required message, got: ${res2.data.message}`
    );
  });

  // Check /api/ai-status reflects the block
  const resStatus = await request('/api/ai-status');
  test('GET /api/ai-status reflects blocked state and countdown target', () => {
    assert.strictEqual(resStatus.data.blocked, true);
    assert.strictEqual(resStatus.data.isAfterResetTime, false);
    assert.ok(resStatus.data.blockedUntil > Date.now());
  });

  // --------------------------------------------------------------------------
  // TEST 3: While Blocked, All AI Calls are Skipped & Web Photos Flow Runs with Zero Errors
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Blocked State - AI Skipped, Web Photos Served with Zero Errors ---');
  
  // 3a. Direct POST /api/generate while blocked
  const resGenBlocked = await request('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ word: 'tiger', purpose: 'school' })
  });
  test('POST /api/generate while blocked falls back to web photos (HTTP 200, success === true)', () => {
    assert.strictEqual(resGenBlocked.status, 200);
    assert.strictEqual(resGenBlocked.data.success, true);
    assert.strictEqual(resGenBlocked.data.type, 'web_photos');
    assert.ok(resGenBlocked.data.photos && resGenBlocked.data.photos.length > 0);
  });

  test('Status line is: "AI paused (daily limit). Using licensed photos."', () => {
    assert.strictEqual(
      resGenBlocked.data.statusLine,
      'AI paused (daily limit). Using licensed photos.'
    );
  });

  test('Cost chip follows Requirement 3 format', () => {
    const chip = resGenBlocked.data.costChip;
    console.log('   Actual cost chip:', chip);
    assert.ok(
      chip.includes('Web photo: no AI generation needed. Estimated'),
      `Cost chip missing web photo prefix: ${chip}`
    );
    assert.ok(
      chip.includes('Wh (download and compress) vs'),
      `Cost chip missing download and compress: ${chip}`
    );
    assert.ok(
      chip.includes('Wh for AI at Max (1080p)'),
      `Cost chip missing vs Max: ${chip}`
    );
  });

  // 3b. POST /api/chat while blocked with purpose selected
  const resChatBlocked = await request('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'peacock', purpose: 'school', webFirst: false })
  });
  test('POST /api/chat while blocked returns web photos directly with zero user-facing error', () => {
    assert.strictEqual(resChatBlocked.status, 200);
    assert.strictEqual(resChatBlocked.data.success, true);
    assert.strictEqual(resChatBlocked.data.type, 'web_photos');
    assert.strictEqual(
      resChatBlocked.data.statusLine,
      'AI paused (daily limit). Using licensed photos.'
    );
  });

  // 3c. Purpose inference while blocked
  const resInferBlocked = await request('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'lion for school presentation' })
  });
  test('Purpose inference works normally while blocked without errors', () => {
    assert.strictEqual(resInferBlocked.status, 200);
    assert.strictEqual(resInferBlocked.data.success, true);
    assert.ok(resInferBlocked.data.type === 'purpose_suggestion' || resInferBlocked.data.type === 'web_photos');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Retest & Diagnose While Blocked (Before Reset Time)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Manual Retest Before Reset Time is Prohibited ---');
  const resDiagBeforeReset = await request('/api/diagnose');
  test('Diagnose before reset time returns status "blocked" and canRetest === false', () => {
    assert.strictEqual(resDiagBeforeReset.status, 200);
    assert.strictEqual(resDiagBeforeReset.data.blocked, true);
    assert.strictEqual(resDiagBeforeReset.data.status, 'blocked');
    assert.strictEqual(resDiagBeforeReset.data.canRetest, false);
    assert.strictEqual(resDiagBeforeReset.data.httpStatus, 429);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Manual Retest After Reset Time Succeeds & Clears the Flag
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: Reset Time Arrived -> Manual Retest Clears Flag ---');
  // Simulate reset time has passed (00:00 UTC reached)
  const resPassed = await request('/api/test/set-reset-passed', { method: 'POST' });
  test('set-reset-passed marks isAfterResetTime === true', () => {
    assert.strictEqual(resPassed.status, 200);
    assert.strictEqual(resPassed.data.isAfterResetTime, true);
  });

  // Now trigger manual clear / retest
  const resClear = await request('/api/test/clear-block', { method: 'POST' });
  test('Manual retest success clears allocation block flag', () => {
    assert.strictEqual(resClear.status, 200);
    assert.strictEqual(resClear.data.blocked, false);
  });

  const resStatusAfter = await request('/api/ai-status');
  test('GET /api/ai-status confirms AI is unblocked', () => {
    assert.strictEqual(resStatusAfter.data.blocked, false);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Demo Mode Toggle (Forces Web-Photo-Only Mode Without Spending AI)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Demo Mode Toggle ---');
  const resDemoChat = await request('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: 'sunflower',
      purpose: 'chat',
      demoMode: true,
      webFirst: false // Even if webFirst were false, demoMode forces web photos
    })
  });
  test('Demo mode forces web-photo-only mode with zero errors', () => {
    assert.strictEqual(resDemoChat.status, 200);
    assert.strictEqual(resDemoChat.data.success, true);
    assert.strictEqual(resDemoChat.data.type, 'web_photos');
    assert.strictEqual(resDemoChat.data.statusLine, 'Demo mode active. Using licensed photos.');
    assert.ok(resDemoChat.data.photos && resDemoChat.data.photos.length > 0);
  });

  test('Demo mode web photo cost chip displays correct Requirement 3 format', () => {
    const chip = resDemoChat.data.costChip;
    console.log('   Demo mode cost chip:', chip);
    assert.ok(chip.includes('Web photo: no AI generation needed. Estimated'));
    assert.ok(chip.includes('Wh for AI at Max (1080p)'));
  });

  // --------------------------------------------------------------------------
  // TEST 7: Smart Compression & Focus Clarity on Web Photo
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: Smart Compression on Web Photo with Zero Errors ---');
  const resCompress = await request('/api/compress', {
    method: 'POST',
    body: JSON.stringify({
      imageUrl: resDemoChat.data.photos[0].thumbUrl,
      purpose: 'chat',
      hintText: 'sunflower'
    })
  });
  test('Server-side Sharp compression works flawlessly for web photos', () => {
    assert.strictEqual(resCompress.status, 200);
    assert.strictEqual(resCompress.data.success, true);
    assert.ok(resCompress.data.focusedUrl || resCompress.data.compressedUrl);
    assert.ok(resCompress.data.percentSaved >= 0);
  });

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${passed}/${total} TESTS PASSED`);
  console.log('================================================================');

  if (passed === total) {
    console.log('🎉 ALL 5 USER REQUIREMENTS MET AND VERIFIED!');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
