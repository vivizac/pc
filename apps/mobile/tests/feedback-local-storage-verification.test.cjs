'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const common = fs.readFileSync(path.join(__dirname, '../../../packages/common/olli-feedback-runtime.js'), 'utf8');
const live = fs.readFileSync(path.join(__dirname, '../kinder-feedback.js'), 'utf8');

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'Expected source section: ' + start);
  return text.slice(from, to);
}

const recorderSource = between(common, 'const OLLI_FEEDBACK_STORAGE_CHECKS_KEY', '/* ── 내부 피드백 작업 보관함');
const queueKeySource = between(common, "const FEEDBACK_JOB_QUEUE_KEY", "try { localStorage.removeItem('olli_today_feedback_queue_v1')");
const queueSource = between(common, 'function getTodayFeedbackItemsRaw()', 'function getTodayFeedbackItems()');
const liveSource = between(live, 'function persistKinderChatFeedbackLiveSessionNow(){', 'function scheduleKinderChatFeedbackLiveSessionPersist(){');

function storage(options = {}) {
  const data = new Map();
  return {
    data,
    getItem(key) {
      if (options.blockRead) {
        const error = new Error('access blocked');
        error.name = 'SecurityError';
        throw error;
      }
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (options.quota) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      if (!options.ignoreWrites) data.set(key, String(value));
    },
    removeItem(key) { data.delete(key); }
  };
}

function context(options = {}) {
  const localStorage = storage(options);
  const sessionStorage = storage(options.sessionStorageOptions);
  const window = {};
  const sandbox = {
    localStorage, sessionStorage, window,
    console: { warn() {} },
    getOlliCurrentAcademyId: () => options.throwAcademy ? (() => { throw new Error('academy unavailable'); })() : (options.academyId || 'academy-test')
  };
  vm.createContext(sandbox);
  vm.runInContext(recorderSource + queueKeySource + queueSource +
    'window.__queue = { save:setTodayFeedbackItemsRaw, load:getTodayFeedbackItemsRaw };', sandbox);
  sandbox.checks = () => window.getOlliFeedbackStorageChecks();
  return sandbox;
}

function liveContext(options = {}) {
  const c = context(options);
  c.window.__liveItems = new Map(options.empty ? [] : [['record1', {
    id:'record1', academyId:'academy-test', createdAt:'2026-10-13T00:00:00Z',
    resultText:'STUDENT_PRIVATE_FEEDBACK_TEXT'
  }]]);
  c.getKinderChatFeedbackLiveAcademyId = () => options.unscoped ? 'unscoped' : 'academy-test';
  c.getKinderChatFeedbackLiveDateKey = () => '2026-10-13';
  c.getKinderChatFeedbackLiveSessionExpiryAt = () => Date.now() + 86400000;
  c.serializeKinderChatFeedbackLiveItem = item => item;
  vm.runInContext(`
    let kcfLiveSessionPersistTimer = null;
    const kcfLiveFeedbackItems = window.__liveItems;
    const KCF_LIVE_SESSION_KEY_PREFIX = 'olli_kcf_live_session_v1';
    const KCF_LIVE_SESSION_MAX_ITEMS = 50;
    const KCF_LIVE_SESSION_VERSION = 1;
  ` + liveSource + 'window.__liveSave = persistKinderChatFeedbackLiveSessionNow;', c);
  return { ...c, save: () => c.window.__liveSave() };
}

test('feedback inbox queue roundtrips and records verified success without content', () => {
  const c = context();
  c.window.__queue.save([{ id:'one', resultText:'STUDENT_PRIVATE_FEEDBACK_TEXT' }]);
  assert.equal(c.window.__queue.load().length, 1);
  assert.ok(c.checks().some(event => event.kind === 'inbox_queue' && event.operation === 'save' && event.result === 'ok'));
  assert.doesNotMatch(JSON.stringify(c.checks()), /STUDENT_PRIVATE_FEEDBACK_TEXT/);
});

test('quota error is preserved and logged with write phase', () => {
  const c = context({ quota:true });
  assert.throws(() => c.window.__queue.save([{id:'one'}]), { name:'QuotaExceededError' });
  assert.ok(c.checks().some(event => event.phase === 'write' && event.reason === 'quota_exceeded'));
});

test('silently dropped queue writes are detected by read-back', () => {
  const c = context({ ignoreWrites:true });
  assert.throws(() => c.window.__queue.save([{id:'one'}]), { name:'FeedbackStorageReadbackMismatch' });
  assert.ok(c.checks().some(event => event.phase === 'verify' && event.reason === 'readback_mismatch'));
});

test('missing queue and blocked reads are distinguishable', () => {
  const missing = context();
  assert.equal(missing.window.__queue.load().length, 0);
  assert.ok(missing.checks().some(event => event.operation === 'read' && event.result === 'missing'));
  const blocked = context({ blockRead:true });
  assert.equal(blocked.window.__queue.load().length, 0);
  assert.ok(blocked.checks().some(event => event.operation === 'read' && event.reason === 'storage_access_blocked'));
});

test('queue key-resolution failure is logged and preserves existing read fallback', () => {
  const c = context({ throwAcademy:true });
  assert.deepEqual(Array.from(c.window.__queue.load()), []);
  assert.ok(c.checks().some(event => event.operation === 'read' && event.result === 'failed' && event.scope === 'unknown'));
});

test('LIVE save verifies local storage and logs content-free success', () => {
  const c = liveContext();
  c.save();
  assert.ok(c.localStorage.data.has('olli_kcf_live_session_v1_academy-test'));
  assert.ok(c.checks().some(event => event.kind === 'live_session' && event.operation === 'save' && event.result === 'ok'));
  assert.doesNotMatch(JSON.stringify(c.checks()), /STUDENT_PRIVATE_FEEDBACK_TEXT/);
});

test('LIVE quota failures and read-back mismatches are recorded without interrupting UI', () => {
  const quota = liveContext({ quota:true });
  assert.doesNotThrow(() => quota.save());
  assert.ok(quota.checks().some(event => event.kind === 'live_session' && event.phase === 'write' && event.reason === 'quota_exceeded'));
  const missing = liveContext({ ignoreWrites:true });
  assert.doesNotThrow(() => missing.save());
  assert.ok(missing.checks().some(event => event.kind === 'live_session' && event.phase === 'verify' && event.reason === 'readback_mismatch'));
});

test('LIVE save without academy scope is reported as skipped and writes nothing', () => {
  const c = liveContext({ unscoped:true });
  c.save();
  assert.equal(c.localStorage.data.size, 0);
  assert.ok(c.checks().some(event => event.kind === 'live_session' && event.result === 'skipped' && event.reason === 'academy_not_ready'));
});

test('LIVE empty-record removal is verified, without introducing an extra delete', () => {
  const c = liveContext({ empty:true });
  c.localStorage.data.set('olli_kcf_live_session_v1_academy-test', 'old');
  c.save();
  assert.equal(c.localStorage.data.has('olli_kcf_live_session_v1_academy-test'), false);
  assert.ok(c.checks().some(event => event.kind === 'live_session' && event.operation === 'remove' && event.result === 'ok'));
});
