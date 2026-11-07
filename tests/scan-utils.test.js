import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SCAN_UPLOAD_BYTES, MAX_SCAN_IMAGES, validateCombinedScanSize, isSupportedScanFile } from '../src/scan-utils.js';

test('20 MB combined limit accepts exactly 20 MB and rejects larger uploads', () => {
  assert.equal(validateCombinedScanSize([{ size: 12 * 1024 * 1024 }, { size: 8 * 1024 * 1024 }]), MAX_SCAN_UPLOAD_BYTES);
  assert.throws(() => validateCombinedScanSize([{ size: MAX_SCAN_UPLOAD_BYTES + 1 }]), /20 MB/);
});

test('images and PDFs are recognized regardless of PDF browser MIME omission', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.equal(isSupportedScanFile({ type: mime, name: 'picture' }), true);
  }
  assert.equal(isSupportedScanFile({ type: '', name: 'practice.pdf' }), true);
  assert.equal(isSupportedScanFile({ type: 'application/pdf', name: 'scan' }), true);
  assert.equal(isSupportedScanFile({ type: '', name: 'malware.exe' }), false);
});

test('maximum scanned pages stays bounded for offline mobile workloads', () => {
  assert.equal(MAX_SCAN_IMAGES, 25);
});
