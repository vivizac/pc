const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');

test('observation dots still open elementary archive instead of student info', () => {
  const roster = read('olli-observation-roster-phone.js');
  assert.match(roster, /memoBodyRosterMoreBtn[\s\S]*openElementaryRecordsMenuForStudent/);
  assert.doesNotMatch(roster, /memoBodyRosterMoreBtn[\s\S]{0,300}openMemoStudentInfoFromPicker/);
});

test('attendance student click still opens student info modal', () => {
  const ops = read('olli-data-student-operations.js');
  const start = ops.indexOf('function handleStudentRowClick(event, studentId)');
  const end = ops.indexOf('function enterStudentSelectionMode()', start);
  assert.ok(start >= 0 && end > start);
  const section = ops.slice(start, end);
  assert.match(section, /studentInfoModalTarget = student/);
  assert.match(section, /openKinderInfoModal/);
  assert.match(section, /openElementaryInfoModal/);
});

test('student info renders dedicated local cache first and server refresh second', () => {
  const runtime = read('olli-student-schedule-runtime.js');
  assert.match(runtime, /function readLocal\(student, division\)/);
  assert.match(runtime, /function renderLocal\(student, division\)/);
  assert.match(runtime, /async function refreshAuthoritative\(student, division\)/);
  assert.match(runtime, /writeLocal\(context\)/);
  assert.doesNotMatch(runtime, /OlliAttendanceData/);
  assert.doesNotMatch(runtime, /lesson_day.*복구|legacyPairs/);
  const elementary = read('olli-phone-elementary-student-info-card.js');
  const kinder = read('olli-phone-kinder-student-info-card.js');
  assert.match(elementary, /phoneStudentInfoRenderLocal\(student, 'elementary'\)/);
  assert.match(kinder, /phoneStudentInfoRenderLocal\(student, 'kinder'\)/);
});

test('explicit editor mount replaces whole-body DOM correction observer', () => {
  const runtime = read('olli-student-schedule-runtime.js');
  const editor = read('olli-phone-student-schedule-editor.js');
  assert.match(runtime, /ui\.mount\(division, student, cached\)/);
  assert.match(editor, /function mount\(division, student, context, options = \{\}\)/);
  assert.doesNotMatch(editor, /observer\.observe\(document\.body/);
  assert.doesNotMatch(editor, /document\.addEventListener\('click',queue,true\)/);
});
