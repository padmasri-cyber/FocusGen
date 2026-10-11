// test_constraint2_verification.js
// Dedicated test suite verifying all Constraint 2 requirements & reporting PASS/FAIL

const http = require('http');
const { inferPurpose } = require('./purpose');
const db = require('./db');

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runConstraint2Tests() {
  console.log("================================================================================");
  console.log("🧪 FOCUSGEN CONSTRAINT 2 VERIFICATION TEST SUITE");
  console.log("================================================================================\n");

  const results = [];

  // TEST 1: "cake for my whatsapp status" -> Phone chat, Sketch, reason mentions whatsapp/status
  {
    const req = "cake for my whatsapp status";
    const res = await inferPurpose(req);
    const pass = res.purpose === 'Phone chat' && res.tier === 'Sketch' && /whatsapp|status/i.test(res.reason);
    results.push({
      test: 'cake for my whatsapp status',
      expected: 'Phone chat, Sketch, reason mentions whatsapp/status',
      actual: `${res.purpose}, ${res.tier}`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      pass
    });
  }

  // TEST 2: "tiger picture for school project slide" -> School project, Standard
  {
    const req = "tiger picture for school project slide";
    const res = await inferPurpose(req);
    const pass = res.purpose === 'School project' && res.tier === 'Standard';
    results.push({
      test: 'tiger picture for school project slide',
      expected: 'School project, Standard',
      actual: `${res.purpose}, ${res.tier}`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      pass
    });
  }

  // TEST 3: "temple poster for college fest" -> Poster, Detailed
  {
    const req = "temple poster for college fest";
    const res = await inferPurpose(req);
    const pass = res.purpose === 'Poster' && res.tier === 'Detailed';
    results.push({
      test: 'temple poster for college fest',
      expected: 'Poster, Detailed',
      actual: `${res.purpose}, ${res.tier}`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      pass
    });
  }

  // TEST 4: "cake photo for printing a big banner" -> Print, Max, shows 0% saved
  {
    const req = "cake photo for printing a big banner";
    const res = await inferPurpose(req);
    const pass = res.purpose === 'Print' && res.tier === 'Max' && (res.percentSaved === 0 || /0% saved/i.test(res.reason));
    results.push({
      test: 'cake photo for printing a big banner',
      expected: 'Print, Max, shows 0% saved',
      actual: `${res.purpose}, ${res.tier}, percentSaved=${res.percentSaved}%`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      pass
    });
  }

  // TEST 5: "enna WhatsApp status-ku oru cake picture venum" (Thanglish) -> Phone chat, reason in Thanglish
  {
    const req = "enna WhatsApp status-ku oru cake picture venum";
    const res = await inferPurpose(req);
    const pass = res.purpose === 'Phone chat' && res.language === 'th' && /sonneenga|podhum/i.test(res.reason);
    results.push({
      test: 'enna WhatsApp status-ku oru cake picture venum (Thanglish)',
      expected: 'Phone chat, reason in Thanglish',
      actual: `${res.purpose}, ${res.tier}, lang=${res.language}`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      pass
    });
  }

  // TEST 6: Tamil-script request with "ஸ்லைடு" -> School project
  {
    const req = "ஸ்லைடு புலி படம்";
    const res = await inferPurpose(req);
    const pass = res.purpose === 'School project' && res.language === 'ta';
    results.push({
      test: 'Tamil-script request with "ஸ்லைடு"',
      expected: 'School project, language ta',
      actual: `${res.purpose}, ${res.tier}, lang=${res.language}`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      pass
    });
  }

  // TEST 7: "cake" alone -> low confidence, asks one question
  {
    const req = "cake";
    const res = await inferPurpose(req);
    const pass = res.confidence < 0.6 && res.needsClarification === true && res.question.length > 0;
    results.push({
      test: 'cake alone',
      expected: 'confidence < 0.6, needsClarification=true, asks one question',
      actual: `confidence=${res.confidence}, needsClarification=${res.needsClarification}`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      question: res.question,
      pass
    });
  }

  // TEST 8: Override from Standard to Max: cost chip and ledger show extra Wh and mark Overridden
  {
    const httpRes = await postJson('/api/generate', {
      word: 'tiger',
      purpose: 'print',
      tier: 'Max',
      isOverridden: true,
      fromTier: 'Standard',
      toTier: 'Max'
    });
    const costChip = httpRes.body.costChip || '';
    const pass = httpRes.status === 200 && httpRes.body.isOverridden === true && costChip.includes('Overridden (Standard -> Max: +21.8 Wh)');
    results.push({
      test: 'Override from Standard to Max (/api/generate)',
      expected: 'cost chip and ledger mark as Overridden with extra Wh (+21.8 Wh)',
      actual: `costChip="${costChip}"`,
      confidence: 1.0,
      signals: ['override: Standard -> Max'],
      reason: costChip,
      pass
    });
  }

  // TEST 9: Student mode with "tiger" leans to School project
  {
    const req = "tiger";
    const res = await inferPurpose(req, { mode: 'student' });
    const hasStudentSignal = res.signals.some(s => s.includes("mode: 'student' leans to School project"));
    const pass = res.purpose === 'School project' && hasStudentSignal;
    results.push({
      test: 'Student mode with "tiger" leans to School project',
      expected: 'School project with student mode signal',
      actual: `${res.purpose}, hasStudentSignal=${hasStudentSignal}`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      pass
    });
  }

  // TEST 10: Repeated Overrides Learning (SQLite)
  {
    let user = db.findUserByEmail('learner@focusgen.local');
    if (!user) user = db.createUser('learner@focusgen.local', 'hash123');
    db.recordOverride(user.id, 'banner', 'school', 'poster');
    db.recordOverride(user.id, 'banner', 'school', 'poster');
    const res = await inferPurpose('banner', { userId: user.id, isGuest: false, db });
    const pass = res.purpose === 'Poster' && res.userOverrideApplied === true && res.reason.includes("Last time you chose Poster for 'banner'");
    results.push({
      test: 'Learns from overrides in SQLite (2x repetition)',
      expected: 'Poster, userOverrideApplied=true, reason cites previous override',
      actual: `${res.purpose}, userOverrideApplied=${res.userOverrideApplied}`,
      confidence: res.confidence,
      signals: res.signals,
      reason: res.reason,
      pass
    });
  }

  // Print Detailed Report
  let allPassed = true;
  for (const r of results) {
    const statusStr = r.pass ? '✅ PASS' : '❌ FAIL';
    if (!r.pass) allPassed = false;
    console.log(`[${statusStr}] TEST: ${r.test}`);
    console.log(`  Expected  : ${r.expected}`);
    console.log(`  Actual    : ${r.actual}`);
    console.log(`  Confidence: ${r.confidence}`);
    console.log(`  Signals   : ${JSON.stringify(r.signals)}`);
    console.log(`  Reason    : "${r.reason}"`);
    if (r.question) console.log(`  Question  : "${r.question}"`);
    console.log('');
  }

  console.log("================================================================================");
  if (allPassed) {
    console.log("🎉 ALL CONSTRAINT 2 TESTS PASSED PERFECTLY (10/10)!");
  } else {
    console.log("⚠️ SOME TESTS FAILED. Please review output above.");
  }
  console.log("================================================================================\n");
}

runConstraint2Tests().catch(console.error);
