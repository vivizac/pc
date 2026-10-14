'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const live = read('kinder-feedback.js');
const teacher = read('kcf-auto-mode-runtime.js');
const storage = read('olli-storage-core.js');
const common = fs.readFileSync(path.join(root, '..', '..', 'packages', 'common', 'olli-feedback-runtime.js'), 'utf8');
const summary = fs.readFileSync(path.join(root, '..', 'pc', 'olli-data-consultation-summary.js'), 'utf8');
const html = read('index.html');

function createRetirementContext({ fail = false } = {}) {
  const start = common.indexOf('async function retireSupersededQuickNoteFeedbacks(');
  const end = common.indexOf('async function saveTodayFeedbackItem(', start);
  assert.ok(start >= 0 && end > start, 'QuickNote retirement helper must exist');
  const calls = [];
  const warnings = [];
  const originals = new Map();
  let oldSavePromise = null;
  const env = {
    window: { getKinderChatFeedbackLiveSavePromise: () => oldSavePromise },
    getKinderChatFeedbackLiveItem: id => originals.get(id) || null,
    getTodayFeedbackItemById: () => null,
    getOlliCurrentAcademyId: () => 'academy-1',
    deleteOlliData: async (feature, input) => {
      calls.push({ feature, input });
      return fail ? { ok:false, pending:true } : { ok:true, deleted:true };
    },
    refreshRecordsAfterFeedbackSave: async () => {},
    persistKinderChatFeedbackLiveSessionNow: () => {},
    updateTodayFeedbackItem: () => {},
    showPushToast: message => warnings.push(message)
  };
  const fn = new Function(...Object.keys(env), common.slice(start, end) + '\nreturn retireSupersededQuickNoteFeedbacks;')(...Object.values(env));
  const replacement = {
    id:'live-new', saved:true, savedRow:{ id:2002 }, savedRowId:'2002',
    savedSourceTable:'feedbacks', savedAcademyId:'academy-1', savedStudentId:'student-1',
    studentId:'student-1',
    supersededFeedbacks:[{
      jobId:'live-old', recordId:'2001', academyId:'academy-1',
      studentId:'student-1', sourceTable:'feedbacks'
    }]
  };
  originals.set('live-new', replacement);
  return { fn, calls, warnings, originals, replacement, setSavePromise: p => { oldSavePromise = p; } };
}

test('source edit creates a new job, carries superseded source identity, and triggers new AI generation', () => {
  assert.match(teacher, /function captureSupersededQuickNoteFeedbacks\(/);
  assert.match(teacher, /supersededFeedbacks: captureSupersededQuickNoteFeedbacks\(id, record\)/);
  assert.match(teacher, /id: newId/);
  assert.match(teacher, /supersededFeedbacks: Array\.isArray\(editing\.supersededFeedbacks\)/);
  assert.match(teacher, /global\.startTodayFeedbackRequest\(nextOptions\)/);
  assert.match(live, /supersededFeedbacks:Array\.isArray\(item\.supersededFeedbacks\)/);
  assert.match(live, /supersededFeedbacks: Array\.isArray\(options\.supersededFeedbacks\)/);
  assert.match(live, /await retireSupersededQuickNoteFeedbacks\(item\)/);
  assert.match(common, /await retireSupersededQuickNoteFeedbacks\(\{/);
});

test('server exposes individual soft delete, not student-wide delete, to teachers', () => {
  const start = storage.indexOf("feature: 'general_feedback_by_id_delete'");
  assert.ok(start >= 0);
  const block = storage.slice(start, storage.indexOf('FeatureRegistry.register({', start));
  assert.match(block, /identity: \{ requiresAcademyId: true, requiresRecordId: true \}/);
  assert.match(block, /operation: 'soft_delete'/);
  assert.match(block, /identityColumns: \['academy_id', 'id'\]/);
  assert.match(block, /write: \['teacher', 'manager', 'owner'\]/);
  assert.match(summary, /return filterOlliActiveRows\(rows\)/);
});

test('replaced feedback is retired only after the new server row is verified', async () => {
  const { fn, calls, replacement } = createRetirementContext();
  assert.equal(await fn(replacement), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].feature, 'general_feedback_by_id_delete');
  assert.equal(calls[0].input.recordId, '2001');
  assert.equal(calls[0].input.reason, 'quicknote_source_record_corrected');
  assert.equal(replacement.supersededFeedbacks.length, 0);
});

test('offline/pending replacement does not delete last saved feedback', async () => {
  const { fn, calls, replacement } = createRetirementContext();
  replacement.savedRow = { id:'temp-local', __pending_sync:true };
  replacement.savedRowId = 'temp-local';
  assert.equal(await fn(replacement), false);
  assert.equal(calls.length, 0);
  assert.equal(replacement.supersededFeedbacks.length, 1);
});

test('cross-student old source is never deleted', async () => {
  const { fn, calls, replacement } = createRetirementContext();
  replacement.supersededFeedbacks[0].studentId = 'student-2';
  assert.equal(await fn(replacement), false);
  assert.equal(calls.length, 0);
});

test('failed deletion preserves retry metadata and shows teacher warning', async () => {
  const { fn, calls, warnings, replacement } = createRetirementContext({ fail:true });
  assert.equal(await fn(replacement), false);
  assert.equal(calls.length, 1);
  assert.equal(replacement.supersededFeedbacks.length, 1);
  assert.equal(warnings.length, 1);
});

test('new replacement waits for an older in-flight save and deletes its resolved row', async () => {
  const ctx = createRetirementContext();
  const original = { savedRow:null, savedRowId:'', studentId:'student-1', savedAcademyId:'academy-1' };
  ctx.originals.set('live-old', original);
  ctx.replacement.supersededFeedbacks[0].recordId = '';
  let finish;
  ctx.setSavePromise(new Promise(resolve => { finish = resolve; }));
  const pending = ctx.fn(ctx.replacement);
  await Promise.resolve();
  assert.equal(ctx.calls.length, 0);
  original.savedRow = { id:2001 };
  original.savedRowId = '2001';
  finish(true);
  assert.equal(await pending, true);
  assert.equal(ctx.calls[0].input.recordId, '2001');
});

test('corrected source scripts use explicit cache versions', () => {
  for (const name of ['olli-feedback-runtime', 'kinder-feedback', 'kcf-auto-mode-runtime', 'olli-storage-core']) {
    assert.match(html, new RegExp(name + '\\.js\\?v=[^"\\n]*corrected-source-1'));
  }
});
