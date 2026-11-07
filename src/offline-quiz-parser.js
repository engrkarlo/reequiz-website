// Pure, deterministic parser for local OCR/PDF text. No requests or AI services.
const KEY_HEADING = /^(?:answer\s+(?:key|sheet|list|guide)|answers\b|correct\s+answers\b|correct\s+answer\s+key\b|solutions?\s*(?:key|list)?\b)\s*[:\-–]?\s*/i;
const QUESTION = /^(?:question\s*|q\s*)?(\d{1,4})\s*[.)\]:\-]\s*(\S.*)$/i;
const OPTION = /^\s*(?:\(([A-H])\)|([A-H])[.)\]:\-])\s*(\S.*)$/i;
const INLINE_ANSWER = /^(?:correct\s+answer|answer|ans\.?|key)\s*[:=\-–]\s*(?:option\s*)?\(?([A-H])\)?(?:\s|[.!]|$)/i;
const KEY_PAIR = /(?:q(?:uestion)?\s*)?(\d{1,4})\s*(?:[.):\-]|\s)\s*([A-H])\b/gi;
const NOISE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|name\s*:|date\s*:|section\s*:|instructions\s*:|direction\s*:)\s*$/i;

function normalizedLines(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

function pairLine(line) {
  const matches = [...line.matchAll(KEY_PAIR)];
  if (!matches.length) return [];
  // Reject a sentence that happens to start with a number + a letter.
  // The ENTIRE line must be a list of answer-key pairs.
  const remainder = line.replace(KEY_PAIR, '').replace(/[\s,;|/]+/g, '');
  if (remainder) return [];
  return matches.map(match => ({ number: Number(match[1]), answer: match[2].toUpperCase() }));
}

function keyLinesForPage(lines) {
  const excluded = new Set();
  const answers = [];
  let hasHeader = false;
  let meaningful = 0;
  let keyOnlyCount = 0;
  let inKeySection = false;
  const candidates = [];
  lines.forEach((line, index) => {
    let value = line;
    const heading = value.match(KEY_HEADING);
    if (heading && /^(?:answers?\b|answer\s*(?:key|sheet|list|guide)|correct\s+answers?|solutions?\s*(?:key|list)?)/i.test(value)) {
      hasHeader = true;
      inKeySection = true;
      value = value.slice(heading[0].length).trim();
      excluded.add(index);
    }
    if (!value) return;
    meaningful++;
    const pair = pairLine(value);
    if (pair.length) {
      candidates.push({ index, pairs: pair, afterHeader: inKeySection });
      keyOnlyCount += pair.length;
    }
  });
  // Unheaded answer-key images with 2+ pairs and no prose should work.
  // Never interpret an ordinary question-numbered page as a key.
  const likelyKeyOnly = !hasHeader && keyOnlyCount >= 2 &&
    candidates.length >= Math.max(1, meaningful - 1);
  for (const candidate of candidates) {
    if (candidate.afterHeader || likelyKeyOnly) {
      answers.push(...candidate.pairs);
      excluded.add(candidate.index);
    }
  }
  return { answers, excluded, likelyKeyOnly };
}

function splitInlineChoices(line) {
  // "1. What? A) one B) two C) three" is common after OCR line joining.
  const markers = [...line.matchAll(/(?:^|\s)(?:\([A-H]\)|[A-H][.)])\s+/g)];
  if (markers.length < 2) return [line];
  const positions = markers.map(match => match.index + (match[0].startsWith(' ') ? 1 : 0));
  const chunks = [];
  if (positions[0] > 0) chunks.push(line.slice(0, positions[0]).trim());
  for (let i = 0; i < positions.length; i++) {
    chunks.push(line.slice(positions[i], positions[i + 1] ?? line.length).trim());
  }
  return chunks.filter(Boolean);
}

function finalizeQuestion(current, target) {
  if (!current) return;
  const options = current.options.map(option => option.trim()).filter(Boolean);
  if (!current.question.trim()) return;
  target.push({ number: current.number, question: current.question.trim(), options,
    explicitAnswer: current.explicitAnswer, source: current.source });
}

function matchedAnswers(questions, answerKeys) {
  const keyMap = new Map();
  for (const entry of answerKeys) {
    const number = Number(entry.number);
    const answer = String(entry.answer || '').trim().toUpperCase();
    if (!Number.isInteger(number) || number < 1 || !/^[A-H]$/.test(answer)) continue;
    if (!keyMap.has(number)) keyMap.set(number, answer);
    else if (keyMap.get(number) !== answer) keyMap.set(number, null);
  }
  const counts = new Map();
  for (const q of questions) if (q.number !== null)
    counts.set(q.number, (counts.get(q.number) || 0) + 1);

  return questions.map(q => {
    const keyedLetter = q.number !== null && counts.get(q.number) === 1 ? keyMap.get(q.number) : null;
    const inlineLetter = q.explicitAnswer;
    const conflictingKeys = q.number !== null && counts.get(q.number) === 1 && keyMap.has(q.number) && keyMap.get(q.number) === null;
    const conflict = conflictingKeys || (keyedLetter && inlineLetter && keyedLetter !== inlineLetter);
    const letter = conflict ? null : (keyedLetter || inlineLetter);
    const index = letter ? letter.charCodeAt(0) - 65 : -1;
    return { number: q.number, question: q.question, options: q.options,
      answer: index >= 0 && index < q.options.length ? index : null,
      answerProvided: index >= 0 && index < q.options.length,
      explanation: '', source: q.source };
  });
}

export function parseOfflineQuizPages(pages) {
  if (!Array.isArray(pages) || !pages.length) return { questions: [], answerKeys: [], skipped: 0, needsReview: 0 };
  const answerKeys = [], rawQuestions = [];
  let current = null;
  let skipped = 0;
  for (const page of pages) {
    const lines = normalizedLines(page.text);
    const keys = keyLinesForPage(lines);
    answerKeys.push(...keys.answers);
    // Preserve a question from the previous page if its answer choices
    // continue on this one, but don't append a standalone answer-key page.
    if (keys.likelyKeyOnly && keys.excluded.size === lines.length) continue;
    for (let i = 0; i < lines.length; i++) {
      if (keys.excluded.has(i)) continue;
      for (const line of splitInlineChoices(lines[i])) {
        if (NOISE.test(line)) continue;
        const answerMatch = line.match(INLINE_ANSWER);
        if (answerMatch) {
          if (current) current.explicitAnswer = answerMatch[1].toUpperCase();
          continue;
        }
        const optionMatch = line.match(OPTION);
        if (optionMatch) {
          if (current) {
            const index = (optionMatch[1] || optionMatch[2]).toUpperCase().charCodeAt(0) - 65;
            if (index === current.options.length && index < 8) {
              current.options.push(optionMatch[3]);
              current.inOption = true;
            } else if (index < current.options.length) {
              // Ignore duplicate OCR labels rather than shifting answer choices.
              current.inOption = true;
            }
          }
          continue;
        }
        const questionMatch = line.match(QUESTION);
        if (questionMatch) {
          // "1. B" alone is ambiguous; don't manufacture a question.
          if (/^[A-H]$/i.test(questionMatch[2])) continue;
          finalizeQuestion(current, rawQuestions);
          current = { number: Number(questionMatch[1]), question: questionMatch[2], options: [],
            inOption: false, explicitAnswer: null, source: String(page.name || '') };
          continue;
        }
        if (current && line && !KEY_HEADING.test(line)) {
          if (current.inOption && current.options.length) {
            const index = current.options.length - 1;
            current.options[index] += ' ' + line;
          } else current.question += ' ' + line;
        }
      }
    }
  }
  finalizeQuestion(current, rawQuestions);
  const usable = [];
  for (const q of rawQuestions) {
    if (q.options.length < 2) { skipped++; continue; }
    usable.push(q);
  }
  const questions = matchedAnswers(usable, answerKeys);
  return { questions, answerKeys, skipped,
    needsReview: questions.filter(question => !question.answerProvided).length };
}

// Exported for focused tests and safe matching of separated keys.
export { matchedAnswers as reconcileOfflineAnswerKeys };
