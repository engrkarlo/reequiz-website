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

test('incomplete questions are skipped without inventing answer choices', () => {
  const result = parseOfflineQuizPages([{ name: 'questions', text: '1. Missing options?\n2. Good one?\nA. 1\nB. 2' }]);
  assert.equal(result.skipped, 1);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].answer, null);
});
