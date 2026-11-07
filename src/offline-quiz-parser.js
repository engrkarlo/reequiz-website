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

/**
 * Exclude printed subject banners and page footers from parsed choices.
 * @param {string} line Printed OCR line.
 * @returns {boolean} Whether the text is an ignorable exam header.
 */
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

/**
 * Normalize OCR line endings and spacing while preserving option boundaries.
 * @param {string} text Extracted page text.
 * @returns {string[]} Nonempty normalized lines.
 */
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

/**
 * Parse OCR number/letter answer-key entries. Tolerant mode only permits
 * leftover OCR punctuation, never ordinary words or extra numbers; e.g.
 * "42. A ~~" is salvageable, but "42. A garbled word" is not evidence.
 * @param {string} line OCR text from a classified key-only page.
 * @param {boolean} strict Whether to reject all residual OCR artifacts.
 * @returns {{number:number,answer:string}[]} Verified-looking printed pairs.
 */
function keyPairsFromLine(line, strict = true) {
  const value = String(line || '').trim()
    .replace(/(\d)\s*[«¢·•]+\s*([A-H])(?=$|[\s.,;|/])/gi, '$1. $2');
  const matches = [...value.matchAll(KEY_PAIR)];
  if (!matches.length) return [];
  // Entire line must contain key pairs separated only by punctuation/whitespace.
  // This prevents question text ("1. A system...") from being mistaken for a key.
  const residue = value.replace(KEY_PAIR, '').replace(/[\s.,:;|/]+/g, '');
  if (strict && residue) return [];
  // Salvage OCR punctuation only. Residual letters/digits indicate a
  // question stem, a word, or a second corrupted pair; never confirm from it.
  if (!strict && (/[\p{L}\p{N}]/u.test(residue) || residue.length > matches.length * 4)) return [];
  return matches.map(match => ({ number: Number(match[1]), answer: match[2].toUpperCase() }));
}

/**
 * Recognize a numbered question stem, not an isolated key letter.
 * @param {string} line OCR text line.
 * @returns {{number:number,question:string}|null} Question start if present.
 */
function numberedQuestion(line) {
  const m = String(line || '').match(QUESTION) || String(line || '').match(QUESTION_WITHOUT_PUNCT);
  if (!m) return null;
  const number = Number(m[1]), question = m[2].trim();
  if (!Number.isInteger(number) || number < 1 || number > 9999 || !question || /^[A-H][. ]?$/i.test(question)) return null;
  return { number, question };
}

/**
 * Keep OCR columns together by stable source ID, not filenames. Two uploads
 * may share a filename while only one has been marked as an answer key.
 * @param {Array<object>} pages Ordered OCR sections.
 * @returns {Array<{sourcePage:string,sourceKey:string,sections:Array<object>}>}
 */
function sectionsBySource(pages) {
  const groups = [];
  for (const page of pages) {
    const sourcePage = String(page.sourcePage || page.name || 'uploaded page');
    const sourceKey = page.sourceId == null ? 'name:' + sourcePage : 'id:' + String(page.sourceId);
    const last = groups[groups.length - 1];
    if (last && last.sourceKey === sourceKey) last.sections.push(page);
    else groups.push({ sourcePage, sourceKey, sections: [page] });
  }
  return groups;
}

/**
 * Repair a key number only when neighboring entries prove the expected number
 * and OCR preserved the units digit; no answer letters are synthesized.
 * @param {Array<{number:number,answer:string}>} entries Ordered key entries.
 * @returns {Array<object>} Safe key-number corrections.
 */
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

/**
 * Identify a short printed answer-key heading even when OCR loses characters.
 * @param {string} line OCR text line.
 * @returns {boolean} Whether the line resembles a standalone key heading.
 */
function looksLikeKeyHeading(line) {
  const value = String(line || '').trim();
  if (KEY_TITLE.test(value)) return true;
  // Tesseract on a narrow answer-key list often reads "ANSWER KEY" as
  // "ANSWEI", "ANSWE", "ANSWFR KEY", etc. Only accept a short heading.
  return /^ANSW[A-Z]{0,6}(?:\s+K[A-Z]{1,3})?[:.\s-]*$/i.test(value) && value.length <= 22;
}

/**
 * Classify all columns of one source page together before parsing questions.
 * Accept only standalone printed key entries; random words cannot supply
 * answer letters or cause a noise-only page to appear readable.
 * @param {{sections:Array<object>}} group Adjacent sections of one source.
 * @returns {{sections:Array<object>,isKeyPage:boolean,pairs:Array<object>,unreadable:boolean}}
 */
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
    repairKeyNumberSequence(section.lines.flatMap(line => keyPairsFromLine(line.replace(KEY_TITLE, ''), false)))) : strictPairs;
  return { sections, isKeyPage, pairs, heading, knownKeyLayout,
    unreadable: isKeyPage && pairs.length === 0 };
}

/**
 * Split inline A/C or B/D choices without reassigning their printed letters.
 * @param {string} line OCR text line containing inline choice labels.
 * @returns {string[]} Separate choice chunks or the unmodified text.
 */
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

/**
 * Finalize the current question without guessing unreadable option labels.
 * @param {object|null} q Mutable question being assembled.
 * @param {Array<object>} output Parsed questions accumulator.
 * @returns {object|null} The finalized question so later stray options may
 *   be marked incomplete when they appear after a file boundary.
 */
function completeQuestion(q, output) {
  if (!q || !q.question || q.question.trim().length < 3) return null;
  const present = Object.keys(q.optionsByLetter).sort();
  const highest = Math.max(1, ...present.map(letter => ALPHABET.indexOf(letter)));
  // Empty placeholders preserve printed option positions. They are explicitly
  // marked incomplete and must be reviewed; NO answer is fabricated.
  const options = Array.from({ length: highest + 1 }, (_, i) => q.optionsByLetter[ALPHABET[i]] || '');
  const missingChoices = options.map((value, i) => value.trim() ? null : ALPHABET[i]).filter(Boolean);
  const entry = { number: q.number, question: q.question.trim(), options: options.map(text => text.trim()),
    incomplete: missingChoices.length > 0 || present.length < 2,
    missingChoices, explicitAnswer: q.explicitAnswer, source: q.source, sourceId: q.sourceId };
  output.push(entry);
  return entry;
}

/**
 * Confirm an answer only when its printed key is unique, in-range, and its
 * question has all recognized choices. Conflicts remain unconfirmed.
 * @param {Array<object>} questions Parsed questions.
 * @param {Array<{number:number,answer:string}>} answerKeys Printed keys.
 * @returns {Array<object>} Questions with reviewed/confirmed answer state.
 */
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

/**
 * Record missing/duplicate question numbers and answer-key match counts.
 * @param {Array<object>} questions Parsed questions.
 * @param {Array<{number:number,answer:string}>} answerKeys Parsed printed keys.
 * @returns {object} Diagnostics for human review.
 */
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

/**
 * Restore a damaged number only when adjacent questions, the printed key,
 * and the units digit all support the same correction. Never invent a stem.
 * @param {Array<object>} questions Mutable recognized questions.
 * @param {Array<{number:number,answer:string}>} answerKeys Printed keys.
 * @returns {void}
 */
function repairUnambiguousQuestionNumbers(questions, answerKeys) {
  const keyNums = new Set(answerKeys.map(key => Number(key.number)));
  const currentNumbers = new Set(questions.map(q => q.number));
  for (let i = 1; i < questions.length - 1; i++) {
    const prev = questions[i - 1], item = questions[i], next = questions[i + 1];
    const expected = prev.number + 1;
    const prevSource = prev.sourceId ?? prev.source;
    const itemSource = item.sourceId ?? item.source;
    const nextSource = next.sourceId ?? next.source;
    if (prevSource !== itemSource || itemSource !== nextSource ||
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

/**
 * Parse offline OCR sections in reading order and match printed answer keys.
 * Known key pages are never treated as question pages. Distinct uploaded
 * sources remain isolated even when they have identical filenames.
 * @param {Array<object>} pages OCR pages and per-column sections.
 * @returns {object} Parsed questions, keys, and review diagnostics.
 */
export function parseOfflineQuizPages(pages) {
  if (!Array.isArray(pages) || !pages.length) {
    return { questions: [], answerKeys: [], skipped: 0, needsReview: 0,
      missingQuestionNumbers: [], incompleteNumbers: [], duplicateNumbers: [], answerKeyCount: 0, matchedKeyCount: 0 };
  }
  const groups = sectionsBySource(pages), answerKeys = [], raw = [];
  const detectedKeyPages = [], unreadableKeyPages = [];
  let current = null;
  let previousColumn = null;
  let finalizedAtBoundary = null;

  for (const group of groups) {
    const assessment = inspectKeyGroup(group);
    if (assessment.isKeyPage) {
      detectedKeyPages.push(group.sourcePage);
      if (assessment.unreadable) unreadableKeyPages.push(group.sourcePage);
      completeQuestion(current, raw);
      current = null;
      finalizedAtBoundary = null;
      previousColumn = null;
      answerKeys.push(...assessment.pairs);
      continue;
    }
    // Finalizing prevents the next upload's OCR prose being appended to the
    // previous question. If the next page starts with C/D options, record them
    // as missing rather than silently considering A/B a complete question.
    finalizedAtBoundary = null;
    if (current && Object.keys(current.optionsByLetter).length >= 2) {
      finalizedAtBoundary = completeQuestion(current, raw);
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
        finalizedAtBoundary = null;
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
            } else if (finalizedAtBoundary) {
              // A new page began with choices but no question number; never
              // silently drop C/D and confirm an incomplete preceding question.
              const letter = (option[1] || option[2]).toUpperCase();
              const index = ALPHABET.indexOf(letter);
              if (index >= 0 && !finalizedAtBoundary.options[index]) {
                for (let slot = finalizedAtBoundary.options.length; slot <= index; slot++) {
                  finalizedAtBoundary.options[slot] = '';
                }
                finalizedAtBoundary.incomplete = true;
                for (let slot = 0; slot <= index; slot++) {
                  const missing = ALPHABET[slot];
                  if (!finalizedAtBoundary.options[slot] &&
                      !finalizedAtBoundary.missingChoices.includes(missing))
                    finalizedAtBoundary.missingChoices.push(missing);
                }
              }
            }
            continue;
          }
          const question = numberedQuestion(part);
          if (question) {
            completeQuestion(current, raw);
            finalizedAtBoundary = null;
            current = { ...question, optionsByLetter: Object.create(null),
              lastOption: null, inOption: false, explicitAnswer: null,
              source: String(section.page.name || ''), sourceId: section.page.sourceId };
            continue;
          }
          if (!current && finalizedAtBoundary && part.trim()) {
            // Unlabelled text at the next page's start may continue a wrapped
            // answer choice. We cannot safely assign it to a specific option;
            // require human review instead of confirming the previous answer.
            finalizedAtBoundary.incomplete = true;
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
