const { inferPurpose } = require('./purpose');

async function runTests() {
  const tests = [
    { name: "whatsapp status", req: "cake for my whatsapp status", ctx: {} },
    { name: "school project slide", req: "tiger picture for school project slide", ctx: {} },
    { name: "temple poster college fest", req: "temple poster for college fest", ctx: {} },
    { name: "print big banner", req: "cake photo for printing a big banner", ctx: {} },
    { name: "Thanglish status", req: "enna WhatsApp status-ku oru cake picture venum", ctx: {} },
    { name: "Tamil script slide", req: "ஸ்லைடு புலி படம்", ctx: {} },
    { name: "cake alone", req: "cake", ctx: {} },
    { name: "student mode tiger", req: "tiger", ctx: { mode: "student" } }
  ];

  console.log("=== RUNNING INFERENCE TESTS ===\n");
  for (const t of tests) {
    const res = await inferPurpose(t.req, t.ctx);
    console.log(`TEST: [${t.name}]`);
    console.log(`Request: "${t.req}" | Context:`, JSON.stringify(t.ctx));
    console.log(`Result: purpose=${res.purpose}, tier=${res.tier}, size=${res.size}, confidence=${res.confidence}, needsClarification=${res.needsClarification}`);
    console.log(`Reason: "${res.reason}"`);
    console.log(`Signals:`, res.signals);
    console.log("--------------------------------------------------\n");
  }

  console.log("=== TESTING OVERRIDE LEARNING IN SQLITE ===");
  const db = require('./db');
  let testUser = db.findUserByEmail('tester@focusgen.local');
  if (!testUser) {
    testUser = db.createUser('tester@focusgen.local', 'testerhash');
  }
  const testUserId = testUser.id;
  db.recordOverride(testUserId, 'banner', 'school', 'poster');
  db.recordOverride(testUserId, 'banner', 'school', 'poster');
  
  const learnedRes = await inferPurpose('banner design', { userId: testUserId, isGuest: false, db });
  console.log('Learned Result for "banner design":', {
    purpose: learnedRes.purpose,
    tier: learnedRes.tier,
    reason: learnedRes.reason,
    signals: learnedRes.signals
  });
  console.log("--------------------------------------------------\n");
}

runTests().catch(console.error);
