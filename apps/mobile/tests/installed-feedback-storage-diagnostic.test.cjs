'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'kinder-feedback.css'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'kinder-feedback.js'), 'utf8');

function section(start, end) {
  const i = runtime.indexOf(start);
  const j = runtime.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, 'Missing source boundary ' + start);
  return runtime.slice(i, j);
}

const helper = section(
  'function getKinderChatFeedbackStorageStatusLines() {',
  '\nif (navigator.standalone === true || window.matchMedia'
);

function makeReport(options = {}) {
  const storageData = new Map(Object.entries(options.storage || {}));
  let mutations = 0;
  const sandbox = {
    window: {
      getOlliFeedbackStorageChecks: () => options.events || [],
      matchMedia: () => ({ matches: !!options.installed })
    },
    navigator: { standalone: !!options.installed },
    kcfLiveFeedbackItems: new Map([['live', { resultText:'PRIVATE_STUDENT_FEEDBACK' }]]),
    getKinderChatFeedbackLiveSessionStorageKey: () => 'olli_kcf_live_session_v1_test-academy',
    getFeedbackJobQueueStorageKey: () => 'olli_feedback_jobs_v2_test-academy',
    localStorage: {
      getItem: key => options.blockRead ? (() => { throw Object.assign(new Error('blocked'), {name:'SecurityError'}); })() : storageData.get(key) ?? null,
      setItem: () => {mutations++;},
      removeItem: () => {mutations++;},
      clear: () => {mutations++;}
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(helper + '\nwindow.__status = getKinderChatFeedbackStorageStatusLines();', sandbox);
  return { lines:sandbox.window.__status, mutations };
}

test('installed QuickNote has a direct and accessible diagnostic entry', () => {
  assert.match(html, /class="kcfStorageDiagnosticBtn"[^>]*onclick="showOlliStorageDiagnostic\(\)"/);
  assert.match(css, /html\.olli-installed-web-app #kcfPersistentTopLayer\.show \.kcfStorageDiagnosticBtn\s*\{/);
  assert.match(runtime, /window\.showOlliStorageDiagnostic = showOlliStorageDiagnostic;/);
  assert.match(html, /kinder-feedback\.css\?v=20261014-installed-storage-check-1/);
  assert.match(html, /kinder-feedback\.js\?v=20261014-installed-storage-check-1/);
});

test('diagnosis distinguishes in-memory items from persisted LIVE and inbox counts, without private text', () => {
  const result = makeReport({
    installed:true,
    storage:{
      'olli_kcf_live_session_v1_test-academy': JSON.stringify({items:[
        { studentName:'PRIVATE_STUDENT_NAME', resultText:'PRIVATE_FEEDBACK_CONTENT' }
      ]}),
      'olli_feedback_jobs_v2_test-academy': JSON.stringify([
        {resultText:'PRIVATE_FEEDBACK_CONTENT'}, {resultText:'PRIVATE_FEEDBACK_CONTENT'}
      ])
    },
    events:[
      {kind:'live_session',operation:'save',result:'failed',reason:'quota_exceeded',phase:'write',at:'2026-10-14T00:00:00Z'},
      {kind:'inbox_queue',operation:'save',result:'ok',at:'2026-10-14T00:00:05Z'}
    ]
  });
  const report = result.lines.join('\n');
  assert.match(report, /환경: 홈 화면 설치 앱/);
  assert.match(report, /대화 메모리에 있는 LIVE 기록: 1건/);
  assert.match(report, /LIVE 실제 저장 기록: 1건/);
  assert.match(report, /보관함 실제 저장 기록: 2건/);
  assert.match(report, /LIVE 최근 저장 결과: 실패 \(quota_exceeded\)/);
  assert.match(report, /보관함 최근 저장 결과: 성공/);
  assert.doesNotMatch(report, /PRIVATE_/);
  assert.equal(result.mutations, 0);
});

test('diagnostic read errors or absent keys never clear local records', () => {
  const blocked = makeReport({ blockRead:true });
  assert.match(blocked.lines.join('\n'), /읽기 실패 \(SecurityError\)/);
  assert.equal(blocked.mutations, 0);
  const missing = makeReport();
  assert.match(missing.lines.join('\n'), /저장된 로컬 기록 없음/);
  assert.equal(missing.mutations, 0);
});

test('diagnostic opening does not call cleanup or save side effects', () => {
  const s = section('async function showOlliStorageDiagnostic() {', '\nif (new URLSearchParams(location.search)');
  assert.doesNotMatch(helper, /localStorage\.(?:setItem|removeItem|clear)\(/);
  assert.doesNotMatch(s, /\bpruneExpiredKinderChatFeedbackItems\s*\(/);
  assert.doesNotMatch(s, /\bpersistKinderChatFeedbackLiveSessionNow\s*\(/);
});
