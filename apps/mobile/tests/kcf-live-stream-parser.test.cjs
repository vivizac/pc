const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('api/chat.js', 'utf8');
const start = source.indexOf('function extractDeltaFromSsePayload(payload)');
const end = source.indexOf('async function streamOpenAiResponse', start);
const fn = source.slice(start, end);

test('KCF LIVE server forwards only response.output_text.delta events', () => {
  assert.ok(start >= 0 && end > start);
  assert.match(fn, /data\?\.type !== 'response\.output_text\.delta'/);
  assert.match(fn, /typeof data\.delta === 'string' \? data\.delta : ''/);
  assert.doesNotMatch(fn, /typeof data\.text === 'string'/);
  assert.doesNotMatch(fn, /Array\.isArray\(data\.content\)/);
});

test('KCF LIVE stream still writes each accepted delta immediately', () => {
  const streamStart = source.indexOf('async function streamOpenAiResponse');
  const streamEnd = source.indexOf('export default async function handler', streamStart);
  const streamFn = source.slice(streamStart, streamEnd);
  assert.match(streamFn, /const \{ value, done \} = await reader\.read\(\)/);
  assert.match(streamFn, /if \(delta\) res\.write\(delta\)/);
  assert.doesNotMatch(streamFn, /setTimeout|setInterval/);
});
