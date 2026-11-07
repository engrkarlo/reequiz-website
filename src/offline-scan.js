import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { isSupportedScanFile, validateCombinedScanSize, MAX_SCAN_IMAGES } from './scan-utils.js';
import { parseOfflineQuizPages } from './offline-quiz-parser.js';
import { scanRegionsFromImageData, detectNarrowKeyLanes } from './scan-layout.js';
import { retryColumnsForOCR, ocrResultScore, lateRetryColumnIndices } from './ocr-recovery.js';

const OCR_BASE = '/ocr';
const MAX_PDF_PAGES = 10;
const MAX_OCR_EDGE = 2400;
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;


// Reuse the expensive WebAssembly model between scans instead of initializing
// and terminating it for every upload. Everything is self-hosted and offline.
let cachedWorker = null;
let cachedWorkerPromise = null;
let currentPSM = null;
/**
 * Load the on-device Tesseract worker once per session, reusing language data.
 * @param {(message:string)=>void} onProgress Progress reporter.
 * @returns {Promise<object>} Ready OCR worker.
 */
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
/**
 * Inspect a small image preview for normal columns or narrow key strips.
 * @param {HTMLCanvasElement} canvas Full resolution source page.
 * @returns {Array<object>} Ordered crop regions.
 */
function regionsForCanvas(canvas) {
  const preview = document.createElement('canvas');
  const scale = Math.min(1, 360 / canvas.width);
  preview.width = Math.max(1, Math.round(canvas.width * scale));
  preview.height = Math.max(1, Math.round(canvas.height * scale));
  try {
    const ctx = preview.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [{ label: null, left: 0, right: 1 }];
    ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
    const previewData = ctx.getImageData(0, 0, preview.width, preview.height);
    return detectNarrowKeyLanes(previewData) || scanRegionsFromImageData(previewData);
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
/**
 * OCR each column locally and selectively retry low-confidence parsing.
 * @param {HTMLCanvasElement} canvas Rendered photo or PDF page.
 * @param {string} name Human-readable page name.
 * @param {(message:string)=>void} onProgress Progress reporter.
 * @param {boolean} forceAnswerKey Explicit key-only file designation.
 * @returns {Promise<Array<object>>} OCR section results with role metadata.
 */
async function recognizeCanvas(canvas, name, onProgress, forceAnswerKey = false) {
  const regions = regionsForCanvas(canvas);
  const worker = await getCachedWorker(onProgress);
  const mode = (forceAnswerKey || regions.some(region => region.keyLane)) ? '6' : regions.length > 1 ? '4' : '3';
  if (currentPSM !== mode) {
    await worker.setParameters({ tessedit_pageseg_mode: mode });
    currentPSM = mode;
  }
  const results = [];
  const crop = document.createElement('canvas');
  try {
    for (const region of regions) {
      const x = Math.floor(canvas.width * region.left);
      const sourceWidth = Math.max(1, Math.ceil(canvas.width * region.right) - x);
      // Printed answer-key glyphs are much smaller than exam question text.
      // A tight, 2x enlarged strip with PSM 6 recovers lines that PSM 4
      // silently skips when a mostly empty half-page is passed to Tesseract.
      const keyLane = Boolean(region.keyLane);
      const sourceY = keyLane ? Math.floor(canvas.height * 0.09) : 0;
      const sourceHeight = keyLane ? Math.ceil(canvas.height * 0.83) : canvas.height;
      const upscale = keyLane && sourceWidth < 450 ? 2 : 1;
      crop.width = sourceWidth * upscale;
      crop.height = sourceHeight * upscale;
      const context = crop.getContext('2d');
      if (!context) throw new Error('Image cropping is unavailable in this browser.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, crop.width, crop.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(canvas, x, sourceY, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);
      const label = region.label ? name + ' — ' + region.label : name;
      onProgress('Reading ' + label + ' offline…');
      const ocr = await worker.recognize(crop);
      results.push({
        name: label, sourcePage: name, column: region.label, keyLane: Boolean(region.keyLane),
        scanRole: forceAnswerKey ? 'answer-key' : undefined,
        text: ocr?.data?.text || '', confidence: ocr?.data?.confidence ?? null, type: 'ocr'
      });
    }

    // Recover only suspicious columns. This costs an extra OCR pass solely
    // where the numbered sequence has gaps, options are incomplete, or a
    // printed answer-key list is missing entries.
    const retryIndices = (forceAnswerKey || regions.some(region => region.keyLane)) ? [] : retryColumnsForOCR(results);
    for (const i of retryIndices) {
      const region = regions[i];
      const x = Math.floor(canvas.width * region.left);
      crop.width = Math.max(1, Math.ceil(canvas.width * region.right) - x);
      crop.height = canvas.height;
      const context = crop.getContext('2d');
      if (!context) continue;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, crop.width, crop.height);
      context.drawImage(canvas, x, 0, crop.width, canvas.height, 0, 0, crop.width, crop.height);
      results[i].retryAttempted = true;
      onProgress('Double-checking ' + (region.label || 'page') + ' for missing numbers…');
      try {
        if (currentPSM !== '6') {
          await worker.setParameters({ tessedit_pageseg_mode: '6' });
          currentPSM = '6';
        }
        const alternate = await worker.recognize(crop);
        const candidate = {
          ...results[i], text: alternate?.data?.text || '',
          confidence: alternate?.data?.confidence ?? null, retryAttempted: true,
          recovered: true
        };
        const replaced = [...results];
        replaced[i] = candidate;
        if (ocrResultScore(replaced) > ocrResultScore(results)) results[i] = candidate;
      } catch {
        // Never discard the first-pass result when recovery OCR fails.
      }
    }
  } finally {
    crop.width = 0;
    crop.height = 0;
  }
  return results;
}

/**
 * Preserve text line boundaries from selectable PDF glyph positions.
 * @param {Array<object>} items PDF.js text content items.
 * @returns {string} Ordered extracted text.
 */
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

/**
 * Decode a local image to a bounded canvas without uploading its contents.
 * @param {File} file User-selected image file.
 * @returns {Promise<HTMLCanvasElement>} Rendered page canvas.
 */
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
 * Scan local photos/PDF pages and reconcile explicit printed answer keys.
 * File indices, not names, determine role and page identity. Identical
 * filenames are not interchangeable. No scan content leaves the browser.
 * @param {File[]} files Selected images and PDF documents.
 * @param {(message:string)=>void} onProgress Progress reporter.
 * @param {{answerKeyIndices?:number[]}} options Explicit key-file indices.
 * @returns {Promise<object>} Questions and source-aware scan diagnostics.
 */
export async function scanQuizFilesOffline(files, onProgress = () => {}, options = {}) {
  if (!Array.isArray(files) || !files.length) throw new Error('Choose at least one image or PDF to scan.');
  if (files.some(file => !isSupportedScanFile(file))) throw new Error('Use PDF, JPEG, PNG, WEBP, or GIF files.');
  validateCombinedScanSize(files);

  const pages = [];
  let pageCount = 0;
  let forceAnswerKey = false;
  const recognize = async (canvas, name, sourceId, fileIndex) => {
    const sections = await recognizeCanvas(canvas, name, onProgress, forceAnswerKey);
    return sections.map(section => ({ ...section, sourceId, fileIndex }));
  };

  try {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      forceAnswerKey = Array.isArray(options.answerKeyIndices) && options.answerKeyIndices.includes(fileIndex);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf) {
        if (pageCount >= MAX_SCAN_IMAGES) throw new Error(`Scan up to ${MAX_SCAN_IMAGES} images/pages at a time.`);
        const canvas = await imageOnCanvas(file);
        try { pages.push(...await recognize(canvas, file.name, `file:${fileIndex}:image`, fileIndex)); pageCount++; }
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
            pages.push({ name, sourcePage: name, sourceId: `file:${fileIndex}:page:${i}`,
              fileIndex, scanRole: forceAnswerKey ? 'answer-key' : undefined,
              text: extracted, confidence: null, type: 'pdf-text' });
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
            pages.push(...await recognize(canvas, name, `file:${fileIndex}:page:${i}`, fileIndex));
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
    // A separate answer-key image can reveal an edge question (such as #1
    // or #100) that was missed before the answer key became available.
    // Retry only nearby, still-untried photo columns.
    const initialAudit = parseOfflineQuizPages(pages);
    const lateIndices = lateRetryColumnIndices(pages, initialAudit.missingQuestionNumbers);
    for (const i of lateIndices) {
      const section = pages[i];
      const file = Number.isInteger(section.fileIndex) ? files[section.fileIndex] : null;
      if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) continue;
      if (!file) continue;
      section.retryAttempted = true;
      onProgress('Checking missed question numbers in ' + (section.column || file.name) + '…');
      let canvas = null, crop = null;
      try {
        canvas = await imageOnCanvas(file);
        const regions = regionsForCanvas(canvas);
        const region = regions.find(item => item.label === section.column) ||
          (regions.length === 1 ? regions[0] : null);
        if (!region) continue;
        const x = Math.floor(canvas.width * region.left);
        crop = document.createElement('canvas');
        crop.width = Math.max(1, Math.ceil(canvas.width * region.right) - x);
        crop.height = canvas.height;
        const context = crop.getContext('2d');
        if (!context) continue;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, crop.width, crop.height);
        context.drawImage(canvas, x, 0, crop.width, canvas.height, 0, 0, crop.width, crop.height);
        const worker = await getCachedWorker(onProgress);
        if (currentPSM !== '6') {
          await worker.setParameters({ tessedit_pageseg_mode: '6' });
          currentPSM = '6';
        }
        const ocr = await worker.recognize(crop);
        const candidate = {
          ...section, text: ocr?.data?.text || '',
          confidence: ocr?.data?.confidence ?? null,
          retryAttempted: true, recovered: true
        };
        const attempted = pages.slice();
        attempted[i] = candidate;
        if (ocrResultScore(attempted) > ocrResultScore(pages)) pages[i] = candidate;
      } catch {
        // Failed fallback must never discard the initial OCR result.
      } finally {
        if (crop) { crop.width = 0; crop.height = 0; }
        if (canvas) { canvas.width = 0; canvas.height = 0; }
      }
    }
    onProgress('Matching questions with printed answer keys locally…');
    const parsed = parseOfflineQuizPages(pages);
    return { ...parsed, pages, pageCount, columnsDetected: pages.filter(p => p.column).length,
      retriedRegions: pages.filter(p => p.retryAttempted).length,
      recoveredRegions: pages.filter(p => p.recovered).length,
      scannedFiles: files.length };
  } finally {
    // Keep the worker ready for subsequent scans; the browser disposes it on navigation.
  }
}
