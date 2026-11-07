// Small scan-input helpers shared by the browser-only OCR pipeline.
export const MAX_SCAN_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_SCAN_IMAGES = 25;

const ACCEPTED_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function validateCombinedScanSize(files) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_SCAN_UPLOAD_BYTES) throw new Error('Please keep the combined upload size at or below 20 MB per scan.');
  return total;
}

export function isSupportedScanFile(file) {
  return ACCEPTED_IMAGES.includes(file.type) || file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
