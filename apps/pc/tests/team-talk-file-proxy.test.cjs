'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'team-talk-file.js'), 'utf8');

function makeHandler(fetchMock) {
  return new Function('fetch', 'Buffer', 'URL',
    source.replace('export default async function handler', 'async function handler')
      + '\nreturn handler;')(fetchMock, Buffer, URL);
}
function res() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(json) { this.jsonValue = json; return this; },
    write(data) { this.chunks.push(Buffer.from(data)); },
    end(data) { if (data) this.chunks.push(Buffer.from(data)); return this; }
  };
}
function response(status, bytes, headers={}) {
  const data = Buffer.from(bytes);
  return {
    status,
    headers: { get(key) { return headers[key] || null; } },
    body: {
      getReader() {
        let read = false;
        return { read: async () => read ? { done:true } : (read = true, { done:false, value: data }) };
      }
    }
  };
}

test('PC forwards prepare/finalize JSON with academy-scoped session headers', async () => {
  const calls = [];
  const handler = makeHandler(async (url, options) => {
    calls.push({ url, options });
    return response(200, '{"ok":true}', { 'content-type':'application/json' });
  });
  const request = {
    method:'POST',
    headers:{ 'x-olli-session-token':'test-token', 'x-olli-academy-id':'test-academy' },
    body:{ action:'prepare', fileName:'한글 파일.pdf', fileSize:100, mimeType:'application/pdf' }
  };
  const output = res();
  await handler(request, output);
  assert.equal(calls[0].url, 'https://vivizac-feedback.vercel.app/api/team-talk-file');
  assert.equal(calls[0].options.headers['X-Olli-Session-Token'], 'test-token');
  assert.equal(calls[0].options.headers['X-Olli-Academy-Id'], 'test-academy');
  assert.equal(JSON.parse(calls[0].options.body).fileName, '한글 파일.pdf');
  assert.equal(Buffer.concat(output.chunks).toString(), '{"ok":true}');
  assert.equal(output.statusCode, 200);
});

test('PC downloads preserve original filename header and binary bytes', async () => {
  const payload = Buffer.from([0, 255, 128, 29, 17]);
  const header = `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent('수업계획.pdf')}`;
  const handler = makeHandler(async (url, options) => {
    assert.match(url, /\?attachmentId=44&variant=original$/);
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    return response(200, payload, {
      'content-disposition':header,
      'content-type':'application/pdf',
      'content-length':String(payload.length)
    });
  });
  const output = res();
  await handler({
    method:'GET',
    headers:{ 'x-olli-session-token':'test-token', 'x-olli-academy-id':'test-academy' },
    query:{ attachmentId:'44', variant:'original' }
  }, output);
  assert.equal(output.statusCode, 200);
  assert.equal(output.headers['content-disposition'], header);
  assert.deepEqual(Buffer.concat(output.chunks), payload);
});

test('PC propagates upstream authorization errors and blocks other methods', async () => {
  const handler = makeHandler(async () => response(400, '{"error":"권한이 없습니다."}', { 'content-type':'application/json' }));
  const denied = res();
  await handler({ method:'POST', headers:{}, body:{} }, denied);
  assert.equal(denied.statusCode, 400);
  assert.match(Buffer.concat(denied.chunks).toString(), /권한이 없습니다/);

  const forbidden = res();
  await handler({ method:'DELETE', headers:{} }, forbidden);
  assert.equal(forbidden.statusCode, 405);
});

test('PC reuses the existing mobile API without duplicating storage keys or secrets', () => {
  assert.match(source, /SHARED_FILE_SERVER_URL/);
  assert.match(source, /api\/team-talk-file/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);
});
