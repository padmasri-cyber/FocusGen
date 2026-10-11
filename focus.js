/**
 * focus.js - FocusGen Focus Region Detection & Clarity Pipeline
 * 
 * GOAL: Give high clarity to the important region of an image and only the
 * needed clarity to unimportant regions.
 * 
 * Features:
 * - Method A: Sharp-based saliency map (edge density + local contrast + center weighting)
 * - Method B: Natural language prompt hints (English, Tamil, Thanglish)
 * - Method C: User override bounding box (saved per image)
 * - Level 1 Post-Process Clarity Pipeline with feathered composite & natural depth-of-field
 * - Print Purpose: Keeps full clarity everywhere ("Print needs full clarity, focus map off")
 * - Level 2 (optional twopass behind FOCUS_MODE=twopass in .env, silent fallback)
 * - Safe fallback: if any operation fails, falls back silently to uniform compression.
 */

const sharp = require('sharp');

// Purpose dimensions & quality settings
const PURPOSE_CONFIG = {
  chat: { width: 640, height: 360, quality: 60, label: 'Phone chat' },
  school: { width: 1024, height: 576, quality: 75, label: 'School project' },
  project: { width: 1024, height: 576, quality: 75, label: 'Project' },
  poster: { width: 1280, height: 720, quality: 85, label: 'Poster' },
  print: { width: 1920, height: 1080, quality: 95, label: 'Print' }
};

/**
 * Method B: Natural Language Prompt Hint Inspection (English, Tamil, Thanglish)
 */
function inspectPromptHints(hintText) {
  if (!hintText || typeof hintText !== 'string') return null;
  const lower = hintText.toLowerCase().trim();

  // 1. Defocus / Blur Background hints (Tighter subject box)
  const blurPatterns = [
    /\b(background\s+blur|blur\s+background|blur\s+bg|defocus|shallow\s+depth|depth\s+of\s+field|bokeh|macro|portrait|close\s*up|isolated\s+subject)\b/i,
    /(பின்னணி\s*மங்கலா|மங்கலான\s*பின்னணி|எளிய\s*பின்னணி)/i,
    /\b(background\s*blur\s*pannu|blur\s*pannu|bokeh\s*venum|blur\s*bg)\b/i
  ];

  for (const pat of blurPatterns) {
    if (pat.test(lower)) {
      return { type: 'tight_focus', scaleFactor: 0.75, reason: 'Request requested background blur / shallow depth of field' };
    }
  }

  // 2. Wide / Landscape / All-in-focus hints (Wider focus box)
  const widePatterns = [
    /\b(landscape|wide\s*angle|wide\s*shot|panoramic|scenic|full\s*view|group\s*photo|all\s*in\s*focus|crisp\s*everywhere|sharp\s*everywhere)\b/i,
    /(முழு\s*காட்சி|பரந்த\s*காட்சி)/i,
    /\b(wide\s*shot|full-ah\s*focus|full\s*focus)\b/i
  ];

  for (const pat of widePatterns) {
    if (pat.test(lower)) {
      return { type: 'wide_focus', scaleFactor: 1.35, reason: 'Request requested wide / panoramic composition' };
    }
  }

  return null;
}

/**
 * Method A & B & C: Detect Focus Region
 * Returns a focus box { x, y, width, height, feather } as percentages (0 to 100).
 */
async function detectFocusRegion(imageBuffer, options = {}) {
  const { hintText = '', userBox = null, purpose = 'chat' } = options;

  // Print mode: full canvas clarity
  if (purpose === 'print') {
    return {
      box: { x: 0, y: 0, width: 100, height: 100, feather: 0 },
      method: 'print_full',
      confidence: 1.0,
      isPrint: true,
      flat: false
    };
  }

  // METHOD C: User Override (Drag-and-drop bounding box)
  if (userBox && typeof userBox === 'object') {
    const x = Math.max(0, Math.min(90, Number(userBox.x || 0)));
    const y = Math.max(0, Math.min(90, Number(userBox.y || 0)));
    const width = Math.max(10, Math.min(100 - x, Number(userBox.width || 60)));
    const height = Math.max(10, Math.min(100 - y, Number(userBox.height || 60)));
    const feather = Math.max(5, Math.min(30, Number(userBox.feather || 15)));

    return {
      box: {
        x: Number(x.toFixed(1)),
        y: Number(y.toFixed(1)),
        width: Number(width.toFixed(1)),
        height: Number(height.toFixed(1)),
        feather: Number(feather.toFixed(1))
      },
      method: 'user_override',
      confidence: 1.0,
      isPrint: false,
      flat: false
    };
  }

  // METHOD A: Saliency map on downscaled grayscale image with Sharp
  try {
    const gridW = 64;
    const gridH = 64;

    const rawBuffer = await sharp(imageBuffer)
      .resize(gridW, gridH, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    // 1. Calculate Edge Density (Sobel-like gradient approximation) and Local Contrast
    const saliency = new Float32Array(gridW * gridH);
    let totalEnergy = 0;
    let minE = Infinity;
    let maxE = -Infinity;

    const cx = (gridW - 1) / 2;
    const cy = (gridH - 1) / 2;

    for (let y = 1; y < gridH - 1; y++) {
      for (let x = 1; x < gridW - 1; x++) {
        const idx = y * gridW + x;
        const val = rawBuffer[idx];

        // Gradient magnitude
        const gx = Math.abs(rawBuffer[y * gridW + (x + 1)] - rawBuffer[y * gridW + (x - 1)]);
        const gy = Math.abs(rawBuffer[(y + 1) * gridW + x] - rawBuffer[(y - 1) * gridW + x]);
        const edgeMag = gx + gy;

        // Local contrast (variance across 3x3 window)
        let localSum = 0;
        let localSqSum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nVal = rawBuffer[(y + dy) * gridW + (x + dx)];
            localSum += nVal;
            localSqSum += nVal * nVal;
          }
        }
        const mean = localSum / 9;
        const variance = Math.sqrt(Math.max(0, (localSqSum / 9) - (mean * mean)));

        // Base saliency = 65% edge density + 35% local contrast
        const baseSaliency = 0.65 * edgeMag + 0.35 * variance;

        // Center weighting (Gaussian falloff from center, Rule of Thirds bias)
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        const distSq = dx * dx + dy * dy;
        const centerWeight = Math.exp(-distSq / (2 * 0.45 * 0.45));

        const weightedVal = baseSaliency * centerWeight;
        saliency[idx] = weightedVal;
        totalEnergy += weightedVal;

        if (weightedVal < minE) minE = weightedVal;
        if (weightedVal > maxE) maxE = weightedVal;
      }
    }

    // Flatness Check: if dynamic range or energy is very small, fall back to centered box
    const energyRange = maxE - minE;
    if (totalEnergy < 50 || energyRange < 5) {
      return {
        box: { x: 20, y: 15, width: 60, height: 70, feather: 15 },
        method: 'centered_fallback',
        confidence: 0.5,
        isPrint: false,
        flat: true
      };
    }

    // 2. Find Center of Mass & Primary Saliency Window
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const e = saliency[y * gridW + x];
        sumX += x * e;
        sumY += y * e;
      }
    }

    const focalX = totalEnergy > 0 ? sumX / totalEnergy : cx;
    const focalY = totalEnergy > 0 ? sumY / totalEnergy : cy;

    // Find bounding box around (focalX, focalY) containing ~65% of the total saliency mass
    const targetMass = totalEnergy * 0.65;
    let accumulatedMass = 0;

    // Expand search radius around center of mass
    let halfSpanX = 8;
    let halfSpanY = 8;

    while (halfSpanX < gridW / 2 || halfSpanY < gridH / 2) {
      accumulatedMass = 0;
      const minX = Math.max(0, Math.floor(focalX - halfSpanX));
      const maxX = Math.min(gridW - 1, Math.ceil(focalX + halfSpanX));
      const minY = Math.max(0, Math.floor(focalY - halfSpanY));
      const maxY = Math.min(gridH - 1, Math.ceil(focalY + halfSpanY));

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          accumulatedMass += saliency[y * gridW + x];
        }
      }

      if (accumulatedMass >= targetMass) break;
      if (halfSpanX < gridW * 0.42) halfSpanX += 1.5;
      if (halfSpanY < gridH * 0.42) halfSpanY += 1.5;
    }

    let minX = Math.max(0, focalX - halfSpanX);
    let maxX = Math.min(gridW, focalX + halfSpanX);
    let minY = Math.max(0, focalY - halfSpanY);
    let maxY = Math.min(gridH, focalY + halfSpanY);

    // Convert to percentages
    let xPercent = (minX / gridW) * 100;
    let yPercent = (minY / gridH) * 100;
    let wPercent = ((maxX - minX) / gridW) * 100;
    let hPercent = ((maxY - minY) / gridH) * 100;

    // Ensure sensible minimums and maximums (at least 35% x 35%, at most 80% x 80%)
    wPercent = Math.max(35, Math.min(80, wPercent));
    hPercent = Math.max(35, Math.min(80, hPercent));
    xPercent = Math.max(5, Math.min(100 - wPercent - 5, xPercent));
    yPercent = Math.max(5, Math.min(100 - hPercent - 5, yPercent));

    // METHOD B: Apply prompt hints if present
    const promptHint = inspectPromptHints(hintText);
    let detectionMethod = 'sharp_saliency';

    if (promptHint) {
      detectionMethod = 'prompt_hint';
      const factor = promptHint.scaleFactor;
      const newW = Math.max(28, Math.min(85, wPercent * factor));
      const newH = Math.max(28, Math.min(85, hPercent * factor));
      // Re-center box around previous focal point
      const centerX = xPercent + wPercent / 2;
      const centerY = yPercent + hPercent / 2;
      xPercent = Math.max(3, Math.min(100 - newW - 3, centerX - newW / 2));
      yPercent = Math.max(3, Math.min(100 - newH - 3, centerY - newH / 2));
      wPercent = newW;
      hPercent = newH;
    }

    return {
      box: {
        x: Number(xPercent.toFixed(1)),
        y: Number(yPercent.toFixed(1)),
        width: Number(wPercent.toFixed(1)),
        height: Number(hPercent.toFixed(1)),
        feather: 15.0
      },
      method: detectionMethod,
      confidence: promptHint ? 0.95 : 0.85,
      isPrint: false,
      flat: false
    };

  } catch (err) {
    // Safe fallback on any error: centered box
    return {
      box: { x: 20, y: 15, width: 60, height: 70, feather: 15 },
      method: 'centered_fallback',
      confidence: 0.5,
      isPrint: false,
      flat: true
    };
  }
}

/**
 * Level 1 Focus Clarity Pipeline
 * Generates both "Focus clarity" (feathered depth-of-field composite) and
 * "Uniform clarity" baseline at the designated purpose size.
 */
async function applyFocusClarity(imageBuffer, options = {}) {
  const {
    box: providedBox = null,
    purpose = 'chat',
    hintText = '',
    quality: customQuality = null,
    enabled = true
  } = options;

  const targetPurpose = (purpose || 'chat').toLowerCase();
  const pConfig = PURPOSE_CONFIG[targetPurpose] || PURPOSE_CONFIG.chat;
  const targetW = pConfig.width;
  const targetH = pConfig.height;
  const quality = customQuality || pConfig.quality;

  // PRINT MODE: Full clarity everywhere, focus map off
  if (targetPurpose === 'print') {
    const uniformBuffer = await sharp(imageBuffer)
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    const bytes = uniformBuffer.length;
    return {
      success: true,
      focusedBuffer: uniformBuffer,
      uniformBuffer,
      focusedDataUrl: `data:image/webp;base64,${uniformBuffer.toString('base64')}`,
      uniformDataUrl: `data:image/webp;base64,${uniformBuffer.toString('base64')}`,
      focusedSizeBytes: bytes,
      uniformSizeBytes: bytes,
      percentSavedBytes: 0,
      focusBox: { x: 0, y: 0, width: 100, height: 100, feather: 0 },
      isPrint: true,
      printNotice: 'Print needs full clarity, focus map off',
      method: 'print_full',
      clarityAllocation: {
        subjectPercent: 100,
        backgroundPercent: 0,
        savedBytesPercent: 0,
        summaryText: 'Clarity allocation: subject 100% of pixels at full detail (Print needs full clarity everywhere). Output file 0.0% smaller.'
      },
      modeLabel: 'Focus clarity (Print - full clarity)'
    };
  }

  // If focus clarity is explicitly toggled off
  if (enabled === false) {
    const uniformBuffer = await sharp(imageBuffer)
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    const bytes = uniformBuffer.length;
    return {
      success: true,
      focusedBuffer: uniformBuffer,
      uniformBuffer,
      focusedDataUrl: `data:image/webp;base64,${uniformBuffer.toString('base64')}`,
      uniformDataUrl: `data:image/webp;base64,${uniformBuffer.toString('base64')}`,
      focusedSizeBytes: bytes,
      uniformSizeBytes: bytes,
      percentSavedBytes: 0,
      focusBox: providedBox || { x: 20, y: 15, width: 60, height: 70, feather: 15 },
      isPrint: false,
      method: 'uniform_clarity',
      clarityAllocation: {
        subjectPercent: 100,
        backgroundPercent: 0,
        savedBytesPercent: 0,
        summaryText: 'Clarity allocation: uniform clarity across full canvas.'
      },
      modeLabel: 'Uniform clarity'
    };
  }

  try {
    // 1. Detect or use focus box
    const focusMeta = providedBox
      ? { box: providedBox, method: 'user_override' }
      : await detectFocusRegion(imageBuffer, { hintText, purpose: targetPurpose });

    const box = focusMeta.box;

    // 2. Normalize canvas size for compositing
    const baseCanvas = await sharp(imageBuffer)
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();

    const canvasMeta = await sharp(baseCanvas).metadata();
    const actualW = canvasMeta.width;
    const actualH = canvasMeta.height;

    // 3. Layer 1: Subject (High clarity, light sharpening)
    const subjRaw = await sharp(baseCanvas)
      .sharpen({ sigma: 0.5, m1: 0.5, m2: 0.8 })
      .toColourspace('srgb')
      .raw()
      .toBuffer();

    // 4. Layer 2: Background (Soft depth-of-field: downscale 50% + upscale + soft blur, stronger compression)
    const halfW = Math.max(16, Math.round(actualW * 0.5));
    const halfH = Math.max(16, Math.round(actualH * 0.5));
    const bgQuality = Math.max(30, Math.round(quality * 0.60));
    const bgCompressed = await sharp(baseCanvas)
      .resize(halfW, halfH, { fit: 'fill' })
      .webp({ quality: bgQuality })
      .toBuffer();

    const bgRaw = await sharp(bgCompressed)
      .resize(actualW, actualH, { fit: 'fill', kernel: 'lanczos3' })
      .blur(3.0)
      .toColourspace('srgb')
      .raw()
      .toBuffer();

    // 5. Layer 3: Smooth Feathered Alpha Mask
    // Coordinates in pixels
    const bx = Math.round((box.x / 100) * actualW);
    const by = Math.round((box.y / 100) * actualH);
    const bw = Math.max(10, Math.round((box.width / 100) * actualW));
    const bh = Math.max(10, Math.round((box.height / 100) * actualH));
    const featherPx = Math.max(8, Math.round(((box.feather || 15) / 100) * Math.min(actualW, actualH)));

    const maskRaw = Buffer.alloc(actualW * actualH, 0);

    for (let y = 0; y < actualH; y++) {
      for (let x = 0; x < actualW; x++) {
        // Distance to inside of box
        const insideX = x >= bx && x < bx + bw;
        const insideY = y >= by && y < by + bh;

        if (insideX && insideY) {
          maskRaw[y * actualW + x] = 255;
        } else {
          // Distance from the nearest edge of the box
          const dx = x < bx ? bx - x : (x >= bx + bw ? x - (bx + bw) : 0);
          const dy = y < by ? by - y : (y >= by + bh ? y - (by + bh) : 0);
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < featherPx) {
            // Smooth cosine / smoothstep falloff in feather ring
            const t = dist / featherPx;
            const alpha = 0.5 * (1 + Math.cos(Math.PI * t)); // 1.0 at edge -> 0.0 at feather boundary
            maskRaw[y * actualW + x] = Math.round(255 * alpha);
          } else {
            maskRaw[y * actualW + x] = 0;
          }
        }
      }
    }

    // Smooth blur on mask to guarantee completely invisible feathered boundary
    const maskBlurRaw = await sharp(maskRaw, {
      raw: { width: actualW, height: actualH, channels: 1 }
    })
      .blur(Math.max(1, Math.round(featherPx * 0.4)))
      .toColourspace('b-w')
      .raw()
      .toBuffer();

    // 6. Direct Mathematical Alpha Composite (out = a * subj + (1 - a) * bg)
    const totalPixels = actualW * actualH;
    const compositeRaw = Buffer.alloc(totalPixels * 3);

    for (let i = 0; i < totalPixels; i++) {
      const a = maskBlurRaw[i] / 255.0;
      const idx = i * 3;
      compositeRaw[idx] = Math.round(a * subjRaw[idx] + (1 - a) * bgRaw[idx]);
      compositeRaw[idx + 1] = Math.round(a * subjRaw[idx + 1] + (1 - a) * bgRaw[idx + 1]);
      compositeRaw[idx + 2] = Math.round(a * subjRaw[idx + 2] + (1 - a) * bgRaw[idx + 2]);
    }

    const focusedBuffer = await sharp(compositeRaw, {
      raw: { width: actualW, height: actualH, channels: 3 }
    })
      .webp({ quality, effort: 4 })
      .toBuffer();

    // 7. Generate Uniform Clarity Baseline
    const uniformBuffer = await sharp(baseCanvas)
      .webp({ quality, effort: 4 })
      .toBuffer();

    // 8. Honest Metrics Calculation
    const focusedSizeBytes = focusedBuffer.length;
    const uniformSizeBytes = uniformBuffer.length;
    const percentSavedBytes = Math.max(0, ((uniformSizeBytes - focusedSizeBytes) / uniformSizeBytes) * 100);

    const subjectPixelArea = (bw * bh);
    const totalPixelArea = actualW * actualH;
    const subjectPercent = Math.min(100, Math.round((subjectPixelArea / totalPixelArea) * 100));
    const backgroundPercent = Math.max(0, 100 - subjectPercent);

    const summaryText = `Clarity allocation: subject ${subjectPercent}% of pixels at full detail, background at reduced detail. Output file ${percentSavedBytes.toFixed(1)}% smaller.`;

    return {
      success: true,
      focusedBuffer,
      uniformBuffer,
      focusedDataUrl: `data:image/webp;base64,${focusedBuffer.toString('base64')}`,
      uniformDataUrl: `data:image/webp;base64,${uniformBuffer.toString('base64')}`,
      focusedSizeBytes,
      uniformSizeBytes,
      percentSavedBytes: Number(percentSavedBytes.toFixed(1)),
      focusBox: box,
      method: focusMeta.method,
      isPrint: false,
      clarityAllocation: {
        subjectPercent,
        backgroundPercent,
        savedBytesPercent: Number(percentSavedBytes.toFixed(1)),
        summaryText
      },
      modeLabel: 'Focus clarity (post-process)'
    };

  } catch (err) {
    // SAFE FALLBACK: If anything fails, generate normal compressed image
    const uniformFallback = await sharp(imageBuffer)
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    const bytes = uniformFallback.length;
    return {
      success: true,
      focusedBuffer: uniformFallback,
      uniformBuffer: uniformFallback,
      focusedDataUrl: `data:image/webp;base64,${uniformFallback.toString('base64')}`,
      uniformDataUrl: `data:image/webp;base64,${uniformFallback.toString('base64')}`,
      focusedSizeBytes: bytes,
      uniformSizeBytes: bytes,
      percentSavedBytes: 0,
      focusBox: { x: 20, y: 15, width: 60, height: 70, feather: 15 },
      isPrint: targetPurpose === 'print',
      method: 'safe_fallback',
      clarityAllocation: {
        subjectPercent: 100,
        backgroundPercent: 0,
        savedBytesPercent: 0,
        summaryText: 'Clarity allocation: uniform clarity (fallback).'
      },
      modeLabel: 'Uniform clarity (fallback)'
    };
  }
}

/**
 * Optional Level 2 (behind FOCUS_MODE=twopass in .env, off by default)
 */
function isTwoPassEnabled() {
  return (process.env.FOCUS_MODE || '').toLowerCase().trim() === 'twopass';
}

module.exports = {
  detectFocusRegion,
  applyFocusClarity,
  inspectPromptHints,
  isTwoPassEnabled,
  PURPOSE_CONFIG
};
