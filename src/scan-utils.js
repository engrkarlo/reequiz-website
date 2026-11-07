export const MAX_SCAN_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_SCAN_IMAGES = 25;
export const MAX_SCAN_IMAGES_PER_REQUEST = 3;
// Keep JSON + base64 under Vercel's 4.5 MB function-body ceiling.
export const MAX_SCAN_BATCH_BYTES = Math.floor(2.5 * 1024 * 1024);
const ACCEPTED_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function validateCombinedScanSize(files) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_SCAN_UPLOAD_BYTES) throw new Error('Please keep the combined upload size at or below 20 MB per scan.');
  return total;
}

export function isSupportedScanFile(file) {
  return ACCEPTED_IMAGES.includes(file.type) || file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function decodedSize(data) {
  return Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}

function readDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return reject(new Error(`Could not encode ${file.name}.`));
      resolve(dataUrl.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function canvasToScanImage(canvas, name) {
  let current = canvas;
  for (let attempt = 0; attempt < 9; attempt++) {
    for (const quality of [0.86, 0.74, 0.62]) {
      const dataUrl = current.toDataURL('image/jpeg', quality);
      const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (decodedSize(data) <= MAX_SCAN_BATCH_BYTES) return { name, mimeType: 'image/jpeg', data };
    }
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(300, Math.floor(current.width * 0.8));
    smaller.height = Math.max(300, Math.floor(current.height * 0.8));
    if (smaller.width === current.width && smaller.height === current.height) break;
    const context = smaller.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(current, 0, 0, smaller.width, smaller.height);
    if (current !== canvas) { current.width = 0; current.height = 0; }
    current = smaller;
  }
  throw new Error(`${name} could not be compressed enough to scan. Try a lower-resolution image.`);
}

async function prepareImage(file) {
  if (file.size <= MAX_SCAN_BATCH_BYTES) {
    return [{ name: file.name, mimeType: file.type, data: await readDataURL(file) }];
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`Could not read image ${file.name}.`));
      element.src = url;
    });
    const scale = Math.min(1, 2800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = await canvasToScanImage(canvas, file.name);
    canvas.width = 0; canvas.height = 0;
    return [result];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function preparePdf(file) {
  const pdfjs = await import(/* @vite-ignore */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages > 10) throw new Error(`${file.name} has ${pdf.numPages} pages. Please split it into PDFs of 10 pages or fewer.`);
  const pages = [];
  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('PDF rendering is unavailable in this browser.');
      await page.render({ canvasContext: context, viewport }).promise;
      pages.push(await canvasToScanImage(canvas, `${file.name} — page ${pageNo}`));
      canvas.width = 0; canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

export async function prepareScanFiles(files) {
  if (!files.length) throw new Error('Choose at least one image or PDF to scan.');
  if (files.some(file => !isSupportedScanFile(file))) throw new Error('Use PDF, JPEG, PNG, WEBP, or GIF files.');
  validateCombinedScanSize(files);
  const pages = [];
  // Encode sequentially to avoid allocating every PDF canvas in memory at once.
  for (const file of files) {
    const converted = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      ? await preparePdf(file) : await prepareImage(file);
    pages.push(...converted);
    if (pages.length > MAX_SCAN_IMAGES) throw new Error('This scan creates more than 25 page images. Please split the files into smaller scans.');
  }
  return pages;
}

export function buildScanBatches(pages) {
  const batches = [];
  let batch = [];
  let bytes = 0;
  for (const page of pages) {
    const size = decodedSize(page.data);
    if (size > MAX_SCAN_BATCH_BYTES) throw new Error(`${page.name} is too large for an AI scan request.`);
    if (batch.length && (batch.length >= MAX_SCAN_IMAGES_PER_REQUEST || bytes + size > MAX_SCAN_BATCH_BYTES)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(page);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function reconcileScanAnswers(questions, answerKeys) {
  const keys = new Map();
  for (const entry of answerKeys) {
    const number = Number(entry.number);
    const letter = String(entry.answer || '').trim().toUpperCase();
    if (!Number.isInteger(number) || number < 1 || !/^[A-H]$/.test(letter)) continue;
    if (keys.has(number) && keys.get(number) !== letter) keys.set(number, null);
    else if (!keys.has(number)) keys.set(number, letter);
  }
  const counts = new Map();
  for (const question of questions) {
    if (Number.isInteger(question.number)) counts.set(question.number, (counts.get(question.number) || 0) + 1);
  }
  return questions.map(question => {
    if (question.answerProvided || counts.get(question.number) !== 1) return question;
    const letter = keys.get(question.number);
    const answer = letter ? letter.charCodeAt(0) - 65 : -1;
    return answer >= 0 && answer < question.options.length
      ? { ...question, answer, answerProvided: true }
      : question;
  });
}
