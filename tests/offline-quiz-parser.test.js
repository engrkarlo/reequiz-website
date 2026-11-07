import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfflineQuizPages } from '../src/offline-quiz-parser.js';

const sample = [
  { name: 'first-photo.jpg', text: '1. Which number is even?\nA. 1\nB. 2\nC. 3\nD. 5\n2. Select the letter C.\nA. A\nB. B\nC. C\nD. D' },
  { name: 'answer-key-photo.png', text: 'Answer Key\n1. B\n2. C' }
];

test('answer keys in a different image match numbered questions without a network request', () => {
  const data = parseOfflineQuizPages(sample);
  assert.equal(data.questions.length, 2);
  assert.deepEqual(data.questions.map(q => q.answer), [1, 2]);
  assert.ok(data.questions.every(q => q.answerProvided));
  assert.equal(data.needsReview, 0);
});

test('answer keys on a separate PDF page match earlier pages', () => {
  const data = parseOfflineQuizPages([{ name: 'exam.pdf page 1', text: sample[0].text }, { name: 'exam.pdf page 2', text: sample[1].text }]);
  assert.deepEqual(data.questions.map(q => q.answer), [1, 2]);
});

test('unheaded page with only two or more key pairs is recognized', () => {
  const data = parseOfflineQuizPages([{ name: 'questions', text: sample[0].text }, { name: 'key', text: '1 B 2 C' }]);
  assert.deepEqual(data.questions.map(q => q.answer), [1, 2]);
});

test('explicit answers below individual questions stay local and are matched', () => {
  const data = parseOfflineQuizPages([{ name: 'page', text: '1. What?\nA. no\nB. yes\nAnswer: B\n2. Which?\nA. right\nB. wrong\nCorrect Answer: A' }]);
  assert.deepEqual(data.questions.map(q => q.answer), [1, 0]);
  assert.equal(data.needsReview, 0);
});

test('choices continuing on the next page attach to the same question', () => {
  const data = parseOfflineQuizPages([
    { name: 'first', text: '1. Which?\nA) false' },
    { name: 'second', text: 'B) true' },
    { name: 'keys', text: 'Answer Key:\n1. B' }
  ]);
  assert.equal(data.questions[0].options.length, 2);
  assert.equal(data.questions[0].answer, 1);
});

test('multiple inline choices on one OCR line are split', () => {
  const data = parseOfflineQuizPages([{ name: 'image', text: '1. How many? A) 1 B) 2 C) 3 D) 4\nAnswer key: 1 B' }]);
  assert.deepEqual(data.questions[0].options, ['1', '2', '3', '4']);
  assert.equal(data.questions[0].answer, 1);
});

test('no printed answer key never results in a guessed answer', () => {
  const data = parseOfflineQuizPages([{ name: 'page', text: '1. Unclear?\nA. maybe\nB. perhaps' }]);
  assert.equal(data.questions[0].answer, null);
  assert.equal(data.questions[0].answerProvided, false);
  assert.equal(data.needsReview, 1);
});

test('duplicate question numbers across uploaded files stay unconfirmed', () => {
  const data = parseOfflineQuizPages([
    { name: 'a', text: '1. First?\nA. x\nB. y' },
    { name: 'b', text: '1. Second?\nA. x\nB. y' },
    { name: 'key', text: 'Answer Key\n1. B' }
  ]);
  assert.deepEqual(data.questions.map(q => q.answer), [null, null]);
});

test('conflicting keys or conflicting inline and answer-page keys require review', () => {
  const result = parseOfflineQuizPages([
    { name: 'page', text: '1. First?\nA. x\nB. y\nAnswer: B' },
    { name: 'keys', text: 'Answer Key\n1. A\n1. B' }
  ]);
  assert.equal(result.questions[0].answer, null);
});

test('printed answer letters outside the number of choices are never accepted', () => {
  const result = parseOfflineQuizPages([
    { name: 'question', text: '1. Pick?\nA. this\nB. that' },
    { name: 'key', text: 'Answer Key\n1. D' }
  ]);
  assert.equal(result.questions[0].answer, null);
});

test('incomplete questions are retained with explicit missing-choice slots for human review', () => {
  const result = parseOfflineQuizPages([{ name: 'questions', text: '1. Missing options?\n2. Good one?\nA. 1\nB. 2' }]);
  assert.equal(result.skipped, 0);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].incomplete, true);
  assert.deepEqual(result.questions[0].options, ['', '']);
  assert.equal(result.questions[0].answer, null);
});


test('side-by-side A/C and B/D choices are reordered by label before key matching', () => {
  const parsed = parseOfflineQuizPages([
    { name: 'left column', text: '1. Which is correct?\nA. First C. Third\nB. Second D. Fourth' },
    { name: 'answer key', text: 'Answer Key\n1. C' }
  ]);
  assert.deepEqual(parsed.questions[0].options, ['First', 'Second', 'Third', 'Fourth']);
  assert.equal(parsed.questions[0].answer, 2);
  assert.equal(parsed.questions[0].answerProvided, true);
});

test('missing internal choice letter cannot silently shift answer or disappear', () => {
  const parsed = parseOfflineQuizPages([
    { name: 'page', text: '1. Which?\nA. One\nC. Three\nD. Four' },
    { name: 'key', text: 'Answer Key\n1. C' }
  ]);
  assert.equal(parsed.questions.length, 1);
  assert.deepEqual(parsed.questions[0].options, ['One', '', 'Three', 'Four']);
  assert.deepEqual(parsed.questions[0].missingChoices, ['B']);
  assert.equal(parsed.questions[0].answer, null);
  assert.equal(parsed.questions[0].answerProvided, false);
});


function fourPageExamFixture(missing = []) {
  const omit = new Set(missing);
  const questionText = (start, end) => Array.from({length:end-start+1}, (_,i) => start+i)
    .filter(number=>!omit.has(number))
    .map(number => `${number}. A sample thermodynamics question ${number}?\nA. Option one\nB. Option two\nC. Option three\nD. Option four`).join('\n');
  const keys = (start, end) => Array.from({length:end-start+1}, (_,i) => `${start+i}. C`).join('\n');
  const columns = [
    ['page 1', 1, 14, 15, 30],
    ['page 2', 31, 49, 50, 65],
    ['page 3', 66, 81, 82, 100]
  ].flatMap(([name,l1,l2,r1,r2]) => [
    {name: name+' left', sourcePage:name, column:'left column', text:'THERMODYNAMICS\n'+questionText(l1,l2)},
    {name: name+' right', sourcePage:name, column:'right column', text:'THERMODYNAMICS\n'+questionText(r1,r2)+`\nPage ${name.slice(-1)} of 4`}
  ]);
  columns.push(
    {name:'answer page left',sourcePage:'page 4',column:'left column',
      text:'THERMODYNAMICS\nANSWER KEY\n'+keys(1,51)},
    {name:'answer page right',sourcePage:'page 4',column:'right column',
      text:'THERMODYNAMICS\n'+keys(52,100)+'\nPage 4 of 4'}
  );
  return columns;
}

test('all 100 questions and all 100 entries from separate two-column answer-key photo match', () => {
  const parsed = parseOfflineQuizPages(fourPageExamFixture());
  assert.equal(parsed.questions.length, 100);
  assert.equal(parsed.answerKeyCount, 100);
  assert.equal(parsed.matchedKeyCount, 100);
  assert.equal(parsed.missingQuestionNumbers.length, 0);
  assert.equal(parsed.needsReview, 0);
  assert.ok(parsed.questions.every(q=>q.answer===2 && q.answerProvided));
});

test('repeated subject headings cannot be appended to an answer choice across columns', () => {
  const parsed = parseOfflineQuizPages([
    {name:'left',sourcePage:'page 1',column:'left column',text:'THERMODYNAMICS\n1. What?\nA. first\nB. second'},
    {name:'right',sourcePage:'page 1',column:'right column',text:'THERMODYNAMICS\n2. Next?\nA. okay\nB. fine'}
  ]);
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.questions[0].options[1], 'second');
  assert.equal(parsed.questions[1].question, 'Next?');
});

test('missing numbered questions in a 100-question exam are flagged, never guessed', () => {
  const parsed = parseOfflineQuizPages(fourPageExamFixture([1, 37, 80, 100]));
  assert.equal(parsed.questions.length, 96);
  assert.deepEqual(parsed.missingQuestionNumbers, [1, 37, 80, 100]);
  assert.equal(parsed.answerKeyCount, 100);
  assert.ok(!parsed.questions.some(q=>[1,37,80,100].includes(q.number)));
});

test('key-only right column without heading is still included even with a footer', () => {
  const keyLeft='THERMODYNAMICS\nANSWER KEY\n1. C\n2. D';
  const keyRight='THERMODYNAMICS\n52. A\n53. B\nPage 4 of 4';
  const parsed = parseOfflineQuizPages([
    {name:'questions',text:'1. What?\nA. one\nB. two\nC. three\nD. four\n52. Which?\nA. one\nB. two'},
    {name:'keys left',sourcePage:'key-photo',column:'left column',text:keyLeft},
    {name:'keys right',sourcePage:'key-photo',column:'right column',text:keyRight}
  ]);
  assert.equal(parsed.answerKeyCount, 4);
  assert.equal(parsed.questions[0].answer, 2);
  assert.equal(parsed.questions[1].answer, 0);
});

test('Correct Answer per-question marker remains separate from Answer Key heading', () => {
  const parsed = parseOfflineQuizPages([{name:'exam',text:'1. Question?\nA. no\nB. yes\nCorrect Answer: B'}]);
  assert.equal(parsed.questions[0].answer,1);
});
