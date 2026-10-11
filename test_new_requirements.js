// test_new_requirements.js
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const assert = require('assert');

async function testNewRequirements() {
  console.log('====================================================');
  console.log('🧪 TESTING NEW REQUIREMENTS & REGRESSIONS');
  console.log('====================================================');
  const BASE_URL = 'http://localhost:3000';

  // 1. Purpose First: Send single word "cake" without purpose
  console.log('\n[1] Testing Purpose-First Flow without purpose parameter...');
  const purposeRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'cake' })
  });
  assert(purposeRes.ok, 'Request should succeed');
  const purposeData = await purposeRes.json();
  assert(purposeData.success, 'Success is true');
  assert.strictEqual(purposeData.type, 'ask_purpose', 'Type should be ask_purpose');
  assert.strictEqual(purposeData.word, 'cake', 'Word should be cake');
  console.log('  ✓ Purpose First successfully triggered! Server returned:', purposeData);

  // 2. Pick purpose "chat" for "cake"
  console.log('\n[2] Testing Picking Purpose "chat" for "cake"...');
  const chatRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'cake', purpose: 'chat' })
  });
  assert(chatRes.ok, 'Request should succeed');
  const chatData = await chatRes.json();
  assert(chatData.success, 'Success should be true');
  assert.strictEqual(chatData.type, 'web_photos', 'Type should be web_photos');
  assert(chatData.photos && chatData.photos.length > 0, 'Photos returned');
  assert(chatData.costChip, 'Cost chip returned');
  assert.strictEqual(chatData.statusTag, 'Web photo', 'statusTag should be Web photo');
  console.log(`  ✓ Received ${chatData.photos.length} photos with tag "${chatData.statusTag}" and chip "${chatData.costChip}"`);

  // 3. Quota Guard 429 fallback simulation on /api/generate
  console.log('\n[3] Testing Quota Guard on /api/generate...');
  // Force a call to /api/generate with webFirst disabled or direct generate
  const genRes = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word: 'mango', purpose: 'chat', tier: 'Sketch' })
  });
  const genData = await genRes.json();
  console.log('  Generate response status:', genRes.status);
  console.log('  Generate response type/success:', genData.success, genData.type, genData.fallbackFromAi ? '(Quota fallback)' : '');
  if (genData.fallbackFromAi) {
    assert(genData.photos && genData.photos.length > 0, 'Licensed photos returned automatically in same reply');
    assert(genData.aiMessage.includes('quota is full'), 'Friendly quota message returned');
    assert.strictEqual(genData.statusTag, 'Web photo', 'statusTag is Web photo');
    console.log('  ✓ Quota Guard automatically provided licensed web photos in same reply!');
    console.log('  ✓ Friendly notice:', genData.aiMessage);
  } else if (genData.imageBase64) {
    assert(genData.statusTag === 'Cloudflare FLUX' || genData.statusTag === 'AI generated', 'statusTag is Cloudflare FLUX or AI generated');
    console.log('  ✓ Model returned image with statusTag:', genData.statusTag);
  }

  // 4. Download attributed test
  console.log('\n[4] Testing /api/download-attributed...');
  const firstPhoto = chatData.photos[0];
  const dlUrl = `${BASE_URL}/api/download-attributed?url=${encodeURIComponent(firstPhoto.thumbUrl)}&title=${encodeURIComponent(firstPhoto.title)}&creator=${encodeURIComponent(firstPhoto.creator || firstPhoto.photographer)}&license=${encodeURIComponent(firstPhoto.license)}&source=Wikimedia`;
  const dlRes = await fetch(dlUrl);
  assert(dlRes.ok, 'Attributed download responds 200');
  const dlType = dlRes.headers.get('content-type');
  assert(dlType.includes('image/jpeg'), 'Content-type is image/jpeg');
  console.log('  ✓ Attributed download works cleanly! Content-type:', dlType);

  // 5. Smart compress test
  console.log('\n[5] Testing /api/compress...');
  const compRes = await fetch(`${BASE_URL}/api/compress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: firstPhoto.thumbUrl, purpose: 'chat' })
  });
  const compData = await compRes.json();
  assert(compData.success, 'Compression succeeded');
  console.log('  ✓ Sharp compression summary:', compData.summary);

  console.log('\n====================================================');
  console.log('🎉 ALL NEW REQUIREMENTS TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
}

testNewRequirements().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
