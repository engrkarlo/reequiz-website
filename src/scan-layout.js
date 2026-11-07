/**
 * Detect the narrow, mostly empty vertical gutter on two-column exam pages.
 * Operates on a tiny canvas preview, not on OCR output or any network service.
 * Returning null means use ordinary single-page recognition.
 */
export function detectTwoColumnSplit({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 90 || height < 90 || !data || data.length < width * height * 4) return null;
  const yStart = Math.floor(height * 0.12);
  const yEnd = Math.floor(height * 0.93);
  const step = Math.max(1, Math.floor((yEnd - yStart) / 420));
  const profile = new Float64Array(width);
  const samples = Math.ceil((yEnd - yStart) / step);

  for (let y = yStart; y < yEnd; y += step) {
    let p = (y * width) * 4;
    for (let x = 0; x < width; x++, p += 4) {
      // Dark print on light exam paper. Excludes most paper texture and shadows.
      if (data[p + 3] > 128 && (data[p] * 3 + data[p + 1] * 6 + data[p + 2]) < 1650) profile[x]++;
    }
  }
  for (let x = 0; x < width; x++) profile[x] /= samples;

  function mean(from, to) {
    const a = Math.floor(width * from), b = Math.ceil(width * to);
    let sum = 0;
    for (let x = a; x < b; x++) sum += profile[x];
    return sum / Math.max(1, b - a);
  }

  // Sparse answer keys consist of narrow strips of "1. C" and "52. A".
  // Mean ink in the middle of each half is nearly zero for those pages,
  // although both columns are clearly present. Inspect peak activity instead.
  const peak = (from, to) => {
    let value = 0;
    for (let x = Math.floor(width * from); x < Math.ceil(width * to); x++)
      value = Math.max(value, profile[x] || 0);
    return value;
  };
  const leftPeak = peak(0.025, 0.43);
  const rightPeak = peak(0.51, 0.975);
  if (Math.min(leftPeak, rightPeak) < 0.045) return null;
  const threshold = Math.min(0.018, Math.min(leftPeak, rightPeak) * 0.19);

  const searchStart = Math.floor(width * 0.43);
  const searchEnd = Math.ceil(width * 0.57);
  let best = null;
  let start = -1;
  for (let x = searchStart; x <= searchEnd; x++) {
    const empty = x < searchEnd && profile[x] <= threshold;
    if (empty && start < 0) start = x;
    if (!empty && start >= 0) {
      const center = (start + x) / 2;
      const length = x - start;
      // Gutter must be at least 1.2% wide and near the page's middle.
      if (length >= width * 0.012 && center >= width * 0.445 && center <= width * 0.555 &&
        (!best || length > best.length)) best = { center, length };
      start = -1;
    }
  }
  if (!best) return null;

  // Both sides should contain text throughout most of the body. This avoids
  // misinterpreting centered headings or a few side-by-side answer choices.
  let leftBands = 0, rightBands = 0;
  const bands = 10;
  for (let band = 0; band < bands; band++) {
    const a = Math.floor(yStart + (yEnd - yStart) * band / bands);
    const b = Math.floor(yStart + (yEnd - yStart) * (band + 1) / bands);
    const scanSide = (from, to) => {
      const x0 = Math.floor(width * from), x1 = Math.ceil(width * to);
      let ink = 0, total = 0;
      for (let y = a; y < b; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          const k = (y * width + x) * 4;
          total++;
          if (data[k + 3] > 128 && data[k] * 3 + data[k + 1] * 6 + data[k + 2] < 1650) ink++;
        }
      }
      return ink / Math.max(total, 1);
    };
    // Cover the narrow numeric lists close to the outer edges as well as
    // wider question text. Requiring many occupied bands blocks false splits
    // on a few side-by-side multiple-choice answers.
    if (scanSide(0.025, Math.max(0.38, best.center / width - 0.02)) > 0.0025) leftBands++;
    if (scanSide(Math.min(0.57, best.center / width + 0.03), 0.975) > 0.0025) rightBands++;
  }
  if (Math.min(leftBands, rightBands) < 7) return null;

  return { fraction: best.center / width, gutterWidthFraction: best.length / width };
}

export function scanRegionsFromImageData(imageData) {
  const split = detectTwoColumnSplit(imageData);
  return split ? [
    { label: 'left column', left: 0, right: split.fraction },
    { label: 'right column', left: split.fraction, right: 1 }
  ] : [{ label: null, left: 0, right: 1 }];
}


/**
 * Printed answer-key photos often have two NARROW lists of "1. C" entries
 * separated by huge blank areas. Full column crops cause PSM 4 to skip most
 * of the first list. Locate the two real ink bands and crop tightly instead.
 * Detection uses only preview pixels and never contacts a server.
 */
export function detectNarrowKeyLanes({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 90 || height < 90 || !data || data.length < width * height * 4) return null;
  const profile = new Float64Array(width);
  const startY = Math.floor(height * 0.13), endY = Math.ceil(height * 0.88);
  let samples = 0;
  for (let y = startY; y < endY; y += 2) {
    samples++;
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      if (data[k+3] > 128 && (data[k]*3+data[k+1]*6+data[k+2]) < 1600)
        profile[x]++;
    }
  }
  for (let x = 0; x < width; x++) profile[x] /= samples;
  const candidates = [];
  const minX = Math.floor(width * 0.045), maxX = Math.ceil(width * 0.95);
  const maxGap = Math.max(3, Math.round(width * 0.018));
  for (let x = minX; x < maxX; x++) {
    if (profile[x] < 0.05) continue;
    const previous = candidates[candidates.length - 1];
    if (previous && x - previous.end <= maxGap) previous.end = x;
    else candidates.push({ start: x, end: x });
  }
  const lanes = candidates.filter(item => {
    const span = item.end - item.start;
    return span >= width * 0.025 && span <= width * 0.16;
  });
  if (lanes.length !== 2) return null;
  lanes.sort((a,b) => a.start - b.start);
  if ((lanes[1].start - lanes[0].end) < width * 0.23 ||
      lanes[0].start > width * 0.34 || lanes[1].start < width * 0.46) return null;
  const pad = width * 0.029;
  return lanes.map((lane,i) => ({
    label: i === 0 ? 'left column' : 'right column',
    left: Math.max(0, (lane.start - pad)/width),
    right: Math.min(1, (lane.end + pad)/width),
    keyLane: true
  }));
}


/**
 * Tesseract PSM 4 drops left-margin question numbers on many photographed
 * two-column exams by treating the number gutter as a separate text block.
 * PSM 6 keeps each cropped column's numbers attached to the question text.
 * The fallback is only used on questionable columns and may never silently
 * replace a more complete first pass.
 */
export function initialOcrMode(regions, forceAnswerKey = false) {
  if (forceAnswerKey || regions.some(region => region.keyLane)) return '6';
  return regions.length > 1 ? '6' : '3';
}

export function retryOcrMode(regions, forceAnswerKey = false) {
  if (forceAnswerKey || regions.some(region => region.keyLane)) return null;
  return regions.length > 1 ? '4' : '6';
}
