import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { isSupportedScanFile, validateCombinedScanSize, MAX_SCAN_IMAGES } from './scan-utils.js';
import { parseOfflineQuizPages } from './offline-quiz-parser.js';
import { scanRegionsFromImageData } from './scan-layout.js';

const OCR_BASE = '/ocr';
const MAX_PDF_PAGES = 10;
const MAX_OCR_EDGE = 2400;
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;


// Reuse the expensive WebAssembly model between scans instead of initializing
// and terminating it for every upload. Everything is self-hosted and offline.
let cachedWorker = null;
let cachedWorkerPromise = null;
let currentPSM = null;
async function getCachedWorker(onProgress) {
  if (cachedWorker) return cachedWorker;
  if (!cachedWorkerPromise) {
    onProgress('Loading the locally cached OCR engine…');
    cachedWorkerPromise = createWorker('eng', 1, {
      workerPath: OCR_BASE + '/worker.min.js',
      corePath: OCR_BASE + '/core',
      langPath: OCR_BASE + '/lang',
      workerBlobURL: false,
      gzip: true
    }).then(worker => {
      cachedWorker = worker;
      return worker;
    }).catch(error => {
      cachedWorkerPromise = null;
      currentPSM = null;
      throw error;
    });
  }
  return cachedWorkerPromise;
}

// Inspect a small, inexpensive preview rather than running a whole-page OCR
// pass just to discover whether there are two independent text columns.
function regionsForCanvas(canvas) {
  const preview = document.createElement('canvas');
  const scale = Math.min(1, 360 / canvas.width);
  preview.width = Math.max(1, Math.round(canvas.width * scale));
  preview.height = Math.max(1, Math.round(canvas.height * scale));
  try {
    const ctx = preview.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [{ label: null, left: 0, right: 1 }];
    ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
    return scanRegionsFromImageData(ctx.getImageData(0, 0, preview.width, preview.height));
  } catch {
    return [{ label: null, left: 0, right: 1 }];
  } finally {
    preview.width = 0;
    preview.height = 0;
  }
}

// Crop each detected column separately, in natural reading order. By using
// Tesseract's single-column page segmentation for each half we avoid mixing
// horizontally aligned questions from opposite sides of an exam paper.
async function recognizeCanvas(canvas, name, onProgress) {
  const regions = regionsForCanvas(canvas);
  const worker = await getCachedWorker(onProgress);
  const mode = regions.length > 1 ? '4' : '3';
  if (currentPSM !== mode) {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    currentPSM = mode;
  }
  const results = [];
  const crop = document.createElement('canvas');
  try {
    for (const region of regions) {
      const x = Math.floor(canvas.width * region.left);
      crop.width = Math.max(1, Math.ceil(canvas.width * region.right) - x);
      crop.height = canvas.height;
      const context = crop.getContext('2d');
      if (!context) throw new Error('Image cropping is unavailable in this browser.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, crop.width, crop.height);
      context.drawImage(canvas, x, 0, crop.width, canvas.height, 0, 0, crop.width, crop.height);
      const label = region.label ? name + ' — ' + region.label : name;
      onProgress('Reading ' + label + ' offline…');
      const ocr = await worker.recognize(crop);
      results.push({
        name: label, sourcePage: name, column: region.label,
        text: ocr?.data?.text || '', confidence: ocr?.data?.confidence ?? null, type: 'ocr'
      });
    }
  } finally {
    crop.width = 0;
    crop.height = 0;
  }
  return results;
}

function textFromPdfItems(items) {
  let output = '';
  let previousY = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = Number(item.transform?.[5] ?? 0);
    if (previousY !== null && Math.abs(y - previousY) > 3) output += '\n';
    else if (output && !output.endsWith('\n') && !output.endsWith(' ')) output += ' ';
    output += item.str;
    previousY = y;
    if (item.hasEOL) {
      output += '\n';
      previousY = null;
    }
  }
  return output.trim();
}

function imageOnCanvas(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_OCR_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('Canvas is unavailable in this browser.'));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not open ' + file.name + ' as an image.'));
    };
    image.src = url;
  });
}

/**
 * Local-only scan: PDF text is read on-device; image and scanned PDF pages
 * are recognized with a self-hosted Tesseract WebAssembly worker.
 * No external providers are contacted and no scan content leaves the browser.
 */
export async function scanQuizFilesOffline(files, onProgress = () => {}) {
  if (!Array.isArray(files) || !files.length) throw new Error('Choose at least one image or PDF to scan.');
  if (files.some(file => !isSupportedScanFile(file))) throw new Error('Use PDF, JPEG, PNG, WEBP, or GIF files.');
  validateCombinedScanSize(files);

  const pages = [];
  let pageCount = 0;
  const recognize = (canvas, name) => recognizeCanvas(canvas, name, onProgress);

  try {
    for (const file of files) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf) {
        if (pageCount >= MAX_SCAN_IMAGES) throw new Error(`Scan up to ${MAX_SCAN_IMAGES} images/pages at a time.`);
        const canvas = await imageOnCanvas(file);
        try { pages.push(...await recognize(canvas, file.name)); pageCount++; }
        finally { canvas.width = 0; canvas.height = 0; }
        continue;
      }
      onProgress(`Opening ${file.name} locally…`);
      const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
      const pdf = await task.promise;
      try {
        if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`${file.name} has ${pdf.numPages} pages. Split PDFs into files of ${MAX_PDF_PAGES} pages or fewer.`);
        if (pageCount + pdf.numPages > MAX_SCAN_IMAGES) throw new Error(`Scan up to ${MAX_SCAN_IMAGES} images/pages at a time.`);
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const name = `${file.name} — page ${i}`;
          onProgress(`Checking selectable text on ${name}…`);
          const extracted = textFromPdfItems((await page.getTextContent()).items);
          if (extracted.replace(/\s+/g, '').length >= 8) {
            pages.push({ name, sourcePage: name, text: extracted, confidence: null, type: 'pdf-text' });
            pageCount++;
            page.cleanup();
            continue;
          }
          const viewport = page.getViewport({ scale: 1.65 });
          const scale = Math.min(1, MAX_OCR_EDGE / Math.max(viewport.width, viewport.height));
          const target = scale === 1 ? viewport : page.getViewport({ scale: 1.65 * scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(target.width);
          canvas.height = Math.ceil(target.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('PDF rendering is unavailable on this device.');
          try {
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: context, viewport: target }).promise;
            pages.push(...await recognize(canvas, name));
            pageCount++;
          } finally {
            canvas.width = 0;
            canvas.height = 0;
            page.cleanup();
          }
        }
      } finally {
        await pdf.destroy();
      }
    }
    onProgress('Matching questions with printed answer keys locally…');
    const parsed = parseOfflineQuizPages(pages);
    return { ...parsed, pages, pageCount, columnsDetected: pages.filter(p => p.column).length, scannedFiles: files.length };
  } finally {
    // Keep the worker ready for subsequent scans; the browser disposes it on navigation.
  }
}
