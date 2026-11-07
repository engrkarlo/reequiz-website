import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SCAN_UPLOAD_BYTES, MAX_SCAN_IMAGES_PER_REQUEST,
  validateCombinedScanSize, buildScanBatches, reconcileScanAnswers, isSupportedScanFile
} from '../src/scan-utils.js';

test('20 MB original-file limit is combined and inclusive', () => {
  assert.equal(validateCombinedScanSize([{ size: 12 * 1024 * 1024 }, { size: 8 * 1024 * 1024 }]), MAX_SCAN_UPLOAD_BYTES);
  assert.throws(() => validateCombinedScanSize([{ size: MAX_SCAN_UPLOAD_BYTES + 1 }]), /20 MB/);
});

test('batching never exceeds three pages and keeps order', () => {
  const pages = Array.from({ length: 8 }, (_, i) => ({ name: String(i), data: 'QQ==' }));
  const batches = buildScanBatches(pages);
  assert.deepEqual(batches.map(batch => batch.length), [3, 3, 2]);
  assert.ok(batches.every(batch => batch.length <= MAX_SCAN_IMAGES_PER_REQUEST));
  assert.deepEqual(batches.flat().map(page => page.name), pages.map(page => page.name));
});

test('batching splits pages when encoded byte size exceeds budget', () => {
  const data = 'A'.repeat(4 * 850_000); // 2.55 MB per page, close to request ceiling
  const batch = buildScanBatches([{ name: 'one', data }, { name: 'two', data }]);
  assert.deepEqual(batch.map(group => group.length), [1, 1]);
});

test('separately printed answer keys confirm uniquely numbered questions', () => {
  const questions = [
    { number: 1, options: ['A', 'B'], answer: null, answerProvided: false },
    { number: 2, options: ['A', 'B', 'C'], answer: null, answerProvided: false },
    { number: 2, options: ['A', 'B', 'C'], answer: null, answerProvided: false }
  ];
  const result = reconcileScanAnswers(questions, [{ number: 1, answer: 'B' }, { number: 2, answer: 'C' }]);
  assert.equal(result[0].answer, 1);
  assert.equal(result[0].answerProvided, true);
  assert.equal(result[1].answerProvided, false);
  assert.equal(result[2].answerProvided, false);
});

test('conflicting keys do not auto-confirm an answer', () => {
  const input = [{ number: 5, options: ['A', 'B'], answer: null, answerProvided: false }];
  const output = reconcileScanAnswers(input, [{ number: 5, answer: 'A' }, { number: 5, answer: 'B' }]);
  assert.equal(output[0].answerProvided, false);
});

test('PDF extension works when a browser omits the content type', () => {
  assert.equal(isSupportedScanFile({ name: 'practice.pdf', type: '' }), true);
  assert.equal(isSupportedScanFile({ name: 'bad.exe', type: '' }), false);
});
