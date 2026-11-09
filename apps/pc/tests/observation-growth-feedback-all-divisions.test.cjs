const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const readCommon = file => read('../../packages/common/' + file);
const storage = readCommon('observation-memo-storage-common.js');
const save = readCommon('observation-memo-save-common.js');
const session = readCommon('observation-memo-session-common.js');
const common = readCommon('observation-memo-common.js');
const adapter = read('olli-record-memo-storage.js');
const core = read('observation-memo-core.js');
const generation = read('olli-record-feedback-generation.js');
const clear = readCommon('observation-memo-feedback-clear-common.js');

test('growth observation draft is isolated from the legacy kinder risk draft', () => {
  assert.match(session, /noteType: 'elementary_observation'/);
  assert.match(adapter, /String\(noteType \|\| ''\) === 'elementary_observation'/);
  assert.match(adapter, /student\?\.type === 'kinder' \? 'kinder_risk' : 'elementary_observation'/);
  assert.match(storage, /function getMemoKey\(student, noteType = ''\)/);
  assert.match(save, /getMemoEntrySafe\(stableStudent, type\)/);
  assert.match(save, /guardLocalEntry\(request\.student, request\.noteType\)/);
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
  assert.match(generation, /getOrCreateStudentForSupabaseSave\(studentName, studentDivision, selectedStudentId\)/);
  assert.match(generation, /const rawType = options\.feedbackType \|\| 'growth'/);
  assert.match(generation, /buildTodayFeedbackRequestContent\(userText, studentName, feedbackMonth, studentDivision\)/);
});

test('feedback clear is server-first for both divisions and remains scoped to growth observation', () => {
  const reset = generation.slice(generation.indexOf('async function resetElementaryMemoAfterFeedbackSave'));
  assert.match(reset, /\['elementary', 'kinder'\]\.includes\(currentMemoType\)/);
  const serverClear = reset.indexOf("await clearCore.clearAfterFeedback(studentSnapshot, 'elementary_observation')");
  const localClear = reset.indexOf("clearMemoByStudent(studentSnapshot, 'elementary_observation')");
  assert.ok(serverClear >= 0 && localClear > serverClear);
  assert.match(clear, /getMemoEntryByStudent\(student, resolvedType\)/);
  assert.match(clear, /p_note_type: resolvedType,\s*p_expected_revision: expectedRevision/);
});
