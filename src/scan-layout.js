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

  const leftInk = mean(0.14, 0.40);
  const rightInk = mean(0.60, 0.86);
  if (Math.min(leftInk, rightInk) < 0.024) return null;
  const threshold = Math.min(0.018, Math.min(leftInk, rightInk) * 0.23);

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
    if (scanSide(0.14, 0.40) > 0.014) leftBands++;
    if (scanSide(0.60, 0.86) > 0.014) rightBands++;
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
