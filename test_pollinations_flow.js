const http = require('http');

async function sendChat(message, demoMode = false) {
  const start = Date.now();
  const payload = JSON.stringify({ message, demoMode });
  
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  });
  
  const elapsedMs = Date.now() - start;
  const data = await res.json();
  return { elapsedMs, data };
}

async function pollJob(jobId) {
  const start = Date.now();
  let done = false;
  let jobData = null;
  
  while (!done) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch(`http://localhost:3000/api/ai-job/${jobId}`);
    jobData = await res.json();
    console.log(`   [Poll ${((Date.now() - start)/1000).toFixed(1)}s] Status: ${jobData.status} | Queue Pos: ${jobData.position}`);
    if (jobData.status === 'completed' || jobData.status === 'error' || jobData.status === 'timeout') {
      done = true;
    }
  }
  const totalPollMs = Date.now() - start;
  return { totalPollMs, jobData };
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TESTING FOCUSGEN POLLINATIONS SPEED & QUEUE FLOW');
  console.log('====================================================\n');

  // TEST 1: "cake for my whatsapp status" (Pre-cached Demo request)
  console.log('Test 1: Pre-cached Demo request ("cake for my whatsapp status")...');
  const t1 = await sendChat('cake for my whatsapp status');
  console.log(`✓ Response time: ${t1.elapsedMs}ms`);
  console.log(`  fromCache: ${t1.data.fromCache}`);
  console.log(`  Source Tag: ${t1.data.sourceTag}`);
  console.log(`  Cost chip: "${t1.data.costChip}"`);
  console.log(`  Has cached image: ${!!t1.data.cachedImage?.imageBase64}`);

  // TEST 2: "cat for my whatsapp status" (Fresh request - Web photos instant, AI queued)
  console.log('\nTest 2: Fresh request ("cat for my whatsapp status")...');
  const t2 = await sendChat('cat for my whatsapp status');
  console.log(`✓ Instant web photos response time: ${t2.elapsedMs}ms`);
  console.log(`  Licensed photos returned: ${t2.data.photos?.length || 0}`);
  console.log(`  Purpose inferred: ${t2.data.purpose} (${t2.data.inferred?.tier})`);
  console.log(`  AI Job queued: ID=${t2.data.aiJob?.id}, Initial Position=${t2.data.aiJob?.position}`);
  
  if (t2.data.aiJob?.id) {
    console.log('  Waiting for background AI generation to complete...');
    const pollResult = await pollJob(t2.data.aiJob.id);
    console.log(`✓ AI generation finished in ${pollResult.totalPollMs}ms!`);
    console.log(`  Final status: ${pollResult.jobData.status}`);
    console.log(`  AI Source Tag: ${pollResult.jobData.result?.sourceTag}`);
    console.log(`  AI Cost Chip: "${pollResult.jobData.result?.costChip}"`);
    console.log(`  AI Image size: ${pollResult.jobData.result?.sizeFormatted}`);
    console.log(`  AI Image base64 length: ${pollResult.jobData.result?.imageBase64?.length}`);
  }

  // TEST 3: "cat for my whatsapp status" repeated (Should now hit Cache instantly!)
  console.log('\nTest 3: Repeating "cat for my whatsapp status" (Should hit cache instantly)...');
  const t3 = await sendChat('cat for my whatsapp status');
  console.log(`✓ Response time: ${t3.elapsedMs}ms`);
  console.log(`  fromCache: ${t3.data.fromCache}`);
  console.log(`  Source Tag: ${t3.data.sourceTag}`);
  console.log(`  Has cached image: ${!!t3.data.cachedImage?.imageBase64}`);

  // TEST 4: Demo mode with uncached subject ("polar bear in snow")
  console.log('\nTest 4: Demo mode query ("polar bear in snow", demoMode=true)...');
  const t4 = await sendChat('polar bear in snow', true);
  console.log(`✓ Response time: ${t4.elapsedMs}ms`);
  console.log(`  aiJob created: ${!!t4.data.aiJob}`);
  console.log(`  Licensed photos returned: ${t4.data.photos?.length || 0}`);
  console.log(`  Status line: "${t4.data.statusLine}"`);
  console.log(`  demoMode flag: ${t4.data.demoMode}`);

  console.log('\n====================================================');
  console.log('🎉 ALL API TESTS COMPLETED SUCCESSFULLY!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
