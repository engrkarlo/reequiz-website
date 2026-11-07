import test from 'node:test';
import assert from 'node:assert/strict';
import importHandler from '../api/ai-import.js';
import prepareHandler from '../api/ai-prepare.js';

const page = { name: 'page.png', mimeType: 'image/png', data: 'YWJj' };
const exampleScan = {
  questions: [{ number: 1, question: 'Choose?', options: ['A', 'B'], answer: null, answerProvided: false, explanation: '' }],
  answerKey: [{ number: 1, answer: 'B' }]
};
const exampleReview = {
  questions: [{ correctAnswer: 1, correctionReason: '', explanation: 'Because B', optionExplanations: ['No', 'Yes'] }]
};
const groqScan = { output_text: JSON.stringify(exampleScan) };
const geminiScan = { candidates: [{ content: { parts: [{ text: JSON.stringify(exampleScan) }] } }] };
const groqReview = { choices: [{ message: { content: JSON.stringify(exampleReview) } }] };
const geminiReview = { candidates: [{ content: { parts: [{ text: JSON.stringify(exampleReview) }] } }] };
const body = { title: 'Test', questions: [{ question: 'Choose?', options: ['A', 'B'], answer: 0 }] };
const envNames = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'AI_PRIMARY_PROVIDER', 'AI_IMPORT_PROVIDER', 'AI_PREPARE_PROVIDER'];

async function invoke(handler, request, responses, env = { GROQ_API_KEY: 'groq-test', GEMINI_API_KEY: 'gemini-test' }) {
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]));
  const calls = [];
  for (const key of envNames) delete process.env[key];
  Object.assign(process.env, env);
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const next = responses.shift();
    assert.ok(next, 'Unexpected provider call');
    if (next.error) throw new Error(next.error);
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.payload };
  };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
  try {
    await handler({ method: 'POST', body: request }, res);
    return { status: res.statusCode, data: res.body, calls };
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envNames) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}

test('import falls back from a Groq rate limit to Gemini', async () => {
  const r = await invoke(importHandler, { files: [page] }, [
    { status: 429, payload: { error: { message: 'quota' } } },
    { status: 200, payload: geminiScan }
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.data.provider, 'Gemini');
  assert.deepEqual(r.data.answerKey, [{ number: 1, answer: 'B' }]);
  assert.equal(r.calls.length, 2);
});

test('import falls back from Gemini to Groq', async () => {
  const r = await invoke(importHandler, { files: [page] }, [
    { status: 503, payload: { error: { message: 'unavailable' } } },
    { status: 200, payload: groqScan }
  ], { GROQ_API_KEY: 'groq-test', GEMINI_API_KEY: 'gemini-test', AI_IMPORT_PROVIDER: 'gemini' });
  assert.equal(r.status, 200);
  assert.equal(r.data.provider, 'Groq');
});

test('import falls back on invalid provider JSON', async () => {
  const r = await invoke(importHandler, { files: [page] }, [
    { status: 200, payload: { output_text: 'not json' } },
    { status: 200, payload: geminiScan }
  ]);
  assert.equal(r.data.provider, 'Gemini');
});

test('key-only scanned pages succeed with no questions', async () => {
  const r = await invoke(importHandler, { files: [page] }, [
    { status: 200, payload: { output_text: JSON.stringify({ questions: [], answerKey: [{ number: 8, answer: 'C' }] }) } }
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.data.questions.length, 0);
  assert.equal(r.data.answerKey[0].number, 8);
});

test('more than three images in a request is rejected', async () => {
  const r = await invoke(importHandler, { files: [page, page, page, page] }, []);
  assert.equal(r.status, 413);
  assert.equal(r.calls.length, 0);
});

test('both rate-limited providers return 429', async () => {
  const r = await invoke(importHandler, { files: [page] }, [
    { status: 429, payload: { error: { message: 'Groq limit' } } },
    { status: 429, payload: { error: { message: 'Gemini limit' } } }
  ]);
  assert.equal(r.status, 429);
  assert.equal(r.data.retryable, true);
});

test('answer validation falls back from Groq failure to Gemini', async () => {
  const r = await invoke(prepareHandler, body, [
    { status: 500, payload: { error: { message: 'outage' } } },
    { status: 200, payload: geminiReview }
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.data.provider, 'Gemini');
  assert.equal(r.data.questions[0].correctAnswer, 1);
});

test('answer validation falls back from Gemini to Groq', async () => {
  const r = await invoke(prepareHandler, body, [
    { status: 429, payload: { error: { message: 'rate limited' } } },
    { status: 200, payload: groqReview }
  ], { GROQ_API_KEY: 'groq-test', GEMINI_API_KEY: 'gemini-test', AI_PREPARE_PROVIDER: 'gemini' });
  assert.equal(r.status, 200);
  assert.equal(r.data.provider, 'Groq');
});

test('answer validation falls back for incomplete AI results', async () => {
  const r = await invoke(prepareHandler, body, [
    { status: 200, payload: { choices: [{ message: { content: '{"questions":[]}' } }] } },
    { status: 200, payload: geminiReview }
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.data.provider, 'Gemini');
});

test('missing API keys cause a useful service unavailable response', async () => {
  const r = await invoke(importHandler, { files: [page] }, [], {});
  assert.equal(r.status, 503);
});
