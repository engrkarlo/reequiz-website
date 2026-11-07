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


// Regression from the actual uploaded thermodynamics photo, with local
// Tesseract PSM 4's choice punctuation and truncated 17 -> 7.
test('Q16 recognizes A/C and B,/D, side-by-side choices and applies key 16.C', () => {
  const pages=[
    {name:'exam right',sourcePage:'exam.jpg',column:'right column',
      text:'15. When two bodies isolated from other environment are in thermal equilibrium?\nA. Zeroth Law\nB. Second Law\nC. First Law\nD. Third Law\n16. The second law of thermodynamics can be stated as:\nI heat flows spontaneously from hot object to a cold one\nII- natural processes tend toward greater entropy.\nA. Lonly C. Land I\nB, II only D, Neither I or IL\n7. What do you call a system where matter flows?\nA. Closed system C. Isolated system\nB. Open system D. All of these\n18. What system has no mass exchange?\nA. Open system C. Isolated system\nB, Closed system D, No flow system'},
    {name:'key left',sourcePage:'key.jpg',column:'left column',keyLane:true,
      text:'ANSWE\n15.A\n16.C\n17.B\n18. B'}
  ];
  const result=parseOfflineQuizPages(pages);
  const q16=result.questions.find(q=>q.number===16);
  assert.ok(q16);
  assert.deepEqual(q16.options,['Lonly','II only','Land I','Neither I or IL']);
  assert.equal(q16.incomplete,false);
  assert.equal(q16.answer,2);
  assert.equal(q16.answerProvided,true);
  assert.ok(result.questions.some(q=>q.number===17));
  assert.equal(result.missingQuestionNumbers.length,0);
  assert.equal(result.matchedKeyCount,4);
});

test('local OCR of the first 30 thermodynamics key entries confirms question 16', () => {
  // This mirrors the narrow-strip OCR output of the actual uploaded answer-key
  // image. The abbreviated "ANSWE" header must not block key recognition.
  const ocrKey=[
    'ANSWE','1.C','2.D','3. B','4.D','5.B','6. B','7.D','8.C','9.C',
    '10. B','11.B','12.A','13.D','14. B','15.A','16.C','17.B','18. B',
    '19.B','20. A','21.D','22. B','23. B','24. B','25. D','26. A',
    '27.B','28. C','29.B','30.A'
  ].join('\n');
  const questions=Array.from({length:30},(_,index)=>`${index+1}. Exam question?\nA. One\nB. Two\nC. Three\nD. Four`).join('\n');
  const parsed=parseOfflineQuizPages([
    {name:'page 1',sourcePage:'questions.jpg',text:questions},
    {name:'page 4 left',sourcePage:'answer.jpg',column:'left column',keyLane:true,text:ocrKey}
  ]);
  assert.equal(parsed.questions.length,30);
  assert.equal(parsed.answerKeyCount,30);
  assert.equal(parsed.matchedKeyCount,30);
  assert.equal(parsed.questions[15].answer,2);
});

test('no neighbor-only guess: truncated numbers require matching explicit printed key', () => {
  const raw='15. First?\nA. a\nB. b\n16. Second?\nA. a\nB. b\n7. Third?\nA. a\nB. b\n18. Fourth?\nA. a\nB. b';
  const parsed=parseOfflineQuizPages([{name:'page',text:raw}]);
  assert.ok(parsed.questions.some(q=>q.number===7));
  assert.ok(parsed.missingQuestionNumbers.includes(17));
});


test('key OCR "43«¢C" is read as an explicit printed C, not an AI guess', () => {
  const parsed=parseOfflineQuizPages([
    {name:'questions',text:'42. Which?\nA. one\nB. two\nC. three\n43. Another?\nA. one\nB. two\nC. three\n44. Next?\nA. one\nB. two\nC. three'},
    {name:'key',sourcePage:'key-image',keyLane:true,text:'42.A\n43«¢C\n44. B'}
  ]);
  assert.equal(parsed.answerKeyCount,3);
  assert.equal(parsed.matchedKeyCount,3);
  assert.equal(parsed.questions[1].answer,2);
});

test('key numbers with corroborated neighbors repair 58->88 without changing the printed answer letter', () => {
  const parsed=parseOfflineQuizPages([
    {name:'exam',text:'87. Which?\nA. one\nB. two\n88. Which?\nA. one\nB. two\n89. Which?\nA. one\nB. two'},
    {name:'key image',keyLane:true,text:'87.B\n58. A\n89. B'}
  ]);
  assert.equal(parsed.answerKeyCount,3);
  assert.equal(parsed.questions.find(q=>q.number===88).answer,0);
});

test('isolated OCR key number without supporting neighbors remains unverified', () => {
  const parsed=parseOfflineQuizPages([
    {name:'exam',text:'88. Which?\nA. yes\nB. no'},
    {name:'key',keyLane:true,text:'58. A\n90. B'}
  ]);
  assert.equal(parsed.questions[0].answerProvided,false);
});


test('unreadable OCR answer-key photo must never become question 31 or corrupt question 30', () => {
  const page = Array.from({length: 30}, (_,i) =>
    `${i+1}. Thermodynamics question ${i+1}?\nA. One\nB. Two\nC. Three\nD. Four`).join('\n');
  const scanned = parseOfflineQuizPages([
    {name:'exam left',sourcePage:'exam.jpg',text:page},
    {name:'key left',sourcePage:'answer.jpg',column:'left column',keyLane:true,
      text:'ANSWEI\n31. Weird number artifact\n1.€\n2.D\n3.B\n4.D\n5B\n6.B'},
    {name:'key right',sourcePage:'answer.jpg',column:'right column',keyLane:true,
      text:'52.A\n53.A\n54.D'}
  ]);
  assert.equal(scanned.questions.length, 30);
  assert.equal(scanned.questions.at(-1).number, 30);
  assert.ok(!scanned.questions.some(q=>q.number===31));
  assert.deepEqual(scanned.detectedKeyPages,['answer.jpg']);
  assert.ok(scanned.answerKeyCount >= 6);
  assert.equal(scanned.questions.find(q=>q.number===2).answer,3);
});

test('even a completely illegible visually detected key photo cannot be parsed as question', () => {
  const scanned=parseOfflineQuizPages([
    {name:'exam',text:'1. What is heat?\nA. Energy\nB. Matter'},
    {name:'key',sourcePage:'key.jpeg',column:'left column',keyLane:true,text:'31. Garbled text instead of key\nBroken answer words'},
    {name:'key',sourcePage:'key.jpeg',column:'right column',keyLane:true,text:'xx %% ?!'}
  ]);
  assert.equal(scanned.questions.length,1);
  assert.equal(scanned.answerKeyCount,0);
  assert.deepEqual(scanned.unreadableKeyPages,['key.jpeg']);
  assert.deepEqual(scanned.detectedKeyPages,['key.jpeg']);
});

test('manual answer-key file marking prevents bogus questions even when automatic OCR has no clues', () => {
  const scanned=parseOfflineQuizPages([
    {name:'exam',text:'1. A question?\nA. Yes\nB. No'},
    {name:'key',sourcePage:'photo.jpg',scanRole:'answer-key',
      text:'31. This is garbled\n42. Nonsense word\n43. unreadable letters'}
  ]);
  assert.equal(scanned.questions.length,1);
  assert.equal(scanned.answerKeyCount,0);
  assert.deepEqual(scanned.unreadableKeyPages,['photo.jpg']);
});

test('fuzzy ANSWEI heading plus three numbered key entries is a key even without visual metadata', () => {
  const scanned=parseOfflineQuizPages([
    {name:'exam',text:'1. What?\nA. One\nB. Two\nC. Three\n2. Why?\nA. One\nB. Two\nC. Three'},
    {name:'key photo',text:'ANSWEI\n31. Some OCR garbage\n1. C\n2. B\n3. A'}
  ]);
  assert.equal(scanned.questions.length,2);
  assert.ok(scanned.answerKeyCount>=3);
  assert.equal(scanned.questions.find(q=>q.number===1).answer,2);
  assert.equal(scanned.questions.find(q=>q.number===2).answer,1);
});

test('OCR reads question 17 as duplicate 27, verified adjacent numbers and key recover it safely', () => {
  const output=parseOfflineQuizPages([
    {name:'right',sourcePage:'exam.jpg',text:'16. Select entropy statements?\nA. I only C. I and II\nB, II only D, Neither\n27. What device encloses a boundary?\nA. Closed system C. Isolated system\nB. Open system D. All of these\n18. What mass flows?\nA. Open\nB. Closed\nC. Isolated\nD. None\n27. Which force?\nA. x\nB. y\nC. z\nD. w'},
    {name:'key',sourcePage:'key.jpg',scanRole:'answer-key',text:'16. C\n17. B\n18. B\n27. B'}
  ]);
  assert.ok(output.questions.some(q=>q.number===17));
  assert.equal(output.duplicateNumbers.includes(27),false);
  assert.equal(output.questions.find(q=>q.number===16).answer,2);
  assert.equal(output.questions.find(q=>q.number===17).answer,1);
});
