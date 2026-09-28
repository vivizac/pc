const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const storage = read('observation-memo-storage-common.js');
const save = read('observation-memo-save-common.js');
const guard = read('observation-memo-request-guard-common.js');
const session = read('observation-memo-session-common.js');
const common = read('observation-memo-common.js');
const adapter = read('olli-record-memo-storage.js');
const core = read('observation-memo-core.js');
const generation = read('olli-record-feedback-generation.js');
const clear = read('observation-memo-feedback-clear-common.js');

test('growth observation draft is isolated from the legacy kinder risk draft', () => {
  assert.match(session, /noteType: 'elementary_observation'/);
  assert.match(adapter, /String\(noteType \|\| ''\) === 'elementary_observation'/);
  assert.match(adapter, /student\.type === 'kinder' \? 'kinder_risk' : 'elementary_observation'/);
  assert.match(storage, /function getMemoKey\(student, noteType = ''\)/);
  assert.match(save, /getMemoEntrySafe\(stableStudent, type\)/);
  assert.match(guard, /localEntry\(request\.student, request\.noteType\)/);
});

test('observation memo opens and autosaves for elementary and kinder without changing CAS semantics', () => {
  assert.match(session, /\['elementary', 'kinder'\]\.includes\(session\.type\)/);
  assert.match(common, /\['elementary', 'kinder'\]\.includes\(currentMemoType\)/);
  assert.doesNotMatch(core, /if \(session\.type === 'kinder'\)[\s\S]{0,120}openKinderChatFeedbackPage/);
  assert.match(core, /persistObservationMemoDraft\(savingStudent, memoText, \{\s*noteType: 'elementary_observation'/);
  assert.match(save, /p_note_type: noteType/);
  assert.match(save, /p_expected_revision: memoRevision\(expectedRevision\)/);
  assert.match(save, /status: 'conflict'/);
  assert.match(save, /status: 'pending'/);
});

test('growth feedback uses the elementary prompt by purpose and saves actual division as growth', () => {
  assert.match(core, /async function requestGrowthFeedback\(\)/);
  assert.match(core, /studentDivision,/);
  assert.match(core, /promptType: 'elementary'/);
  assert.match(core, /feedbackType: 'growth'/);
  assert.match(generation, /const studentDivision = options\.studentDivision === 'kinder'/);
  assert.match(generation, /getOrCreateStudentForSupabaseSave\(studentName, studentDivision, selectedStudentId\)/);
  assert.match(generation, /const rawType = options\.feedbackType \|\| 'growth'/);
  assert.match(generation, /buildTodayFeedbackRequestContent\(userText, studentName, feedbackMonth, studentDivision\)/);
});

test('feedback clear is server-first for both divisions and remains scoped to growth observation', () => {
  assert.match(clear, /\['elementary', 'kinder'\]\.includes\(memoType\)/);
  assert.match(clear, /p_note_type: 'elementary_observation'/);
  assert.match(clear, /getMemoEntryByStudent\(student, 'elementary_observation'\)/);
  assert.match(clear, /clearMemoByStudent\(student, 'elementary_observation'\)/);
});
