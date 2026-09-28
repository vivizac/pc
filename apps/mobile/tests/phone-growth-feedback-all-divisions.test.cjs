const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const runtime = read('olli-observation-runtime.js');
const roster = read('olli-observation-roster-phone.js');
const picker = read('olli-record-student-picker-phone-adapter.js');
const storage = read('olli-observation-memo-storage-phone-adapter.js');
const autosave = read('olli-observation-autosave-phone-adapter.js');
const archive = read('elementary-analysis-phone-adapter.js');
const commonFiles = read('OLLI_COMMON_FILES.txt');
const vercel = read('vercel.json');

test('kinder can enter observation memo without being redirected to one-minute feedback', () => {
  const openFn = runtime.match(/function openStudentMemoPageById\(studentId\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(openFn, /beginObservationMemoSession\(studentId\)/);
  assert.doesNotMatch(openFn, /session\.type === 'kinder'/);
  assert.doesNotMatch(openFn, /openKinderChatFeedbackPage/);
});

test('growth feedback is shared by elementary and kinder and saves as growth', () => {
  assert.match(runtime, /async function requestGrowthFeedback\(\)/);
  assert.match(runtime, /\['elementary', 'kinder'\]\.includes\(currentMemoType\)/);
  assert.match(runtime, /promptType: 'elementary'/);
  assert.match(runtime, /feedbackType: 'growth'/);
  assert.match(runtime, /studentDivision,/);
  assert.match(runtime, /const rawType = options\.feedbackType \|\| 'growth'/);
  assert.match(runtime, /getOrCreateStudentForSupabaseSave\(studentName, studentDivision, selectedStudentId\)/);
});

test('kinder growth memo is isolated from legacy kinder draft storage', () => {
  assert.match(storage, /getMemoKey\(student, noteType = ''\)/);
  assert.match(storage, /String\(noteType \|\| ''\) === 'elementary_observation'/);
  assert.match(storage, /if \(student\.type === 'kinder'\) return '';/);
  assert.match(runtime, /getMemoEntryByStudent\(savingStudent, 'elementary_observation'\)/);
});

test('observation roster and feedback archive expose dots for both divisions', () => {
  const rosterFn = roster.match(/function renderObservationMemoRoster\(\)[\s\S]*?function applyObservationMemoNavigationIcons/)?.[0] || '';
  assert.match(rosterFn, /openElementaryRecordsMenuForStudent/);
  assert.doesNotMatch(rosterFn, /const isElementary/);
  assert.match(picker, /\['elementary', 'kinder'\]\.includes\(currentMemoType\)/);
  assert.match(picker, /studentDivision = student\.type === 'kinder' \? 'kinder' : 'elementary'/);
});

test('phone uses shared server-first feedback clear protection from PC source', () => {
  assert.match(autosave, /observation-memo-feedback-clear-common\.js/);
  assert.match(commonFiles, /^observation-memo-feedback-clear-common\.js$/m);
  const config = JSON.parse(vercel);
  assert.ok(config.rewrites.some(item => item.source === '/observation-memo-feedback-clear-common.js'));
  assert.ok(config.headers.some(item => item.source === '/observation-memo-feedback-clear-common.js'));
});


test('growth archive reload includes class and growth rows and preserves local data on fetch failure', () => {
  const fn = archive.match(/async function loadMemoFeedbackArchiveItemsFromSupabase\(student\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /feedbacks\?select=\*&student_id=eq\./);
  assert.doesNotMatch(fn, /feedback_type=eq\.class/);
  assert.match(fn, /const existingItems = getMemoFeedbackArchiveItems\(student\)/);
  assert.match(fn, /results\.every\(result => result\.status === 'rejected'\)/);
  assert.match(fn, /: existingBySource\('feedbacks'\)/);
  assert.match(fn, /: existingBySource\('fail_feedbacks'\)/);
  assert.match(fn, /setMemoFeedbackArchiveItems\(student, items\)/);
});
