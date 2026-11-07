// Fully local, deterministic OCR/PDF question and answer-key parser.
// Keeps incomplete numbered questions for review instead of silently dropping them.
const KEY_TITLE = /^(?:answer\s*(?:key|sheet|list|guide)|correct\s+(?:answers\b|answer\s+key\b)|answers\s+key|solutions?\s*(?:key|list)?)\b[\s:.\-–]*/i;
const QUESTION = /^(?:question\s*|q\s*)?(\d{1,4})\s*[.)\]:\-]\s*(\S.*)$/i;
const QUESTION_WITHOUT_PUNCT = /^(?:question\s*|q\s*)?(\d{1,4})\s+([A-Za-z][\s\S]{9,})$/i;
const OPTION = /^(?:\(([A-H])\)|([A-H])[.):,;\]\-])\s*(\S.*)$/i;
const INLINE_ANSWER = /^(?:correct\s+answer|answer|ans\.?|key)\s*[:=\-–]\s*(?:option\s*)?\(?([A-H])\)?(?:\s|[.!]|$)/i;
const KEY_PAIR = /(?:^|[\s,;|/])(?:q(?:uestion)?\s*)?(\d{1,4})\s*[.):,\-]?\s*([A-H])(?=$|[\s,;|/])/gi;
const PAGE_FOOTER = /^(?:page\s*\d+\s*(?:of\s*\d+)?|p(?:age)?\.\s*\d+\s*(?:of\s*\d+)?|name\s*:|date\s*:|section\s*:|instructions\s*:|directions?\s*:)\s*$/i;
const ALPHABET = 'ABCDEFGH';

export function isExamHeader(line) {
  const text = String(line || '').trim();
  if (!text || PAGE_FOOTER.test(text)) return true;
  if (KEY_TITLE.test(text)) return false;
  // Large repeated uppercase subject headings (e.g. THERMODYNAMICS)
  // are not question/option continuations, on any page or column.
  if (/^[A-Z][A-Z\s&/()\-]{6,65}$/.test(text) && /[A-Z]/.test(text) &&
      text.replace(/[^A-Z]/g, '').length >= 8 &&
      text.split(/\s+/).length <= 6) return true;
  return false;
}

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

function keyPairsFromLine(line, strict = true) {
  const value = String(line || '').trim()
    .replace(/(\d)\s*[«¢·•]+\s*([A-H])(?=$|[\s.,;|/])/gi, '$1. $2');
  const matches = [...value.matchAll(KEY_PAIR)];
  if (!matches.length) return [];
  // Entire line must contain key pairs separated only by punctuation/whitespace.
  // This prevents question text ("1. A system...") from being mistaken for a key.
  if (strict && value.replace(KEY_PAIR, '').replace(/[\s.,:;|/]+/g, '')) return [];
  return matches.map(match => ({ number: Number(match[1]), answer: match[2].toUpperCase() }));
}

function numberedQuestion(line) {
  const m = String(line || '').match(QUESTION) || String(line || '').match(QUESTION_WITHOUT_PUNCT);
  if (!m) return null;
  const number = Number(m[1]), question = m[2].trim();
  if (!Number.isInteger(number) || number < 1 || number > 9999 || !question || /^[A-H][. ]?$/i.test(question)) return null;
  return { number, question };
}

function sectionsBySource(pages) {
  const groups = [];
  for (const page of pages) {
    const sourcePage = String(page.sourcePage || page.name || 'uploaded page');
    const last = groups[groups.length - 1];
    if (last && last.sourcePage === sourcePage) last.sections.push(page);
    else groups.push({ sourcePage, sections: [page] });
  }
  return groups;
}

// A wrong tens digit in a printed key can be recognized as another valid
// number (e.g. 88 becomes 58). Only repair when both adjacent printed keys
// agree on the exact missing number AND its units digit is preserved.
function repairKeyNumberSequence(entries) {
  const present = new Set(entries.map(entry => entry.number));
  const repaired = entries.map(entry => ({...entry}));
  for (let i=1; i<repaired.length-1; i++) {
    const prev=repaired[i-1], entry=repaired[i], next=repaired[i+1];
    const expected=prev.number+1;
    if (next.number!==expected+1 || entry.number===expected ||
        expected<10 || present.has(expected) ||
        entry.number%10!==expected%10 || entry.number>=expected) continue;
    present.delete(entry.number);
    entry.originalOcrNumber=entry.number;
    entry.number=expected;
    present.add(expected);
  }
  return repaired;
}

function looksLikeKeyHeading(line) {
  const value = String(line || '').trim();
  if (KEY_TITLE.test(value)) return true;
  // Tesseract on a narrow answer-key list often reads "ANSWER KEY" as
  // "ANSWEI", "ANSWE", "ANSWFR KEY", etc. Only accept a short heading.
  return /^ANSW[A-Z]{0,6}(?:\s+K[A-Z]{1,3})?[:.\s-]*$/i.test(value) && value.length <= 22;
}

function inspectKeyGroup(group) {
  const sections = group.sections.map(section => ({ page: section, lines: normalizedLines(section.text) }));
  const all = sections.flatMap(section => section.lines);
  const meaningful = all.filter(line => !isExamHeader(line) && !looksLikeKeyHeading(line));
  const knownKeyLayout = sections.some(section => section.page.keyLane === true || section.page.scanRole === 'answer-key');
  const heading = all.slice(0, 14).some(looksLikeKeyHeading);
  const strictPairs = sections.flatMap(section =>
    repairKeyNumberSequence(section.lines.flatMap(line => keyPairsFromLine(line))));
  const keyLikeLines = meaningful.filter(line =>
    keyPairsFromLine(line).length || /^(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):,\-]?\s*[A-H0O€¢]\s*$/i.test(line)).length;
  const fullQuestionLines = meaningful.filter(line =>
    numberedQuestion(line) && !keyPairsFromLine(line).length).length;
  const choiceLines = meaningful.filter(line => OPTION.test(line)).length;
  // Visual narrow-strip metadata is stronger than OCR text. Even a totally
  // unreadable key must never become a 31st exam question.
  const denseKey = (keyLikeLines >= 3 &&
    keyLikeLines / Math.max(meaningful.length, 1) >= 0.52 &&
    choiceLines <= 1 && fullQuestionLines <= 1) ||
    (strictPairs.length >= 2 && meaningful.length <= 2 &&
      choiceLines === 0 && fullQuestionLines === 0);
  // A legitimate quiz can include "Answer key: 1 B" *after* its questions.
  // That does not make the preceding questions an answer-key-only image.
  const headerKey = heading && fullQuestionLines === 0 && choiceLines === 0;
  const isKeyPage = knownKeyLayout || headerKey || denseKey;
  // Salvage number-letter pairs on noisy lines only AFTER classifying the
  // entire source as a key, never in question or option text.
  const pairs = isKeyPage ? sections.flatMap(section =>
    repairKeyNumberSequence(section.lines.flatMap(line => keyPairsFromLine(line, false)))) : strictPairs;
  return { sections, isKeyPage, pairs, heading, knownKeyLayout,
    unreadable: isKeyPage && pairs.length < 2 };
}

function splitInlineChoices(line) {
  const markers = [...line.matchAll(/(?:^|\s)(?:\([A-H]\)|[A-H][.):,;])\s+/g)];
  if (markers.length < 2) return [line];
  const positions = markers.map(match => match.index + (match[0][0] === ' ' ? 1 : 0));
  const chunks = [];
  if (positions[0] > 0) chunks.push(line.slice(0, positions[0]).trim());
  for (let i = 0; i < positions.length; i++) {
    chunks.push(line.slice(positions[i], positions[i + 1] ?? line.length).trim());
  }
  return chunks.filter(Boolean);
}

function completeQuestion(q, output) {
  if (!q || !q.question || q.question.trim().length < 3) return;
  const present = Object.keys(q.optionsByLetter).sort();
  const highest = Math.max(1, ...present.map(letter => ALPHABET.indexOf(letter)));
  // Empty placeholders preserve printed option positions. They are explicitly
  // marked incomplete and must be reviewed; NO answer is fabricated.
  const options = Array.from({ length: highest + 1 }, (_, i) => q.optionsByLetter[ALPHABET[i]] || '');
  const missingChoices = options.map((value, i) => value.trim() ? null : ALPHABET[i]).filter(Boolean);
  output.push({ number: q.number, question: q.question.trim(), options: options.map(text => text.trim()),
    incomplete: missingChoices.length > 0 || present.length < 2,
    missingChoices, explicitAnswer: q.explicitAnswer, source: q.source });
}

export function reconcileOfflineAnswerKeys(questions, answerKeys) {
  const keys = new Map();
  for (const entry of answerKeys) {
    const number = Number(entry.number);
    const answer = String(entry.answer || '').trim().toUpperCase();
    if (!Number.isInteger(number) || number < 1 || !ALPHABET.includes(answer) || answer.length !== 1) continue;
    if (!keys.has(number)) keys.set(number, answer);
    else if (keys.get(number) !== answer) keys.set(number, null);
  }
  const counts = new Map();
  for (const q of questions) counts.set(q.number, (counts.get(q.number) || 0) + 1);
  return questions.map(q => {
    const unique = counts.get(q.number) === 1;
    const keyed = unique ? keys.get(q.number) : null;
    const conflicts = keys.has(q.number) && (!unique || keys.get(q.number) === null ||
      (keyed && q.explicitAnswer && keyed !== q.explicitAnswer));
    const letter = conflicts ? null : (keyed || q.explicitAnswer);
    const index = letter ? ALPHABET.indexOf(letter) : -1;
    const accepted = !q.incomplete && !conflicts && index >= 0 && index < q.options.length &&
      Boolean(q.options[index]);
    return { number: q.number, question: q.question, options: q.options,
      answer: accepted ? index : null, answerProvided: accepted,
      incomplete: q.incomplete, missingChoices: q.missingChoices || [],
      explanation: '', source: q.source };
  });
}

function auditNumbers(questions, answerKeys) {
  const numbers = [...new Set(questions.map(q => q.number).filter(Number.isInteger))].sort((a,b) => a-b);
  const keyNumbers = [...new Set(answerKeys.map(k => Number(k.number)).filter(Number.isInteger))].sort((a,b) => a-b);
  const found = new Set(numbers);
  const missing = new Set();
  if (numbers.length >= 2) {
    // Look for every interior missing number. Do NOT fabricate text or answers.
    for (let number=numbers[0]; number<=numbers[numbers.length-1] && number<numbers[0]+500; number++) {
      if (!found.has(number)) missing.add(number);
    }
    if (keyNumbers.length >= 2) {
      const headGap = numbers[0] - keyNumbers[0];
      const tailGap = keyNumbers[keyNumbers.length-1] - numbers[numbers.length-1];
      if (headGap > 0 && headGap <= 3) for(let n=keyNumbers[0];n<numbers[0];n++) if(keyNumbers.includes(n)) missing.add(n);
      if (tailGap > 0 && tailGap <= 3) for(let n=numbers[numbers.length-1]+1;n<=keyNumbers[keyNumbers.length-1];n++) if(keyNumbers.includes(n)) missing.add(n);
    }
  }
  const counts = new Map();
  for (const q of questions) counts.set(q.number, (counts.get(q.number)||0)+1);
  return { foundNumbers: numbers,
    missingQuestionNumbers: [...missing].sort((a,b)=>a-b),
    duplicateNumbers: [...counts].filter(([,count]) => count>1).map(([number])=>number),
    incompleteNumbers: questions.filter(q => q.incomplete).map(q=>q.number),
    answerKeyCount: keyNumbers.length,
    matchedKeyCount: questions.filter(q=>q.answerProvided).length };
}

// A truncated tens digit is a common OCR error ("17." -> "7.").
// Recover only when both neighbors, the separate printed answer key, and
// the final numeral agree; never infer a missing question or its contents.
function repairUnambiguousQuestionNumbers(questions, answerKeys) {
  const keyNums = new Set(answerKeys.map(key => Number(key.number)));
  const currentNumbers = new Set(questions.map(q => q.number));
  for (let i = 1; i < questions.length - 1; i++) {
    const prev = questions[i - 1], item = questions[i], next = questions[i + 1];
    const expected = prev.number + 1;
    if (prev.source !== item.source || item.source !== next.source ||
        expected + 1 !== next.number ||
        expected < 10 || item.number === expected ||
        currentNumbers.has(expected) || !keyNums.has(expected) ||
        expected % 10 !== item.number % 10) continue;
    currentNumbers.delete(item.number);
    item.originalOcrNumber = item.number;
    item.number = expected;
    item.numberRecovered = true;
    currentNumbers.add(expected);
  }
}

export function parseOfflineQuizPages(pages) {
  if (!Array.isArray(pages) || !pages.length) {
    return { questions: [], answerKeys: [], skipped: 0, needsReview: 0,
      missingQuestionNumbers: [], incompleteNumbers: [], duplicateNumbers: [], answerKeyCount: 0, matchedKeyCount: 0 };
  }
  const groups = sectionsBySource(pages), answerKeys = [], raw = [];
  const detectedKeyPages = [], unreadableKeyPages = [];
  let current = null;
  let previousColumn = null;

  for (const group of groups) {
    const assessment = inspectKeyGroup(group);
    if (assessment.isKeyPage) {
      detectedKeyPages.push(group.sourcePage);
      if (assessment.unreadable) unreadableKeyPages.push(group.sourcePage);
      completeQuestion(current, raw);
      current = null;
      previousColumn = null;
      answerKeys.push(...assessment.pairs);
      continue;
    }
    // Do not let a completed question absorb OCR noise from a new file.
    // Incomplete, single-choice questions may continue on a following page.
    if (current && Object.keys(current.optionsByLetter).length >= 2) {
      completeQuestion(current, raw);
      current = null;
    }
    let inKeySection = false;
    for (const section of assessment.sections) {
      const column = section.page.column || null;
      // The next column is a new reading lane, not a continuation of the
      // previous column's final option. Distinct single-column pages may
      // still continue a question whose choices cross a page break.
      if (column && previousColumn && column !== previousColumn) {
        completeQuestion(current, raw);
        current = null;
      }
      previousColumn = column;
      for (const line of section.lines) {
        if (KEY_TITLE.test(line)) {
          inKeySection = true;
          const tail = line.replace(KEY_TITLE,'').trim();
          if (tail) answerKeys.push(...keyPairsFromLine(tail));
          continue;
        }
        if (isExamHeader(line)) continue;
        const pair = keyPairsFromLine(line);
        if (inKeySection) {
          answerKeys.push(...pair);
          continue;
        }
        for (const part of splitInlineChoices(line)) {
          if (isExamHeader(part)) continue;
          const inline = part.match(INLINE_ANSWER);
          if (inline) { if (current) current.explicitAnswer = inline[1].toUpperCase(); continue; }
          const option = part.match(OPTION);
          if (option) {
            if (current) {
              const letter = (option[1] || option[2]).toUpperCase();
              if (!Object.hasOwn(current.optionsByLetter, letter)) {
                current.optionsByLetter[letter] = option[3];
                current.lastOption = letter;
                current.inOption = true;
              }
            }
            continue;
          }
          const question = numberedQuestion(part);
          if (question) {
            completeQuestion(current, raw);
            current = { ...question, optionsByLetter: Object.create(null),
              lastOption: null, inOption: false, explicitAnswer: null,
              source: String(section.page.name || '') };
            continue;
          }
          if (current && part.trim()) {
            if (current.inOption && current.lastOption) current.optionsByLetter[current.lastOption] += ' ' + part;
            else current.question += ' ' + part;
          }
        }
      }
    }
  }
  completeQuestion(current, raw);
  repairUnambiguousQuestionNumbers(raw, answerKeys);
  const questions = reconcileOfflineAnswerKeys(raw, answerKeys);
  const audit = auditNumbers(questions, answerKeys);
  return { questions, answerKeys, skipped: 0, needsReview: questions.filter(q=>!q.answerProvided).length,
    detectedKeyPages, unreadableKeyPages, ...audit };
}
