# REEQUIZ — Vercel-ready quiz website

A client-side study app inspired by the uploaded Custom Quiz Android app. It runs entirely in the browser; quiz files are not uploaded to a server.

## Deploy to Vercel
1. Extract this ZIP.
2. Import the folder/repository into Vercel, or drag the project into a Git repository and import it.
3. Vercel detects Vite automatically. Build command: `npm run build`; output directory: `dist`.
4. Click Deploy.

## Offline use (PWA)
REEQUIZ includes a service worker and web app manifest. Open the deployed site once while online, then use your browser's **Install app** option (or **Add to Home Screen** on supported mobile browsers). After the first successful load, the app shell and built assets are cached so you can reopen REEQUIZ offline. When a new version is deployed, open REEQUIZ while online once and reload it so the service worker can refresh its offline cache; then the updated version will be available offline. Imported quizzes, preferences, sessions, and statistics remain in that browser's local storage.

Important: offline use requires one initial online visit to cache the app. Use the same browser/device where you imported your quizzes. Clearing browser site data can remove saved quizzes and progress. Browser support for installing a PWA varies.

## Run locally
Install Node.js 18+ then:
```bash
npm install
npm run dev
```

## Supported .quiz files
The importer supports the ZIP-based `.quiz` format in the supplied `Engineering_Economics_Practice_Problems.quiz` sample. It reads `tempQuz.quz` entries in the `multipleChoiceV2<>question<>OR<>Ccorrect<>Wwrong...` format, including correct-answer markers and the answer choices. Other question formats or unusual encodings may be skipped or shown as unsupported. The app also supports `.json` quiz files with `{title, questions:[{question, options, answer, explanation}]}`.

## Features
- Import multiple `.quiz` files or JSON quiz sets
- Quiz library with search, question counts and remove controls
- Practice mode with answer feedback, explanations where available, score tracking and question navigation
- Shuffle questions and choices, review missed questions, timed sessions, keyboard shortcuts
- Progress saved locally in the browser
- Dedicated Settings tab with persistent light/dark themes, electric-gold styling, answer-choice shuffling on each quiz start/restart, and responsive layout; no account or backend required

Your files stay in your browser. Clearing site data clears the local library and progress.

- **Resume progress:** current quiz, selected answers, question position, and timer are saved locally so users can continue after exiting or reloading.
- **Combine quiz sets:** select one quiz to practice it alone or select multiple quizzes in the library to combine their questions into one shuffled session.
- **Multiple saved sessions:** users can choose which in-progress quiz to resume when several sessions have been started.
- **Delete-safe progress:** deleting a quiz removes its saved sessions too; combined sessions that depend on a deleted quiz are removed as well.
- **Quiz customization:** rename a quiz and set its card icon with an emoji.
- **Mobile polish:** single-column mobile quiz cards, separated edit/delete controls, stacked session actions, and better wrapping for small screens.


### Session modes and exit confirmation
- Choose Practice mode for self-paced learning or Timer mode to track elapsed time while completing a quiz.
- Exit session opens a styled confirmation dialog showing answered-question progress; choose Keep going or Exit & save progress.
- Both modes keep session progress saved locally so you can resume later.

- Timer Mode supports a user-configurable countdown duration (1–180 minutes), remembers the preferred duration on the device, and automatically ends the session when time runs out. Saved timed sessions resume with the remaining time preserved.

## Latest personalization and stats features

- Timer Mode lets you set a custom duration from 1 to 180 minutes using a number field, range slider, or quick presets. The chosen duration is saved as your browser preference and applied to new timed sessions.
- Optional per-question timer in Timer Mode: choose 5–120 seconds per question. When time expires before the correct answer is selected, REEQUIZ plays a short alert tone (when sounds are enabled), reveals the correct answer, marks the question as timed out if unanswered, and advances automatically. The next question starts with a fresh countdown. This preference is saved locally and works offline.
- The **My statistics** section records completed sessions locally, including accuracy, elapsed study time, quiz name, and recent results.
- A compact animated Light/Dark switch is available in the top bar on desktop and mobile; theme preference persists locally.
- Quiz profiles can be renamed, assigned an emoji icon, and given a JPEG/PNG cover image (up to 2 MB). Cover images fill the quiz card with a contrast overlay so titles remain readable.
- Delete confirmations and quiz profile editing use responsive in-app dialogs instead of browser prompt dialogs.

Statistics and profile images are stored in the current browser and are not synced between devices.


## Create and edit quizzes

REEQUIZ includes a local quiz editor. Open **Quiz studio** or choose **Create quiz** to add a quiz from scratch, edit question text, choices, correct answers, and explanations, then save it to your local library. Existing quizzes have a separate pencil action to edit their questions and answers.

### Build a quiz from copied or OCR text

1. Use your phone's text recognition / Live Text, Google Lens, or a PDF's text selection to copy the printed test into text. (REEQUIZ does not currently perform OCR directly from a photo.)
2. Open **Quiz studio → Paste test text**, paste the copied text, and choose **Detect questions**.
3. For best parsing, format questions as `1. Question text`, then one choice per line (`A)`, `B)`, `C)`, `D)`). The parser also recognizes answer indicators such as `Answer: B`, `*B) choice`, `(correct)`, and an answer-key line such as `Answer key: 1-B, 2-D`.
4. Review every detected question and select the correct answer. Questions without a detected answer key are explicitly marked **Answer needs review** and must be confirmed before saving or exporting.
5. Save the quiz to the local library, or export as `.quiz` for the Custom Quiz app / JSON for portability.

Text parsing happens in the browser and does not send the pasted test anywhere. The parser is rule-based; unusual layouts, multi-column scans, diagrams, and answers not supplied in the source may need manual cleanup. Generated `.quiz` exports use the `multipleChoiceV2` format supported by the current REEQUIZ importer; verify compatibility with your version of the Custom Quiz app before distributing important quiz banks.

## Interface polish

- Subtle button press feedback and page/card entrance transitions are included.
- The mobile layout uses a fixed three-item bottom navigation (Overview, My Library, Statistics), with Create your own / Quiz Studio and Settings accessible elsewhere in the app.
- Optional click tones are generated locally with the Web Audio API, so no sound files or internet connection are required. Toggle **Interface sounds** in Settings; the preference is saved locally. Browser audio may begin only after the first user interaction, as required by mobile browsers.
- Motion respects the device's reduced-motion preference.
- The service-worker cache was bumped so a connected visit can install the latest offline assets. To update an already-cached offline copy, open the deployed app online once and reload before disconnecting.


### Per-question timer pause/resume

During a timed quiz with the per-question timer enabled, click the countdown chip to pause it. Click it again to resume with the exact remaining time. Pausing the per-question countdown does not pause the overall quiz timer.


## AI quiz validation and offline explanations

AI quiz preparation is optional and controlled in Settings. When enabled, importing a quiz while online calls `/api/ai-prepare`, which reviews answer keys and prepares an explanation plus per-option feedback. Prepared data is stored with the quiz in the browser's local library, so those explanations remain available offline. Answer-key changes are recorded in the AI quiz tutor settings log. AI generation itself requires internet access.

### Vercel setup

1. In Vercel, open **Project → Settings → Environment Variables**.
2. Add `GROQ_API_KEY` with your secret key from https://console.groq.com/keys. Never add it to `VITE_*` variables or frontend source.
3. Optionally add `GROQ_MODEL` (defaults to `openai/gpt-oss-120b`; check https://console.groq.com/docs/models for currently available model IDs).
4. Redeploy. The `api/ai-prepare.js` serverless function calls Groq’s OpenAI-compatible Chat Completions API at `https://api.groq.com/openai/v1/chat/completions`. Groq model availability and free-tier limits can change.
5. Turn on **AI quiz tutor** in REEQUIZ Settings, then import a quiz while online.

Importing a .quiz or JSON file never triggers AI automatically. Enable AI quiz tutor in Settings, then press **AI validate & explain** on the quiz card in My Library whenever you want to generate explanations and review the answer key. Large quizzes are processed sequentially in small batches of 5 questions, with rate-limit failures retried as smaller batches. If preparation is incomplete, the quiz stays in your library and you can retry from its card later. AI may make mistakes; review logged answer-key changes, especially for specialist or ambiguous questions. Prepared explanations and corrections are saved locally for offline study.

## Gemini fallback for Groq rate limits

REEQUIZ can automatically fall back to Google Gemini when Groq responds with HTTP 429 (rate limit). Add these environment variables in Vercel → Project → Settings → Environment Variables:

- `GROQ_API_KEY` — primary provider (optional if using Gemini only)
- `GEMINI_API_KEY` — fallback provider key from https://aistudio.google.com/apikey
- `GEMINI_MODEL` — optional; defaults to `gemini-2.5-flash`

When Groq is rate-limited, the server tries Gemini for that same question. If Gemini succeeds, the result is saved normally and validation continues. If Gemini is unavailable or also rate-limited, the error is shown and the next button press resumes from the first question not marked `aiPrepared`. A successful response includes the provider name so REEQUIZ can show which provider handled validation. Keep both keys as server-side Vercel environment variables; never put them in frontend code or `VITE_*` variables. Redeploy after changing environment variables.
