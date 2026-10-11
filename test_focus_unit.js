const assert = require('assert');
const sharp = require('sharp');
const {
  detectFocusRegion,
  applyFocusClarity,
  inspectPromptHints
} = require('./focus');

async function runUnitTests() {
  console.log('=== TESTING FOCUS.JS MODULE ===\n');

  // Test 1: Saliency Detection on synthetic image
  console.log('[1] Testing Method A (Sharp Saliency Detection)...');
  const testCanvas = await sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 30, g: 30, b: 30 } }
  }).composite([{
    input: await sharp({
      create: { width: 120, height: 120, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).png().toBuffer(),
    top: 140,
    left: 140
  }]).png().toBuffer();

  const detected = await detectFocusRegion(testCanvas, { purpose: 'chat' });
  console.log('  Detected Focus Box:', detected.box);
  console.log('  Method:', detected.method);
  assert(detected.box.width >= 35 && detected.box.width <= 80, 'Width within bounds');
  assert(detected.box.height >= 35 && detected.box.height <= 80, 'Height within bounds');
  assert(detected.method === 'sharp_saliency', 'Method is sharp_saliency');
  console.log('  ✓ Method A passed!\n');

  // Test 2: Method B (Prompt Hints in English, Tamil, Thanglish)
  console.log('[2] Testing Method B (Prompt Hints in EN, TA, TH)...');
  const hintBlurEN = inspectPromptHints('cat with background blur');
  assert(hintBlurEN && hintBlurEN.type === 'tight_focus', 'EN background blur detected');

  const hintBlurTA = inspectPromptHints('பூனை பின்னணி மங்கலாக வேண்டும்');
  assert(hintBlurTA && hintBlurTA.type === 'tight_focus', 'TA background blur detected');

  const hintBlurTH = inspectPromptHints('oru cake photo background blur pannu');
  assert(hintBlurTH && hintBlurTH.type === 'tight_focus', 'TH background blur detected');

  const hintWide = inspectPromptHints('wide landscape photo of mountain');
  assert(hintWide && hintWide.type === 'wide_focus', 'Wide landscape detected');

  const detectedHint = await detectFocusRegion(testCanvas, { hintText: 'cat with background blur', purpose: 'chat' });
  console.log('  Prompt Hint Box (Tighter):', detectedHint.box, 'Method:', detectedHint.method);
  assert(detectedHint.method === 'prompt_hint', 'Method is prompt_hint');
  console.log('  ✓ Method B passed!\n');

  // Test 3: Method C (User Override Box)
  console.log('[3] Testing Method C (User Override Box)...');
  const userBox = { x: 10, y: 15, width: 45, height: 50, feather: 12 };
  const detectedUser = await detectFocusRegion(testCanvas, { userBox, purpose: 'chat' });
  console.log('  User Override Box:', detectedUser.box);
  assert.strictEqual(detectedUser.method, 'user_override');
  assert.strictEqual(detectedUser.box.x, 10);
  assert.strictEqual(detectedUser.box.y, 15);
  console.log('  ✓ Method C passed!\n');

  // Test 4: Focus Clarity Pipeline (Phone Chat: 640x360)
  console.log('[4] Testing applyFocusClarity for Phone Chat (640x360)...');
  const clarityChat = await applyFocusClarity(testCanvas, { purpose: 'chat' });
  console.log('  Focused Size Bytes:', clarityChat.focusedSizeBytes);
  console.log('  Uniform Size Bytes:', clarityChat.uniformSizeBytes);
  console.log('  Saved Bytes %:', clarityChat.percentSavedBytes + '%');
  console.log('  Clarity Allocation Summary:', clarityChat.clarityAllocation.summaryText);
  assert(clarityChat.success, 'Success is true');
  assert(clarityChat.focusedBuffer && clarityChat.focusedBuffer.length > 0);
  assert(clarityChat.uniformBuffer && clarityChat.uniformBuffer.length > 0);
  assert.strictEqual(clarityChat.modeLabel, 'Focus clarity (post-process)');
  assert(clarityChat.clarityAllocation.summaryText.includes('Clarity allocation: subject'));
  console.log('  ✓ Phone Chat clarity passed!\n');

  // Test 5: Print Purpose (Keep full clarity everywhere)
  console.log('[5] Testing applyFocusClarity for Print Purpose (1920x1080)...');
  const clarityPrint = await applyFocusClarity(testCanvas, { purpose: 'print' });
  console.log('  Print isPrint:', clarityPrint.isPrint);
  console.log('  Print Notice:', clarityPrint.printNotice);
  console.log('  Print Percent Saved:', clarityPrint.percentSavedBytes + '%');
  assert.strictEqual(clarityPrint.isPrint, true, 'isPrint is true');
  assert.strictEqual(clarityPrint.percentSavedBytes, 0, 'Print saves 0%');
  assert.strictEqual(clarityPrint.printNotice, 'Print needs full clarity, focus map off');
  assert.strictEqual(clarityPrint.focusBox.width, 100);
  console.log('  ✓ Print clarity passed!\n');

  console.log('🎉 ALL FOCUS.JS UNIT TESTS PASSED!');
}

runUnitTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
