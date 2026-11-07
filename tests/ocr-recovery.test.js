import test from 'node:test';
import assert from 'node:assert/strict';
import { retryColumnsForOCR, ocrResultScore } from '../src/ocr-recovery.js';

const region = (name, text) => ({ name, sourcePage:'exam.png', column:name, text });

test('skip unnecessary duplicate OCR passes for complete numbered columns', () => {
  const pages=[
    region('left', '1. First?\nA. a\nB. b\n2. Second?\nA. a\nB. b'),
    region('right','3. Third?\nA. a\nB. b\n4. Fourth?\nA. a\nB. b')
  ];
  assert.deepEqual(retryColumnsForOCR(pages), []);
});

test('rescan only the column containing the missing internal question number', () => {
  const pages=[
    region('left','1. First?\nA. a\nB. b\n3. Third?\nA. a\nB. b'),
    region('right','4. Fourth?\nA. a\nB. b\n5. Fifth?\nA. a\nB. b')
  ];
  assert.deepEqual(retryColumnsForOCR(pages),[0]);
});

test('rescan the following column for a missing boundary question', () => {
  const pages=[
    region('left','1. First?\nA. a\nB. b\n2. Second?\nA. a\nB. b'),
    region('right','4. Fourth?\nA. a\nB. b\n5. Fifth?\nA. a\nB. b')
  ];
  assert.deepEqual(retryColumnsForOCR(pages),[1]);
});

test('rescan incomplete choice OCR, preserving the original if retry score is worse', () => {
  const low=[region('left','1. What?\nA. first\nC. third'),region('right','2. Which?\nA. x\nB. y')];
  assert.deepEqual(retryColumnsForOCR(low),[0]);
  const high=[region('left','1. What?\nA. first\nB. second\nC. third'),low[1]];
  assert.ok(ocrResultScore(high)>ocrResultScore(low));
});

test('detect an absent key entry inside a dense key column', () => {
  const pages=[
    {name:'left',sourcePage:'answer.png',column:'left column',text:'ANSWER KEY\n1. A\n2. B\n4. D\n5. A'},
    {name:'right',sourcePage:'answer.png',column:'right column',text:'6. A\n7. B\n8. C\n9. D'}
  ];
  assert.deepEqual(retryColumnsForOCR(pages),[0]);
  const fixed=[{...pages[0],text:'ANSWER KEY\n1. A\n2. B\n3. C\n4. D\n5. A'},pages[1]];
  assert.ok(ocrResultScore(fixed)>ocrResultScore(pages));
});
