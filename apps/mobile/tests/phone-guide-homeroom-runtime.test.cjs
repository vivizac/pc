const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = (name) => fs.readFileSync(name, 'utf8');

test('phone KCF keeps guide UI while common runtime owns submit execution', () => {
  const html = read('index.html');
  const kcf = read('kinder-feedback.js');
  assert.match(html, /<script src="olli-feedback-registration-runtime\.js\?v=20260913-one-minute-common-1"><\/script>/);
  assert.match(kcf, /function setKinderChatFeedbackGuideVisibility\(visible\)/);
  assert.doesNotMatch(kcf, /async function submitKinderChatFeedback\(\)/);
  assert.doesNotMatch(kcf, /window\.submitKinderChatFeedback\s*=/);
});

test('kindergarten student-info draft exists before the shared UI helper uses it', () => {
  const info = read('olli-student-info-runtime.js');
  const ui = read('olli-record-sort-student-ui.js');
  assert.match(info, /let kinderInfoDraft = \{ personality: '' \};/);
  assert.match(ui, /kinderInfoDraft\.personality/);
});

test('student-info timetable result is isolated from optional profile UI helpers', () => {
  const schedule = read('olli-student-schedule-runtime.js');
  assert.doesNotMatch(schedule, /phoneStudentInfoPrepareInfoExtra/);
  const fetchStart = schedule.indexOf('async function fetchContext');
  const applyStart = schedule.indexOf('function applyCardContext');
  const refreshStart = schedule.indexOf('async function refreshAuthoritative');
  assert.ok(fetchStart >= 0 && applyStart > fetchStart && refreshStart > applyStart);
  const fetchBlock = schedule.slice(fetchStart, applyStart);
  const applyBlock = schedule.slice(applyStart, refreshStart);
  assert.match(fetchBlock, /loaded: true/);
  assert.doesNotMatch(fetchBlock, /olliPrepareInfoExtra|olliSetPhoneInfoUiError/);
  assert.match(applyBlock, /setTeacherDisplay\(division, context\.teacherName/);
  assert.match(applyBlock, /renderPickup\(division, context\.pickups\)/);
  assert.match(applyBlock, /ui\.applyContext\(division, student, context\)/);
  assert.doesNotMatch(applyBlock, /olliPrepareInfoExtra|olliSetPhoneInfoScheduleError/);
});
