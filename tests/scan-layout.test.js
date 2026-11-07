import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTwoColumnSplit, scanRegionsFromImageData, detectNarrowKeyLanes, initialOcrMode, retryOcrMode } from '../src/scan-layout.js';

// Pure pixel fixtures. Tests exercise layout, not Tesseract output or a network.
function fixture({ left = true, right = true, singleColumn = false, rightBands = 10, header = false } = {}) {
  const width = 360, height = 600, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const k = (y * width + x) * 4;
        data[k] = 30; data[k + 1] = 30; data[k + 2] = 30;
      }
    }
  };
  if (header) ink(120, 20, 250, 28);
  for (let n = 0; n < 23; n++) {
    const y = 85 + n * 20;
    if (singleColumn) ink(14, y, 344, y + 4);
    else {
      if (left) ink(14, y, 157, y + 4);
      if (right && n < rightBands * 2.3) ink(194, y, 347, y + 4);
    }
  }
  return { width, height, data };
}

test('two columns are detected from a continuous whitespace gutter', () => {
  const result = detectTwoColumnSplit(fixture({ header: true }));
  assert.ok(result);
  assert.ok(result.fraction > 0.46 && result.fraction < 0.54);
  assert.equal(scanRegionsFromImageData(fixture()).length, 2);
});

test('left column is scanned before right column', () => {
  const regions = scanRegionsFromImageData(fixture());
  assert.deepEqual(regions.map(region => region.label), ['left column', 'right column']);
  assert.equal(regions[0].left, 0);
  assert.equal(regions[1].right, 1);
  assert.equal(regions[0].right, regions[1].left);
});

test('single-column pages are not split', () => {
  assert.equal(detectTwoColumnSplit(fixture({ singleColumn: true })), null);
});

test('missing right-column text never triggers a split', () => {
  assert.equal(detectTwoColumnSplit(fixture({ right: false })), null);
});

test('a few side-by-side options do not turn a page into two columns', () => {
  assert.equal(detectTwoColumnSplit(fixture({ rightBands: 2 })), null);
});

test('reject small or invalid image data without throwing', () => {
  assert.equal(detectTwoColumnSplit({ width: 2, height: 2, data: new Uint8ClampedArray(16) }), null);
});


test('sparse answer-key columns near page margins are detected', () => {
  const width=360,height=640,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let i=0;i<48;i++){
    const y=92+i*10;
    for(const [x0,x1] of [[22,41],[185,208]]) {
      for(let yy=y;yy<y+3;yy++) for(let x=x0;x<x1;x++){
        const k=(yy*width+x)*4;
        data[k]=35; data[k+1]=35; data[k+2]=35;
      }
    }
  }
  const regions=scanRegionsFromImageData({width,height,data});
  assert.equal(regions.length,2);
  assert.equal(regions[0].label,'left column');
  assert.ok(regions[0].right>0.44 && regions[0].right<0.56);
});


test('narrow two-column answer key strips are cropped around the printed numbers and letters', () => {
  // Pixel positions model the actual uploaded key after 360px downscaling:
  // left key at x20–41, right at x185–203, broad blank areas elsewhere.
  const width=360,height=640,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=90;y<556;y+=10) {
    for(const [x0,x1] of [[20,42],[185,204]]) {
      for(let yy=y;yy<y+4;yy++)for(let x=x0;x<x1;x++){
        const k=(yy*width+x)*4;
        data[k]=30;data[k+1]=30;data[k+2]=30;
      }
    }
  }
  const lanes=detectNarrowKeyLanes({width,height,data});
  assert.equal(lanes.length,2);
  assert.ok(lanes.every(lane=>lane.keyLane));
  assert.ok(lanes[0].left<.05 && lanes[0].right<.18);
  assert.ok(lanes[1].left>.45 && lanes[1].right<.65);
  assert.ok(lanes.every(lane=>lane.right-lane.left<.14));
});

test('question columns with long printed sentences must not trigger answer-key strip mode', () => {
  assert.equal(detectNarrowKeyLanes(fixture()),null);
});

test('a single narrow numbered list is not misclassified as a two-column answer key', () => {
  const width=360,height=640,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=90;y<556;y+=10) for(let yy=y;yy<y+4;yy++)
    for(let x=20;x<43;x++) {
      const k=(yy*width+x)*4;
      data[k]=30;data[k+1]=30;data[k+2]=30;
    }
  assert.equal(detectNarrowKeyLanes({width,height,data}),null);
});


test('Tesseract uses PSM 6 for each broad two-column exam half, retaining question numbers', () => {
  const regions=scanRegionsFromImageData(fixture({header:true}));
  assert.equal(regions.length,2);
  assert.equal(initialOcrMode(regions), '6');
  assert.equal(retryOcrMode(regions), '4');
});

test('marked answer-key photos stay in key OCR mode even without narrow-key lane detection', () => {
  const regions=[{label:'left column',left:0,right:.5},{label:'right column',left:.5,right:1}];
  assert.equal(initialOcrMode(regions,true),'6');
  assert.equal(retryOcrMode(regions,true),null);
  assert.equal(initialOcrMode([{label:null,left:0,right:1}],true),'6');
});

test('single-column pages preserve automatic-layout OCR and limited recovery', () => {
  const regions=scanRegionsFromImageData(fixture({singleColumn:true}));
  assert.equal(regions.length,1);
  assert.equal(initialOcrMode(regions),'3');
  assert.equal(retryOcrMode(regions),'6');
});

test('narrow answer-key lanes always use block text PSM 6', () => {
  const regions=[{label:'left column',left:.02,right:.14,keyLane:true},{label:'right column',left:.5,right:.62,keyLane:true}];
  assert.equal(initialOcrMode(regions),'6');
  assert.equal(retryOcrMode(regions),null);
});
