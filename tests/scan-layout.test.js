import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTwoColumnSplit, scanRegionsFromImageData } from '../src/scan-layout.js';

// Pure pixel fixtures. Tests exercise layout, not Tesseract output or a network.
function fixture({ left = true, right = true, singleColumn = false, rightBands = 10, header = false } = {}) {
  const width = 360, height = 600, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const k = (y * width + x) * 4;
        data[k] = 30; data[k + 1] = 30; data[k + 2] = 30;
      }
    }
  };
  if (header) ink(120, 20, 250, 28);
  for (let n = 0; n < 23; n++) {
    const y = 85 + n * 20;
    if (singleColumn) ink(14, y, 344, y + 4);
    else {
      if (left) ink(14, y, 157, y + 4);
      if (right && n < rightBands * 2.3) ink(194, y, 347, y + 4);
    }
  }
  return { width, height, data };
}

test('two columns are detected from a continuous whitespace gutter', () => {
  const result = detectTwoColumnSplit(fixture({ header: true }));
  assert.ok(result);
  assert.ok(result.fraction > 0.46 && result.fraction < 0.54);
  assert.equal(scanRegionsFromImageData(fixture()).length, 2);
});

test('left column is scanned before right column', () => {
  const regions = scanRegionsFromImageData(fixture());
  assert.deepEqual(regions.map(region => region.label), ['left column', 'right column']);
  assert.equal(regions[0].left, 0);
  assert.equal(regions[1].right, 1);
  assert.equal(regions[0].right, regions[1].left);
});

test('single-column pages are not split', () => {
  assert.equal(detectTwoColumnSplit(fixture({ singleColumn: true })), null);
});

test('missing right-column text never triggers a split', () => {
  assert.equal(detectTwoColumnSplit(fixture({ right: false })), null);
});

test('a few side-by-side options do not turn a page into two columns', () => {
  assert.equal(detectTwoColumnSplit(fixture({ rightBands: 2 })), null);
});

test('reject small or invalid image data without throwing', () => {
  assert.equal(detectTwoColumnSplit({ width: 2, height: 2, data: new Uint8ClampedArray(16) }), null);
});
