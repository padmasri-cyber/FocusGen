const http = require('http');
const sharp = require('sharp');

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'GET'
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('=== FocusGen Focus Pipeline Integration Tests ===\n');

  // Test 1: Health check
  const health = await getJson('/api/health');
  console.log('1. Health Check:', health.data.status === 'online' ? 'PASS' : 'FAIL');

  // Create a synthetic test image with high edge detail in center, smooth periphery
  const testSvg = `
    <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="300" fill="#203a43"/>
      <circle cx="200" cy="150" r="50" fill="#ff7675" stroke="#ffffff" stroke-width="8"/>
      <line x1="160" y1="150" x2="240" y2="150" stroke="#2d3436" stroke-width="4"/>
      <line x1="200" y1="110" x2="200" y2="190" stroke="#2d3436" stroke-width="4"/>
      <circle cx="200" cy="150" r="15" fill="#feca57"/>
    </svg>
  `;
  const testBuf = await sharp(Buffer.from(testSvg)).jpeg().toBuffer();
  const testBase64 = `data:image/jpeg;base64,${testBuf.toString('base64')}`;

  // Test 2: Method A Focus Detection
  const detA = await postJson('/api/focus/detect', {
    imageBase64: testBase64,
    purpose: 'chat'
  });
  console.log('2. Method A Focus Detection:', detA.data.success ? 'PASS' : 'FAIL', {
    method: detA.data.method,
    box: detA.data.box
  });

  // Test 3: Method B with Prompt Hint (Tamil blur background)
  const detB = await postJson('/api/focus/detect', {
    imageBase64: testBase64,
    hintText: 'மங்கலான பின்னணி cat photo',
    purpose: 'chat'
  });
  console.log('3. Method B Prompt Hint Detection (Tamil):', detB.data.method === 'prompt_hint' ? 'PASS' : 'FAIL', {
    method: detB.data.method,
    box: detB.data.box
  });

  // Test 4: Method C User Override
  const detC = await postJson('/api/focus/detect', {
    imageBase64: testBase64,
    userBox: { x: 30, y: 25, width: 40, height: 45, feather: 12 },
    purpose: 'poster'
  });
  console.log('4. Method C User Override Detection:', detC.data.method === 'user_override' && detC.data.box.x === 30 ? 'PASS' : 'FAIL', {
    box: detC.data.box
  });

  // Test 5: Print Purpose Bypass (needs full clarity)
  const detPrint = await postJson('/api/focus/detect', {
    imageBase64: testBase64,
    purpose: 'print'
  });
  console.log('5. Print Purpose Detection Bypass:', detPrint.data.isPrint && detPrint.data.box.width === 100 ? 'PASS' : 'FAIL');

  // Test 6: Focus Clarity Pipeline Apply (Phone Chat)
  const applyChat = await postJson('/api/focus/apply', {
    imageBase64: testBase64,
    purpose: 'chat'
  });
  console.log('6. Focus Clarity Apply (Chat):', applyChat.data.success ? 'PASS' : 'FAIL', {
    focusedBytes: applyChat.data.focusedSizeBytes,
    uniformBytes: applyChat.data.uniformSizeBytes,
    percentSaved: `${applyChat.data.percentSavedBytes}%`,
    allocation: applyChat.data.clarityAllocation?.summaryText
  });

  // Test 7: Focus Clarity Pipeline Apply (Poster)
  const applyPoster = await postJson('/api/focus/apply', {
    imageBase64: testBase64,
    purpose: 'poster'
  });
  console.log('7. Focus Clarity Apply (Poster):', applyPoster.data.success ? 'PASS' : 'FAIL', {
    focusedBytes: applyPoster.data.focusedSizeBytes,
    uniformBytes: applyPoster.data.uniformSizeBytes,
    percentSaved: `${applyPoster.data.percentSavedBytes}%`
  });

  // Test 8: Print Clarity Apply (Full Clarity Everywhere)
  const applyPrint = await postJson('/api/focus/apply', {
    imageBase64: testBase64,
    purpose: 'print'
  });
  console.log('8. Print Clarity Apply:', (applyPrint.data.isPrint && applyPrint.data.percentSavedBytes === 0) ? 'PASS' : 'FAIL', {
    isPrint: applyPrint.data.isPrint,
    printNotice: applyPrint.data.printNotice,
    percentSaved: applyPrint.data.percentSavedBytes
  });

  // Test 9: /api/compress with Focus Clarity
  const compChat = await postJson('/api/compress', {
    imageBase64: testBase64,
    purpose: 'chat',
    focusClarity: true
  });
  console.log('9. /api/compress with Focus Clarity:', compChat.data.success && compChat.data.focusedUrl ? 'PASS' : 'FAIL', {
    focusedBytes: compChat.data.focusedBytes,
    uniformBytes: compChat.data.uniformBytes,
    summary: compChat.data.summary
  });

  // Test 10: Web Photo Search and Compression workflow
  const searchCat = await postJson('/api/search-licensed', {
    query: 'cat',
    purpose: 'chat'
  });
  console.log('10. Licensed Search for "cat":', (searchCat.data.success && searchCat.data.photos?.length > 0) ? 'PASS' : 'FAIL', {
    count: searchCat.data.count,
    firstTitle: searchCat.data.photos?.[0]?.title
  });

  if (searchCat.data.photos && searchCat.data.photos.length > 0) {
    const photo = searchCat.data.photos[0];
    const compPhoto = await postJson('/api/compress', {
      imageUrl: photo.thumbUrl || photo.fullUrl,
      purpose: 'poster',
      focusClarity: true
    });
    console.log('11. Compress Web Photo (cat, Poster) with Focus Clarity:', compPhoto.data.success ? 'PASS' : 'FAIL', {
      focusedBytes: compPhoto.data.focusedBytes,
      uniformBytes: compPhoto.data.uniformBytes,
      percentSavedBytes: `${compPhoto.data.percentSavedBytes}%`,
      focusBox: compPhoto.data.focusBox
    });

    // Test 12: Print purpose on real web photo -> full clarity everywhere
    const compPrint = await postJson('/api/compress', {
      imageUrl: photo.thumbUrl || photo.fullUrl,
      purpose: 'print',
      focusClarity: true
    });
    console.log('12. Web Photo (cat, Print Purpose):', (compPrint.data.isPrint && compPrint.data.percentSavedBytes === 0) ? 'PASS' : 'FAIL', {
      isPrint: compPrint.data.isPrint,
      printNotice: compPrint.data.printNotice,
      percentSavedBytes: compPrint.data.percentSavedBytes
    });

    // Test 13: User Override box on real web photo
    const compOverride = await postJson('/api/focus/apply', {
      imageUrl: photo.thumbUrl || photo.fullUrl,
      purpose: 'chat',
      userBox: { x: 10, y: 15, width: 50, height: 60, feather: 15 }
    });
    console.log('13. User Override Box on Web Photo (Phone chat):', compOverride.data.success ? 'PASS' : 'FAIL', {
      method: compOverride.data.method,
      savedPercent: `${compOverride.data.percentSavedBytes}%`,
      box: compOverride.data.focusBox
    });
  }

  // Test 14: Search "cake"
  const searchCake = await postJson('/api/search-licensed', {
    query: 'cake',
    purpose: 'chat'
  });
  console.log('14. Licensed Search for "cake":', (searchCake.data.success && searchCake.data.photos?.length > 0) ? 'PASS' : 'FAIL', {
    count: searchCake.data.count,
    firstTitle: searchCake.data.photos?.[0]?.title
  });

  if (searchCake.data.photos && searchCake.data.photos.length > 0) {
    const cakePhoto = searchCake.data.photos[0];
    const compCake = await postJson('/api/compress', {
      imageUrl: cakePhoto.thumbUrl || cakePhoto.fullUrl,
      purpose: 'chat',
      focusClarity: true
    });
    console.log('15. Compress Web Photo (cake, Phone chat):', compCake.data.success ? 'PASS' : 'FAIL', {
      focusedBytes: compCake.data.focusedBytes,
      uniformBytes: compCake.data.uniformBytes,
      percentSavedBytes: `${compCake.data.percentSavedBytes}%`,
      focusBox: compCake.data.focusBox
    });
  }

  console.log('\n=== All Tests Completed ===');
}

runTests().catch(console.error);
