'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'team-talk-file.js'), 'utf8');

function loadFileApi(fetchMock) {
  const sandbox = {
    Buffer,
    URLSearchParams,
    process: { env: { SUPABASE_SECRET_KEY: 'test-only-secret' } },
    fetch: fetchMock,
    console: { warn() {}, error() {} },
    randomUUID: (() => {
      let index = 0;
      return () => `00000000-0000-4000-8000-${String(++index).padStart(12,'0')}`;
    })()
  };
  const executable = serverSource
    .replace(/^import \{ randomUUID \} from 'node:crypto';/m, '')
    .replace('export const config =', 'const config =')
    .replace('export default async function handler', 'async function handler');
  vm.runInNewContext(executable + '\nthis.api = { handler, safeObjectExtension, safeFileName };', sandbox);
  return sandbox.api;
}

function makeRequest(action, attributes = {}) {
  const body = JSON.stringify({ action, ...attributes });
  return {
    method: 'POST',
    headers: {
      'x-olli-session-token': 'test-session',
      'x-olli-academy-id': 'test-academy'
    },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
  };
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    data: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.data = value; return this; }
  };
}
function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value)
  };
}
function mockFetch(calls) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), ...options });
    if (String(url).includes('/rpc/olli_team_chat_members')) {
      return jsonResponse({ ok: true, current_member_id: 'teacher-id' });
    }
    if (String(url).includes('/object/upload/sign/')) {
      return jsonResponse({ url: '/object/upload/sign/team_talk_files/test-academy/safe?token=test' });
    }
    if (String(url).includes('/rpc/olli_team_chat_send_attachment')) {
      return jsonResponse({ ok:true, message: { attachment: { id: 7 } } });
    }
    throw new Error('Unexpected network request: ' + url);
  };
}

test('safe storage keys use UUID and allowed ASCII extension for Korean decomposed names', async () => {
  const calls = [];
  const { handler } = loadFileApi(mockFetch(calls));
  const originalName = '비비작_그림책_수업계획.pdf'.normalize('NFD');
  const response = makeResponse();
  await handler(makeRequest('prepare', {
    fileName: originalName, mimeType: 'application/pdf', fileSize: 1700000, kind: 'file'
  }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.data.fileName, originalName);
  assert.match(response.data.objectPath, /^test-academy\/00000000-0000-4000-8000-000000000001\.pdf$/);
  assert.doesNotMatch(response.data.objectPath, /[^a-z0-9/.-]/);
  assert.ok(calls.some(call => call.url.includes('/object/upload/sign/team_talk_files/test-academy/00000000-0000-4000-8000-000000000001.pdf')));
});

test('original Unicode filename is preserved in finalize DB metadata', async () => {
  const calls = [];
  const { handler } = loadFileApi(mockFetch(calls));
  const originalName = '비비작 그림책 (수정).pdf';
  const response = makeResponse();
  await handler(makeRequest('finalize', {
    objectPath: 'test-academy/00000000-0000-4000-8000-000000000001.pdf',
    fileName: originalName, mimeType: 'application/pdf', fileSize: 1700000, kind: 'file'
  }), response);
  assert.equal(response.statusCode, 200);
  const sent = calls.find(x => x.url.includes('/rpc/olli_team_chat_send_attachment'));
  assert.ok(sent);
  const body = JSON.parse(sent.body);
  assert.equal(body.p_file_name, originalName);
  assert.equal(body.p_storage_path, 'test-academy/00000000-0000-4000-8000-000000000001.pdf');
});

test('common office, image and video types have safe keys, unknown types fall back to bin', () => {
  const { safeObjectExtension } = loadFileApi(async () => { throw new Error('unexpected'); });
  const cases = [
    ['가을 행사 (최종).PDF','application/pdf','pdf'],
    ['학교-활동.pptx','application/octet-stream','pptx'],
    ['학원 출석.HWPX','','hwpx'],
    ['사진.HEIC','image/heic','heic'],
    ['영상.mp4','video/mp4','mp4'],
    ['문서 (한글).p😃df','application/pdf','pdf'],
    ['무확장자','application/octet-stream','bin'],
    ['가짜.html','text/html','bin'],
    ['스캔자료','image/png','png']
  ];
  for (const [name,mime,expected] of cases) assert.equal(safeObjectExtension(name,mime),expected,name);
});

test('original size and signed upload protections are kept', () => {
  assert.match(serverSource, /const MAX_FILE_BYTES = 20 \* 1024 \* 1024/);
  assert.match(serverSource, /await authorize\(sessionToken,academyId,key\)/);
  assert.match(serverSource, /'x-upsert':'false'/);
  assert.match(serverSource, /const objectPath=`\$\{academyId\}\/\$\{assetId\}\.\$\{safeObjectExtension\(fileName,mimeType\)\}`/);
  assert.doesNotMatch(serverSource, /assetId\}-\$\{fileName\}/);
});
