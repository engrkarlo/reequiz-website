import { parseOfflineQuizPages } from './offline-quiz-parser.js';

// Pure diagnostics used to decide which columns deserve a second OCR pass.
// Re-running every column makes mobile scanning unacceptably slow.
export function retryColumnsForOCR(sections) {
  if (!Array.isArray(sections) || !sections.length) return [];
  const selected = new Set();
  const sectionsParsed = sections.map(section => parseOfflineQuizPages([section]));
  const whole = parseOfflineQuizPages(sections);
  const missing = whole.missingQuestionNumbers || [];

  for (let i = 0; i < sections.length; i++) {
    const parsed = sectionsParsed[i];
    const numbers = parsed.foundNumbers || [];
    if ((parsed.incompleteNumbers || []).length || (parsed.missingQuestionNumbers || []).length) selected.add(i);
    if (!numbers.length && !parsed.answerKeys.length && String(sections[i].text || '').length >= 90) selected.add(i);
    const keys = [...new Set(parsed.answerKeys.map(k => Number(k.number)))].sort((a, b) => a-b);
    // Missing one or two entries inside an otherwise dense printed key list.
    if (keys.length >= 4 && keys[keys.length - 1] - keys[0] - keys.length + 1 > 0 &&
        keys[keys.length - 1] - keys[0] - keys.length + 1 <= 6) selected.add(i);
  }

  for (const number of missing) {
    let matched = false;
    for (let i=0;i<sectionsParsed.length;i++) {
      const numbers = sectionsParsed[i].foundNumbers || [];
      if (numbers.length >= 2 && number > numbers[0] && number < numbers[numbers.length - 1]) {
        selected.add(i); matched = true;
      }
    }
    if (!matched && sectionsParsed.length > 1) {
      // At the boundary of two columns, a missing question is most likely
      // the first question of the following column.
      const next = sectionsParsed.findIndex(p => (p.foundNumbers || [])[0] === number + 1);
      if (next >= 0) selected.add(next);
    }
  }
  return [...selected].sort((a,b) => a-b);
}

export function ocrResultScore(sections) {
  const parsed = parseOfflineQuizPages(sections);
  const uniqueNumbers = new Set(parsed.questions.map(q=>q.number));
  const keyNumbers = new Set(parsed.answerKeys.map(k=>k.number));
  return uniqueNumbers.size * 30 + keyNumbers.size * 4
    - parsed.missingQuestionNumbers.length * 24
    - parsed.incompleteNumbers.length * 14
    - parsed.duplicateNumbers.length * 24;
}


// After the answer-key photo has been read, previously unknown first/last
// question gaps can become visible. Retry at most the nearest untried image
// columns, never manufacture missing question text from answer-key letters.
export function lateRetryColumnIndices(sections, missingNumbers, limit = 4) {
  if (!Array.isArray(sections) || !Array.isArray(missingNumbers) || !missingNumbers.length) return [];
  const candidates = sections.map((section, index) => ({
    index, section, numbers: parseOfflineQuizPages([section]).foundNumbers || []
  })).filter(item=>item.section.type === 'ocr' && !item.section.retryAttempted && item.numbers.length);
  const selected = new Set();
  for (const missing of missingNumbers) {
    let best = null;
    for (const item of candidates) {
      const first = item.numbers[0], last = item.numbers[item.numbers.length-1];
      let distance;
      if (missing >= first && missing <= last) distance = 0;
      else if (missing === first-1 || missing === last+1) distance = 1;
      else distance = Math.min(Math.abs(missing-first), Math.abs(missing-last));
      if (distance > 2) continue;
      if (!best || distance < best.distance) best = {index:item.index,distance};
    }
    if (best) selected.add(best.index);
    if (selected.size >= limit) break;
  }
  return [...selected].sort((a,b)=>a-b);
}
