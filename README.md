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

You’ll need Node.js 18 or newer.

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
- `GROQ_IMPORT_MODEL` — optional vision model for scanning (default: `qwen/qwen3.8-27b`).
- `GEMINI_IMPORT_MODEL` — optional Gemini vision model override (defaults to `GEMINI_MODEL`).
- `AI_PRIMARY_PROVIDER` — optional `groq` (default) or `gemini`. The other available provider is automatically tried if the primary fails.
- `AI_IMPORT_PROVIDER`, `AI_PREPARE_PROVIDER` — optional per-endpoint primary-provider overrides.

In **Quiz Studio**, image and PDF scanning accepts **20 MB combined** across the selected original files. The browser renders PDFs into page images and splits the scan into requests of at most three images and 2.5 MB each, avoiding Vercel's 4.5 MB request-body limit. Scans support up to 25 image/pages total, with at most 10 pages per PDF. A key printed on a separate page can be matched to a uniquely numbered question across batches; ambiguous or missing answers remain unconfirmed for manual review. Scanning requires an internet connection.

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
