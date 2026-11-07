# REEQUIZ

**A simple, polished place to turn quiz files into study sessions.**

REEQUIZ lets you import quizzes, practice at your own pace, review explanations, and keep track of your progress. It works in your browser, keeps your library on your device, and can be installed for offline use.

![REEQUIZ preview](docs/reequiz-preview.svg)

## App showcase

The SVG previews below illustrate the three main workspace tabs, based on the current app UI. They are lightweight, scalable images that render directly on GitHub.

### Overview

Your starting point for importing quizzes, jumping into study, and getting a quick snapshot of your workspace.

![REEQUIZ Overview tab](docs/overview-showcase.svg)

### Statistics

Review completed sessions, average accuracy, total study time, recent results, and answer reviews.

![REEQUIZ Statistics tab](docs/statistics-showcase.svg)

### My Library

Keep quiz sets organized into collections, search your library, and launch practice sessions.

![REEQUIZ My Library tab](docs/library-showcase.svg)


## What you can do

- **Bring your own quizzes:** Import supported `.quiz` and JSON files, or create a quiz from scratch.
- **Study your way:** Practice mode, timed sessions, shuffled questions and choices, and review of missed questions.
- **Pick up where you left off:** Quiz sessions, answers, preferences, and statistics are saved in your browser.
- **Understand the answers:** Explanations are available when included in a quiz, and the optional AI quiz tutor can check answer keys and prepare explanations.
- **Make it yours:** Choose a light or dark theme, customize quiz profiles, and use the responsive layout on desktop or mobile.
- **Study offline:** After opening the app online once and allowing it to cache, the installed app shell and saved quiz data can be used offline. AI preparation still needs an internet connection.

## Getting started

### Use REEQUIZ

Run REEQUIZ locally using the steps below, import a quiz from **My Library**, and start a session. You don't need an account.

### Run it on your computer

You’ll need Node.js 20 or newer (Node.js 22 recommended for deployment).

```bash
npm install
npm run dev
```

To create a production build:

```bash
npm run build
npm run preview
```

## Quiz file formats

REEQUIZ accepts:

- **`.json`** files with a `title` and a `questions` array. Each question can include `question`, `options`, `answer`, and `explanation`.
- **`.quiz`** files using the ZIP-based format supported by the importer, including the `multipleChoiceV2` entries used by the Custom Quiz app.

Not every variation of the `.quiz` format is guaranteed to import cleanly. Check imported questions and correct answers before relying on a quiz for an exam.

## Optional AI quiz tutor

AI preparation is optional. Turn on **AI quiz tutor** in Settings, then choose **AI validate & explain** for a quiz in My Library. The tutor can review answer keys and generate explanations with feedback for each choice. Results are saved with the quiz so prepared explanations can be read offline.

AI responses can be wrong, so review answer-key changes before studying from them. AI preparation itself requires an internet connection.

### Configure the AI endpoint

The AI endpoint uses server-side environment variables. Configure these in the environment used to host the server endpoint:

- `GROQ_API_KEY` — primary provider key.
- `GEMINI_API_KEY` — second provider key. Used if Groq fails, is unavailable, or reaches its quota; Groq is likewise a fallback when Gemini is primary.
- `GROQ_MODEL` — optional model override.
- `GEMINI_MODEL` — optional model override for Gemini (default: `gemini-2.5-flash`).
- `AI_PRIMARY_PROVIDER` — optional `groq` (default) or `gemini`. The other available provider is automatically tried if the primary fails.
- `AI_PREPARE_PROVIDER` — optional primary-provider override for AI validate & explain.

## Fully offline Quiz Studio scanner

Quiz Studio scans image files (JPG, PNG, WebP, GIF) and PDFs **entirely in your browser**. It uses Tesseract.js with a self-hosted English OCR model and PDF.js to read selectable PDF text directly; image-only PDF pages are rasterized and OCR'd locally. No images, extracted text, questions, or printed answer keys are uploaded to the server, and scanning does not need provider API keys.

**Two-column pages:** the browser detects a mostly empty vertical gutter in a low-resolution preview, recognizes the **left column from top to bottom**, then the **right column**. This prevents a typical two-column exam photo (questions 1–14 on the left, 15–30 on the right) from mixing adjacent questions. Side-by-side A/C and B/D answer choices inside a column are reordered by their printed letters, without shifting the answer key. Single-column pages continue to use normal OCR. Dense handwritten pages, overlapping columns, and unusual layouts may still need manual review.

**Performance:** the WebAssembly OCR worker and English language model are reused between scans in the same browser session, two-column crops use a simpler OCR page-segmentation mode, and large camera photos are resized to a maximum 2,400-pixel edge before recognition. Search for a 20 MB input limit as well as the existing 25-page and 10-page caps. OCR takes time on mobile devices, particularly the first time its model loads, and no specific speedup is guaranteed on every device.

The app accepts **20 MB of original files combined**, up to **25 images/PDF pages** in one scan, and at most **10 pages per PDF**. It recognizes numbered questions and A–H answer choices, and automatically matches explicit printed answer keys even when the key is in a later PDF page or a **separate uploaded image**. Identical key entries are safe; conflicting keys, duplicate question numbers, missing choices, and unkeyed answers require manual review. The local parser does **not** invent missing answers or choices.

For true offline operation, the OCR JavaScript worker, WebAssembly core variants, English language data, PDF parsing code, and PDF worker are **bundled locally** and precached by the PWA service worker. The user must open the site **once while online and allow its offline installation to finish**; scanning then works without connectivity. Browser storage clearing will require a new download of those assets. OCR accuracy depends on image quality and page layout. English is the packaged recognition language.

`npm install` copies OCR assets from dependencies into `public/ocr/` using the `postinstall` script, and `npm run build` repeats the copy and generates `dist/offline-manifest.json` to precache the Vite chunks. **Do not omit the install/build scripts on deployment**. The generated model and WASM files are intentionally not committed to Git. Use `npm test` to run parser and API regression tests.

The manual **AI validate & explain** action in My Library remains an optional **online** feature using Groq/Gemini; it is separate from the fully offline Quiz Studio scanner.

Keep provider keys on the server. **Never put API keys in frontend code or in variables prefixed with `VITE_`.** Redeploy after changing environment variables. Model availability and provider limits may change.

## Your data stays local

Imported quizzes, preferences, sessions, statistics, and prepared explanations are stored in your browser. They are not automatically synced between devices. Use the same browser and device to access your saved library, and avoid clearing the site's browser data unless you intend to remove local progress.

## Built with

React · Vite · JavaScript

---

<p align="center">
  <img src="assets/orion-hub-development.svg" alt="Orion Hub Development" width="360" />
  <br />
  <sub>Copyright © 2026 Orion Hub Development. All rights reserved.</sub>
</p>
