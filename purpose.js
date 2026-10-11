// purpose.js - FocusGen Deterministic Purpose Inference Engine
const fs = require('fs');
const path = require('path');

let rulesCache = null;
let lastRulesLoad = 0;

function loadRules() {
  const rulesPath = path.join(__dirname, 'purpose-rules.json');
  try {
    const stat = fs.statSync(rulesPath);
    if (!rulesCache || stat.mtimeMs > lastRulesLoad) {
      const raw = fs.readFileSync(rulesPath, 'utf8');
      rulesCache = JSON.parse(raw);
      lastRulesLoad = stat.mtimeMs;
    }
    return rulesCache;
  } catch (err) {
    if (rulesCache) return rulesCache;
    throw err;
  }
}

/**
 * Detect language of request:
 * 'ta' -> Tamil script
 * 'th' -> Thanglish keywords/affixes
 * 'en' -> English default
 */
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'en';
  // Check for Tamil Unicode range \u0B80-\u0BFF
  if (/[\u0B80-\u0BFF]/.test(text)) {
    return 'ta';
  }
  const thanglishKeywords = [
    'venum', 'pannanum', 'podhum', 'enna', 'oru', 'aagudhu', 'nallaa',
    'idhu', 'edhuku', 'marubadiyum', 'paravala', 'solla', 'thanglish',
    '-ku', 'ku ', 'illai', 'illa', 'iruku', 'irukku', 'pannunga', 'vaanga'
  ];
  const lower = text.toLowerCase();
  for (const kw of thanglishKeywords) {
    if (lower.includes(kw)) {
      return 'th';
    }
  }
  return 'en';
}

/**
 * Format Wh estimate and percent savings against Max (1080p)
 */
function getTierEnergy(tier) {
  switch (tier) {
    case 'Sketch':
      return { wh: 0.23, savePct: 96.0 };
    case 'Standard':
      return { wh: 2.50, savePct: 91.7 };
    case 'Detailed':
      return { wh: 5.80, savePct: 75.0 };
    case 'Max':
      return { wh: 24.30, savePct: 0.0 };
    default:
      return { wh: 2.50, savePct: 91.7 };
  }
}

/**
 * Infer Purpose, Tier, Size, Confidence, Signals & Reason
 * @param {string} request - User prompt or message
 * @param {object} context - { mode, uploadedDoc, language, pastOverrides, userId, db }
 */
async function inferPurpose(request, context = {}) {
  const rules = loadRules();
  const rawText = (request || '').trim();
  const lowerText = rawText.toLowerCase();
  const lang = context.language || detectLanguage(rawText);

  const scores = {
    chat: 0,
    school: 0,
    poster: 0,
    print: 0
  };

  const signals = [];
  let userOverrideSignal = null;

  // 1. Check user's past overrides in SQLite (if DB and userId available)
  if (context.db && context.userId && !context.isGuest) {
    try {
      const words = lowerText.replace(/[^\w\s\u0B80-\u0BFF]/g, ' ').split(/\s+/).filter(w => w.length > 2);
      for (const w of words) {
        const repeated = context.db.findRepeatedOverride(context.userId, w);
        if (repeated && repeated.count >= 2) {
          scores[repeated.chosen_purpose] += 1.5;
          userOverrideSignal = {
            keyword: w,
            chosenPurpose: repeated.chosen_purpose,
            count: repeated.count
          };
          signals.push(`user_history: '${w}' previously overridden to ${repeated.chosen_purpose} (${repeated.count}x)`);
          break;
        }
      }
    } catch (_) {}
  }

  // 2. Keyword matching from purpose-rules.json
  let hasDirectPrintKeyword = false;

  for (const [purposeKey, kwList] of Object.entries(rules.keywords)) {
    for (const item of kwList) {
      const kw = item.word.toLowerCase();
      // Check whole word or substring match
      const isMatch = lowerText.includes(kw);
      if (isMatch) {
        scores[purposeKey] += item.weight;
        signals.push(`keyword: '${item.word}' -> ${rules.purposes[purposeKey].title} (+${item.weight})`);
        if (purposeKey === 'print') {
          hasDirectPrintKeyword = true;
        }
      }
    }
  }

  // 3. Active Mode Bias
  const activeMode = (context.mode || 'normal').toLowerCase();
  if (rules.modeBiases && rules.modeBiases[activeMode]) {
    for (const [pKey, bias] of Object.entries(rules.modeBiases[activeMode])) {
      scores[pKey] += bias;
      signals.push(`mode: '${activeMode}' leans to ${rules.purposes[pKey].title} (+${bias})`);
    }
  }

  // 4. Uploaded File Context
  if (context.uploadedDoc && typeof context.uploadedDoc === 'string') {
    const docLower = context.uploadedDoc.toLowerCase();
    if (docLower.includes('print')) {
      scores.print += 0.35;
      signals.push("file_context: document mentions 'print' (+0.35)");
      hasDirectPrintKeyword = true;
    } else if (docLower.includes('slide') || docLower.includes('presentation') || docLower.length > 80) {
      scores.school += 0.35;
      signals.push("file_context: document slide text suggests School project (+0.35)");
    }
  }

  // 5. Print Rule Guard: Never infer print from weak signals. Require clear print signal.
  if (scores.print > 0 && !hasDirectPrintKeyword) {
    scores.print = 0;
  }

  // 6. Rank candidates
  const candidates = Object.keys(scores).map(pKey => ({
    purpose: pKey,
    score: scores[pKey],
    def: rules.purposes[pKey]
  }));

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-breaking: when unsure between two tiers, propose the lower tier!
    const tierA = rules.tierOrder.indexOf(a.def.tier);
    const tierB = rules.tierOrder.indexOf(b.def.tier);
    return tierA - tierB;
  });

  const best = candidates[0];
  const second = candidates[1] && candidates[1].score > 0 ? candidates[1] : null;

  // 7. Confidence Evaluation
  // If no purpose signals were found at all (e.g. single word "cake")
  const totalKeywordsMatched = signals.filter(s => s.startsWith('keyword:')).length;
  let confidence = 0.2;

  if (userOverrideSignal) {
    confidence = 0.95;
  } else if (totalKeywordsMatched > 0) {
    confidence = Math.min(1.0, Number((0.65 + (best.score * 0.25)).toFixed(2)));
  } else if (activeMode !== 'normal' && best.score > 0.2) {
    confidence = 0.50; // Mode bias alone is weak (< 0.6)
  }

  const needsClarification = confidence < 0.6;

  // If confidence below 0.6: Propose Standard as the baseline tier and ask ONE short question
  let chosenPurpose = best.purpose;
  if (needsClarification) {
    chosenPurpose = 'school'; // Standard tier proposal
  }

  // 8. Quality Modifiers (Shift tier up or down)
  let tierShift = 0;
  if (rules.qualityModifiers) {
    for (const qLower of rules.qualityModifiers.lower) {
      if (lowerText.includes(qLower)) {
        tierShift = -1;
        signals.push(`quality_mod: '${qLower}' lowers tier (-1)`);
        break;
      }
    }
    if (tierShift === 0) {
      for (const qRaise of rules.qualityModifiers.raise) {
        if (lowerText.includes(qRaise)) {
          tierShift = 1;
          signals.push(`quality_mod: '${qRaise}' raises tier (+1)`);
          break;
        }
      }
    }
  }

  let finalTier = rules.purposes[chosenPurpose].tier;
  if (tierShift !== 0) {
    const curIdx = rules.tierOrder.indexOf(finalTier);
    const newIdx = Math.max(0, Math.min(rules.tierOrder.length - 1, curIdx + tierShift));
    finalTier = rules.tierOrder[newIdx];
  }

  const pInfo = rules.purposes[chosenPurpose];
  const energy = getTierEnergy(finalTier);

  // 9. Generate Natural Language Reason in User's Language
  let reason = '';
  let question = '';

  const targetTitle = rules.purposes[chosenPurpose]?.title || '';
  const matchedSignal = signals.find(s => s.startsWith('keyword:') && s.includes(`-> ${targetTitle}`))
    || signals.find(s => s.startsWith('keyword:'))
    || '';
  const matchedKwWord = matchedSignal ? (matchedSignal.match(/'([^']+)'/)?.[1] || '') : '';

  if (lang === 'ta') {
    // Tamil
    question = 'இதை எதற்காகப் பயன்படுத்தப் போகிறீர்கள்? (அரட்டை, ஸ்லைடு, சுவரொட்டி, அல்லது அச்சு)';
    if (userOverrideSignal) {
      reason = `கடந்த முறை '${userOverrideSignal.keyword}'-க்கு ${rules.purposes[userOverrideSignal.chosenPurpose].title} தேர்ந்தெடுத்தீர்கள், எனவே அதையே பரிந்துரைக்கிறேன். மின் சேமிப்பு: சுமார் ${energy.savePct}%.`;
    } else if (needsClarification) {
      reason = `குறிப்பிட்ட பயன்பாடு தெரியவில்லை. நடுத்தர Standard தரம் (1280×720) பரிந்துரைக்கிறேன்.`;
    } else if (chosenPurpose === 'print') {
      reason = `'${matchedKwWord || 'அச்சு'}' குறிப்பிட்டீர்கள், அச்சுக்கு முழுத் தரம் தேவை என்பதால் Max (${energy.wh} Wh, 0% சேமிப்பு).`;
    } else {
      reason = `'${matchedKwWord || pInfo.title}' குறிப்பிட்டீர்கள், எனவே ${finalTier} தரம் (${pInfo.size}) போதுமானது. சேமிப்பு: சுமார் ${energy.savePct}%.`;
    }
  } else if (lang === 'th') {
    // Thanglish
    question = 'Idhu edhuku use panna poreenga? (Phone chat, School project, Poster, or Print)';
    if (userOverrideSignal) {
      reason = `Last time '${userOverrideSignal.keyword}'-ku neenga ${rules.purposes[userOverrideSignal.chosenPurpose].title} choose panneenga, so adhaye propose panren. Energy save: ~${energy.savePct}%.`;
    } else if (needsClarification) {
      reason = `Single word sonneenga. Standard quality (1280×720) suggest panren (~92% saved vs Max).`;
    } else if (chosenPurpose === 'print') {
      reason = `'${matchedKwWord || 'print'}' sonneenga, printing-ku full clarity venum, so Max tier (0% saved).`;
    } else {
      reason = `'${matchedKwWord || pInfo.title}' sonneenga, idhuku ${finalTier} (${pInfo.size}) podhum. Estimated ${energy.wh} Wh (~${energy.savePct}% saved).`;
    }
  } else {
    // English
    question = 'Is this for chat, a slide, a poster or print?';
    if (userOverrideSignal) {
      reason = `Last time you chose ${rules.purposes[userOverrideSignal.chosenPurpose].title} for '${userOverrideSignal.keyword}', so I suggest ${rules.purposes[userOverrideSignal.chosenPurpose].title} again. Estimated ${energy.wh} Wh, about ${energy.savePct}% less than Max.`;
    } else if (needsClarification) {
      reason = `Single subject with no specific use mentioned. I propose Standard quality (1280×720) for slides and school projects. Estimated ${energy.wh} Wh, about ${energy.savePct}% less than Max.`;
    } else if (chosenPurpose === 'print') {
      reason = `You mentioned '${matchedKwWord || 'print'}', so high-resolution Max tier is required. Estimated ${energy.wh} Wh (Print needs Max quality, so 0% saved).`;
    } else {
      reason = `You mentioned '${matchedKwWord || pInfo.title}', so a ${finalTier} quality image is enough. Estimated ${energy.wh} Wh, about ${energy.savePct}% less than Max.`;
    }
  }

  // 10. Optional Second Opinion from LLM (if LLM_INFER=true in .env)
  if (process.env.LLM_INFER === 'true') {
    // Optional LLM inference integration (fail-safe)
    // Runs only if explicitly enabled in .env
  }

  const secondBest = second ? {
    purpose: second.def.title,
    purposeKey: second.purpose,
    tier: second.def.tier,
    size: (second.def.size || '').replace('×', 'x'),
    label: second.def.title
  } : {
    purpose: chosenPurpose === 'school' ? 'Phone chat' : 'School project',
    purposeKey: chosenPurpose === 'school' ? 'chat' : 'school',
    tier: chosenPurpose === 'school' ? 'Sketch' : 'Standard',
    size: chosenPurpose === 'school' ? '640x360' : '1280x720',
    label: chosenPurpose === 'school' ? 'Phone chat' : 'School project'
  };

  const cleanSize = (pInfo.size || '').replace('×', 'x');

  return {
    success: true,
    purpose: pInfo.title,
    purposeKey: chosenPurpose,
    purposeId: chosenPurpose,
    purposeLabel: pInfo.title,
    tier: finalTier,
    size: cleanSize,
    width: pInfo.width,
    height: pInfo.height,
    confidence: Number(confidence.toFixed(2)),
    needsClarification,
    question,
    reason,
    signals,
    secondBest,
    whProposed: energy.wh,
    whMax: 24.30,
    percentSaved: energy.savePct,
    userOverrideApplied: !!userOverrideSignal,
    language: lang
  };
}

function normalizePurpose(p) {
  if (!p) return 'chat';
  const lower = String(p).toLowerCase().trim();
  if (lower === 'chat' || lower.includes('phone') || lower.includes('whatsapp') || lower.includes('sketch')) return 'chat';
  if (lower === 'school' || lower.includes('school') || lower.includes('slide') || lower.includes('project') || lower.includes('standard')) return 'school';
  if (lower === 'poster' || lower.includes('banner') || lower.includes('detailed')) return 'poster';
  if (lower === 'print' || lower.includes('print') || lower.includes('max')) return 'print';
  return 'chat';
}

module.exports = {
  inferPurpose,
  detectLanguage,
  loadRules,
  getTierEnergy,
  normalizePurpose
};
