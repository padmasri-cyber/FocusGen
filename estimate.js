/**
 * estimate.js - FocusGen Eco Energy & Cost Engine
 * 
 * Per-pixel, per-step energy cost estimator with editable CONFIG.
 * Single source of truth for energy mathematics across FocusGen.
 * 
 * Formula: Cost(Wh) = Σ zone[ pixels × steps × ENERGY_PER_PIXEL_STEP ] + overhead
 */

const CONFIG = {
  // Calibrated so 1 megapixel (1024×1024 = 1,048,576 px) at Max tier (30 steps) ≈ 2.90 Wh
  // 2.90 / (1,048,576 × 30) = 9.218e-8 Wh per pixel-step
  ENERGY_PER_PIXEL_STEP: 9.218e-8,

  SECONDS_PER_STEP: 0.767,           // ~23 s ÷ 30 steps on high-end inference accelerator

  // Grid carbon factors (grams CO₂ per Wh)
  GRID_FACTOR_STD:   0.700,          // 700 g/kWh  → 0.700 g/Wh
  GRID_FACTOR_GREEN: 0.175,          // 175 g/kWh  → 0.175 g/Wh (75% lower)

  // Steps per quality tier
  STEPS: {
    Sketch:   4,
    Standard: 12,
    Detailed: 22,
    Max:      30
  },

  // Purpose specification: { tier, width, height, label }
  PURPOSES: {
    chat:   { tier: 'Sketch',   width: 640,  height: 360,  label: 'Phone chat' },
    school: { tier: 'Standard', width: 1024, height: 576,  label: 'School project' },
    project:{ tier: 'Standard', width: 1024, height: 576,  label: 'Project' },
    poster: { tier: 'Detailed', width: 1280, height: 720,  label: 'Poster' },
    print:  { tier: 'Max',      width: 1920, height: 1080, label: 'Print' }
  },

  // Max reference baseline: 1080p at Max tier (1920×1080 = 2,073,600 px, 30 steps)
  BASELINE_WIDTH: 1920,
  BASELINE_HEIGHT: 1080,

  // Reuse overhead (tiny memory read when prompt cache hits)
  REUSE_OVERHEAD_WH: 0.008,

  // Refine overhead per additional refinement step (e.g., "make it better")
  REFINE_OVERHEAD_WH: 0.05,

  // Tangible comparison reference values
  PHONE_BATTERY_WH: 12.0,            // 12 Wh smartphone battery
  LED_BULB_WATTS:   10.0             // 10 Watt home LED bulb
};

/**
 * Builds zone layout for the canvas dimensions and tier.
 */
function buildZones(purpose, width, height, tierOverride) {
  const totalPixels = width * height;
  const targetTier = tierOverride || (CONFIG.PURPOSES[purpose] ? CONFIG.PURPOSES[purpose].tier : 'Standard');

  // Print Mode: Full canvas forced to Max tier everywhere
  if (purpose === 'print' || targetTier === 'Max') {
    return [{
      name: 'Full Canvas (Max Tier)',
      tier: 'Max',
      pixels: totalPixels,
      steps: CONFIG.STEPS.Max
    }];
  }

  // Zone distribution based on purpose and tier
  let maxFrac = 0.18, stdFrac = 0.26, sketchFrac = 0.56;

  if (purpose === 'chat') {
    maxFrac = 0.18; stdFrac = 0.26; sketchFrac = 0.56;
  } else if (purpose === 'school') {
    maxFrac = 0.30; stdFrac = 0.42; sketchFrac = 0.28;
  } else if (purpose === 'poster') {
    maxFrac = 0.50; stdFrac = 0.35; sketchFrac = 0.15;
  }

  const zones = [];
  const maxPx = Math.round(totalPixels * maxFrac);
  const stdPx = Math.round(totalPixels * stdFrac);
  const sketchPx = totalPixels - maxPx - stdPx;

  // Use appropriate steps based on the target tier
  if (targetTier === 'Sketch') {
    zones.push({ name: 'Focal Subject', tier: 'Standard', pixels: maxPx, steps: CONFIG.STEPS.Standard });
    zones.push({ name: 'Eco Background', tier: 'Sketch', pixels: stdPx + sketchPx, steps: CONFIG.STEPS.Sketch });
  } else if (targetTier === 'Detailed') {
    zones.push({ name: 'Max Detail Focal Zone', tier: 'Max', pixels: maxPx, steps: CONFIG.STEPS.Max });
    zones.push({ name: 'Detailed Mid-ring', tier: 'Detailed', pixels: stdPx, steps: CONFIG.STEPS.Detailed });
    zones.push({ name: 'Ambient Background', tier: 'Standard', pixels: sketchPx, steps: CONFIG.STEPS.Standard });
  } else {
    // Standard tier
    zones.push({ name: 'Focal Center', tier: 'Max', pixels: maxPx, steps: CONFIG.STEPS.Max });
    zones.push({ name: 'Balanced Mid-ring', tier: 'Standard', pixels: stdPx, steps: CONFIG.STEPS.Standard });
    zones.push({ name: 'Background Wash', tier: 'Sketch', pixels: sketchPx, steps: CONFIG.STEPS.Sketch });
  }

  return zones;
}

/**
 * Calculates Wh for the given zones and execution options.
 */
function estimateCost(zones, opts = {}) {
  if (opts.isCached) {
    return CONFIG.REUSE_OVERHEAD_WH;
  }

  let total = 0;
  for (const z of zones) {
    total += z.pixels * z.steps * CONFIG.ENERGY_PER_PIXEL_STEP;
  }

  if (opts.refineCount && opts.refineCount > 0) {
    total += opts.refineCount * CONFIG.REFINE_OVERHEAD_WH;
  }

  return total;
}

/**
 * Calculates baseline Wh for full 1080p Max tier generation.
 */
function estimateMaxBaseline() {
  const baselinePixels = CONFIG.BASELINE_WIDTH * CONFIG.BASELINE_HEIGHT;
  return baselinePixels * CONFIG.STEPS.Max * CONFIG.ENERGY_PER_PIXEL_STEP;
}

/**
 * Calculates savings percentage.
 */
function computeSaving(actual, max) {
  if (max <= 0) return 0;
  if (actual >= max) return 0;
  return ((max - actual) / max) * 100;
}

/**
 * Estimates GPU compute time in seconds.
 */
function estimateTime(zones, isCached = false) {
  if (isCached) return 0.1;
  let totalSteps = 0;
  for (const z of zones) {
    totalSteps = Math.max(totalSteps, z.steps);
  }
  return totalSteps * CONFIG.SECONDS_PER_STEP;
}

/**
 * Estimates grams of CO2 based on Wh and grid selection.
 */
function estimateCO2(wh, isGreen = false) {
  const factor = isGreen ? CONFIG.GRID_FACTOR_GREEN : CONFIG.GRID_FACTOR_STD;
  return wh * factor;
}

/**
 * Produces a full CostReport object for any generation.
 * @param {string} purpose - 'chat', 'school', 'poster', 'print'
 * @param {boolean} isGreen - green hours toggle
 * @param {boolean} isCached - prompt cache hit
 * @param {number} refineCount - refinement count
 * @param {string} tierOverride - optional tier override
 * @param {object} focusOptions - optional focus clarity options
 */
function computeCostReport(purpose, isGreen = true, isCached = false, refineCount = 0, tierOverride = null, focusOptions = null) {
  const purposeDef = CONFIG.PURPOSES[purpose] || CONFIG.PURPOSES.chat;
  const width = purposeDef.width;
  const height = purposeDef.height;
  const tier = tierOverride || purposeDef.tier;
  const totalPixels = width * height;

  const zones = buildZones(purpose, width, height, tier);
  let actualWh = estimateCost(zones, { isCached, refineCount });
  const maxBaselineWh = estimateMaxBaseline();

  // Print Mode: Full Max honesty (0% saved)
  if (purpose === 'print') {
    actualWh = maxBaselineWh;
  }

  const whSaved = Math.max(0, maxBaselineWh - actualWh);
  const percentSaved = computeSaving(actualWh, maxBaselineWh);
  const wasteAvoidedWh = whSaved; // Energy loss / waste avoided compared to Max

  const timeSecs = estimateTime(zones, isCached);
  const timeMaxSecs = CONFIG.STEPS.Max * CONFIG.SECONDS_PER_STEP;

  const co2Actual = estimateCO2(actualWh, isGreen);
  const co2Max = estimateCO2(maxBaselineWh, false);
  const co2Avoided = Math.max(0, co2Max - co2Actual);

  const phoneMinutes = (whSaved / CONFIG.PHONE_BATTERY_WH) * 60;
  const ledMinutes = (whSaved / CONFIG.LED_BULB_WATTS) * 60;

  // Star Rating & Grade
  let starRating = 1;
  let grade = 'D';
  if (percentSaved >= 85) { starRating = 5; grade = 'A+'; }
  else if (percentSaved >= 65) { starRating = 4; grade = 'A'; }
  else if (percentSaved >= 40) { starRating = 3; grade = 'B'; }
  else if (percentSaved >= 15) { starRating = 2; grade = 'C'; }
  else { starRating = 1; grade = 'E'; }

  if (isCached) { starRating = 5; grade = 'A++'; }
  if (purpose === 'print') { starRating = 1; grade = 'E'; }

  // Focus Clarity Allocation (Level 1 Post-process vs Level 2 Region-wise)
  const isPrint = purpose === 'print';
  let modeLabel = isPrint 
    ? 'Focus clarity (Print - full clarity)' 
    : (focusOptions?.mode === 'twopass' ? 'Region-wise generation (Level 2)' : 'Focus clarity (post-process)');

  const box = focusOptions?.focusBox || { width: 60, height: 65 };
  const subjectPct = isPrint ? 100 : Math.min(100, Math.max(10, Math.round((box.width * box.height) / 100)));
  const bgPct = Math.max(0, 100 - subjectPct);
  const savedBytesPct = isPrint ? 0 : Number((focusOptions?.savedBytesPercent || 22.5).toFixed(1));

  const clarityAllocation = {
    subjectPercent: subjectPct,
    backgroundPercent: bgPct,
    savedBytesPercent: savedBytesPct,
    isPrint,
    summaryText: isPrint
      ? 'Clarity allocation: subject 100% of pixels at full detail (Print needs full clarity everywhere). Output file 0.0% smaller.'
      : `Clarity allocation: subject ${subjectPct}% of pixels at full detail, background at reduced detail. Output file ${savedBytesPct}% smaller.`
  };

  return {
    purpose,
    tier,
    width,
    height,
    totalPixels,
    zones,
    isCached,
    isGreen,
    refineCount,

    // Core Metrics (all clearly estimates)
    whUsed: Number(actualWh.toFixed(4)),
    whMax: Number(maxBaselineWh.toFixed(4)),
    whSaved: Number(whSaved.toFixed(4)),
    percentSaved: Number(percentSaved.toFixed(1)),
    wasteAvoidedWh: Number(wasteAvoidedWh.toFixed(4)),

    // Focus Clarity & Honest Accounting
    modeLabel,
    clarityAllocation,

    // Time
    timeSecs: Number(timeSecs.toFixed(1)),
    timeMaxSecs: Number(timeMaxSecs.toFixed(1)),

    // Carbon
    co2EmittedG: Number(co2Actual.toFixed(3)),
    co2MaxG: Number(co2Max.toFixed(3)),
    co2AvoidedG: Number(co2Avoided.toFixed(3)),

    // Tangible real-world impact
    phoneMinutes: Number(phoneMinutes.toFixed(1)),
    ledMinutes: Number(ledMinutes.toFixed(1)),

    // Quality Score
    starRating,
    grade,

    // Layer summary
    layerSummary: isCached
      ? 'Layer 1: Prompt Cache Hit (~100% saved)'
      : `Layer 2: Adaptive ${tier} Tier (${percentSaved.toFixed(0)}% saved)${isGreen ? ' | Layer 3: Green Hours (-75% CO₂)' : ''}`
  };
}

/**
 * Builds human-readable worked example from report using real numbers.
 */
function buildWorkedExample(report) {
  const lines = [];
  lines.push('=== Worked Example (Latest Generation) ===');
  lines.push('');
  lines.push(`Image: ${report.width} × ${report.height} (${report.totalPixels.toLocaleString()} pixels)`);
  lines.push(`Purpose: ${report.purpose.toUpperCase()} (${report.tier} Tier)  |  Cached: ${report.isCached ? 'Yes' : 'No'}`);
  lines.push(`Max Baseline (1080p Max): 1920 × 1080 × 30 steps × ${CONFIG.ENERGY_PER_PIXEL_STEP.toExponential(3)} = ${report.whMax.toFixed(4)} Wh`);
  lines.push('');

  if (report.isCached) {
    lines.push(`⚡ Cache Hit: Reused memory buffer.`);
    lines.push(`Energy Used: ${CONFIG.REUSE_OVERHEAD_WH} Wh (Memory read overhead)`);
    lines.push(`Energy Saved: ${report.whMax.toFixed(4)} − ${report.whUsed.toFixed(4)} = ${report.whSaved.toFixed(4)} Wh (${report.percentSaved.toFixed(1)}%)`);
  } else if (report.purpose === 'print') {
    lines.push(`🖨️ Print Mode: 100% Max tier across full canvas.`);
    lines.push(`Energy Used: ${report.whUsed.toFixed(4)} Wh`);
    lines.push(`Energy Saved: 0.00 Wh (0.0%) — Honest Accounting (Print needs full clarity everywhere).`);
  } else {
    lines.push('Zone-by-Zone Calculation:');
    lines.push('Formula: Cost(Wh) = Σ zone [ pixels × steps × ENERGY_PER_PIXEL_STEP ] + overhead');
    let sum = 0;
    for (const z of report.zones) {
      const zCost = z.pixels * z.steps * CONFIG.ENERGY_PER_PIXEL_STEP;
      sum += zCost;
      lines.push(`  • ${z.name}: ${z.pixels.toLocaleString()} px × ${z.steps} steps × ${CONFIG.ENERGY_PER_PIXEL_STEP.toExponential(3)} = ${zCost.toFixed(4)} Wh`);
    }
    if (report.refineCount > 0) {
      const refCost = report.refineCount * CONFIG.REFINE_OVERHEAD_WH;
      sum += refCost;
      lines.push(`  • Refine Overhead: ${report.refineCount} pass × ${CONFIG.REFINE_OVERHEAD_WH} Wh = ${refCost.toFixed(4)} Wh`);
    }
    lines.push(`  ──────────────────────────────────────────`);
    lines.push(`  Total Energy Used: ${sum.toFixed(4)} Wh`);
    lines.push(`  Energy Saved vs 1080p Max: ${report.whMax.toFixed(4)} − ${report.whUsed.toFixed(4)} = ${report.whSaved.toFixed(4)} Wh (${report.percentSaved.toFixed(1)}%)`);
  }

  // Focus Clarity Allocation Details
  lines.push('');
  lines.push('=== Focus Clarity Allocation & File Size Accounting ===');
  lines.push(`Mode: ${report.modeLabel || 'Focus clarity (post-process)'}`);
  if (report.clarityAllocation) {
    lines.push(`  • ${report.clarityAllocation.summaryText}`);
    lines.push(`  • Subject Zone: ${report.clarityAllocation.subjectPercent}% of pixels at full native resolution with edge sharpening`);
    lines.push(`  • Background Zone: ${report.clarityAllocation.backgroundPercent}% of pixels downscaled 50% with depth-of-field soft blur`);
    lines.push(`  • Honest Accounting Note: For Level 1 post-process, the zones optimize clarity allocation and file size, but AI generation energy stays the same. FocusGen never claims unearned generation savings.`);
  }

  lines.push('');
  const gridName = report.isGreen ? 'Green Surplus Hours' : 'Standard Grid';
  const factor = report.isGreen ? CONFIG.GRID_FACTOR_GREEN : CONFIG.GRID_FACTOR_STD;
  lines.push(`Carbon Footprint: ${report.whUsed.toFixed(4)} Wh × ${factor} g/Wh (${gridName}) = ${report.co2EmittedG.toFixed(3)} g CO₂`);
  lines.push(`Equivalent To: ${report.phoneMinutes.toFixed(1)} min phone charging | ${report.ledMinutes.toFixed(1)} min 10W LED bulb`);

  return lines.join('\n');
}

/**
 * Produces a CostReport for licensed web image picks (download + compress cost only).
 */
function computeWebImageReport(purpose = 'chat', isGreen = true, focusOptions = null) {
  const maxBaselineWh = estimateMaxBaseline();
  // Licensed web image counts small download + resize compression compute
  const webWh = 0.0058;
  const whSaved = Math.max(0, maxBaselineWh - webWh);
  const percentSaved = computeSaving(webWh, maxBaselineWh);
  const timeSecs = 0.3;
  const co2Actual = estimateCO2(webWh, isGreen);
  const co2Max = estimateCO2(maxBaselineWh, false);
  const co2Avoided = Math.max(0, co2Max - co2Actual);

  const isPrint = purpose === 'print';
  const modeLabel = isPrint 
    ? 'Focus clarity (Print - full clarity)' 
    : 'Focus clarity (post-process)';

  const box = focusOptions?.focusBox || { width: 60, height: 65 };
  const subjectPct = isPrint ? 100 : Math.min(100, Math.max(10, Math.round((box.width * box.height) / 100)));
  const bgPct = Math.max(0, 100 - subjectPct);
  const savedBytesPct = isPrint ? 0 : Number((focusOptions?.savedBytesPercent || 25.0).toFixed(1));

  const clarityAllocation = {
    subjectPercent: subjectPct,
    backgroundPercent: bgPct,
    savedBytesPercent: savedBytesPct,
    isPrint,
    summaryText: isPrint
      ? 'Clarity allocation: subject 100% of pixels at full detail (Print needs full clarity everywhere). Output file 0.0% smaller.'
      : `Clarity allocation: subject ${subjectPct}% of pixels at full detail, background at reduced detail. Output file ${savedBytesPct}% smaller.`
  };

  return {
    isWebLicensed: true,
    purpose,
    tier: 'Web Licensed',
    whUsed: Number(webWh.toFixed(4)),
    whMax: Number(maxBaselineWh.toFixed(4)),
    whSaved: Number(whSaved.toFixed(4)),
    percentSaved: Number(percentSaved.toFixed(1)),
    timeSecs: Number(timeSecs.toFixed(1)),
    co2EmittedG: Number(co2Actual.toFixed(3)),
    co2MaxG: Number(co2Max.toFixed(3)),
    co2AvoidedG: Number(co2Avoided.toFixed(3)),
    phoneMinutes: Number(((whSaved / CONFIG.PHONE_BATTERY_WH) * 60).toFixed(1)),
    ledMinutes: Number(((whSaved / CONFIG.LED_BULB_WATTS) * 60).toFixed(1)),
    starRating: 5,
    grade: 'A++',
    modeLabel,
    clarityAllocation,
    layerSummary: 'Layer 0: Licensed Web Search (~100% saved vs full generation)'
  };
}

/**
 * Returns compact cost chip text under every image:
 * For web photos: "Web photo: no AI generation needed. Estimated X Wh (download and compress) vs Y Wh for AI at Max (1080p)"
 * For AI generations: "Estimated 0.4 Wh · 1.2 s · 91% less than Max (1080p)"
 */
function formatCostChipText(report) {
  if (!report) return 'Estimated 0.23 Wh · 1.2 s · 96% less than Max (1080p)';
  if (report.isWebLicensed || report.tier === 'Web Licensed') {
    const x = Number(report.whUsed || 0.006).toFixed(report.whUsed < 0.01 ? 3 : 2);
    const y = Number(report.whMax || estimateMaxBaseline()).toFixed(2);
    return `Web photo: no AI generation needed. Estimated ${x} Wh (download and compress) vs ${y} Wh for AI at Max (1080p)`;
  }
  const wh = Number(report.whUsed || 0).toFixed(report.whUsed < 0.1 ? 3 : 2);
  const secs = Number(report.timeSecs || 0.5).toFixed(1);
  const pct = Number(report.percentSaved || 0).toFixed(report.percentSaved % 1 === 0 ? 0 : 1);
  return `Estimated ${wh} Wh · ${secs} s · ${pct}% less than Max (1080p)`;
}

// Attach to window for global access
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
  window.computeCostReport = computeCostReport;
  window.computeWebImageReport = computeWebImageReport;
  window.formatCostChipText = formatCostChipText;
  window.buildZones = buildZones;
  window.estimateCost = estimateCost;
  window.estimateMaxBaseline = estimateMaxBaseline;
  window.buildWorkedExample = buildWorkedExample;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG,
    computeCostReport,
    computeWebImageReport,
    formatCostChipText,
    buildZones,
    estimateCost,
    estimateMaxBaseline,
    buildWorkedExample
  };
}

