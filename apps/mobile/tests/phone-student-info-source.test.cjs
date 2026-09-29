const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(name, 'utf8');

function block(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `missing start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing end marker: ${end}`);
  return source.slice(a, b);
}

test('student profile save still requires confirmed server row', () => {
  const source = read('olli-data-student-operations.js');
  assert.match(source, /ensureStudentSavedToSupabase\(student, options = \{\}\)/);
  assert.match(source, /pending && options\.requireServer/);
});

test('phone student schedule has exactly one client data service', () => {
  const runtime = read('olli-student-schedule-runtime.js');
  assert.match(runtime, /OlliPhoneStudentScheduleService = service/);
  assert.match(runtime, /olli_schedule_student_enrollments/);
  assert.match(runtime, /CACHE_PREFIX = 'olli_phone_student_info_local_v1'/);
  assert.match(runtime, /state\.pending = new Map|pending: new Map/);
  assert.doesNotMatch(runtime, /OlliStudentScheduleUI/);
  assert.doesNotMatch(runtime, /legacyPairs/);
  assert.doesNotMatch(runtime, /phoneStudentInfoPairsFromExtra/);
  assert.doesNotMatch(runtime, /saveStudent\(.*skipRemote/);
  assert.doesNotMatch(runtime, /MutationObserver/);
});

test('schedule editor uses service only and has no recovery data path', () => {
  const source = read('olli-phone-student-schedule-editor.js');
  assert.match(source, /OlliPhoneStudentScheduleService/);
  assert.match(source, /scheduleService\(\)\.saveSchedule/);
  assert.match(source, /scheduleService\(\)\.readLocal/);
  assert.match(source, /global\.OlliPhoneStudentScheduleEditor = Object\.freeze/);
  assert.doesNotMatch(source, /studentRowsFromWeek/);
  assert.doesNotMatch(source, /phoneStudentInfoLoadScheduleSource/);
  assert.doesNotMatch(source, /global\.supabase/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /loadStudentsFromSupabase\(\)/);
});

test('profile cards no longer own or save timetable UI state', () => {
  for (const file of ['olli-phone-kinder-student-info-card.js', 'olli-phone-elementary-student-info-card.js']) {
    const source = read(file);
    assert.match(source, /ensureStudentSavedToSupabase\(profile, \{ requireServer: true \}\)/, file);
    assert.doesNotMatch(source, /OlliPhoneStudentInfoSchedule/, file);
    assert.doesNotMatch(source, /scheduleService\.setSchedule/, file);
    assert.doesNotMatch(source, /LessonDayToggleRow|LessonTimeToggleRow/, file);
    assert.match(source, /pcStudentInfoSchedule/);
  }
});

test('record student helper no longer carries timetable or teacher repair state', () => {
  const source = read('olli-record-sort-student-ui.js');
  assert.doesNotMatch(source, /kinderInfoDaysDraft|elementaryInfoDaysDraft/);
  assert.doesNotMatch(source, /kinderInfoTeacherDraft|elementaryInfoTeacherDraft/);
  assert.doesNotMatch(source, /OlliStudentScheduleUI/);
  assert.doesNotMatch(source, /toggleKinderInfoDay|toggleElementaryInfoDay/);
  assert.doesNotMatch(source, /hydrateTeacherOptionsFromSupabase/);
  assert.match(source, /window\.olliPrepareInfoExtra/);
  assert.match(source, /renderPersonalityButtons/);
});

test('student schedule UI stays bottom-sheet compatible and local-first', () => {
  const schedule = read('olli-phone-student-schedule-editor.js');
  assert.match(schedule, /pcStudentInfoCard\.olliPhoneScheduleMode[^\n]*height:calc\(100% - 21px\)/);
  assert.match(schedule, /olliPhoneScheduleActions[^\n]*position:relative;bottom:auto/);
  assert.match(schedule, /function primeEditorFromLocal/);
  assert.match(schedule, /if \(state\.loading && !state\.showingLocal\)/);
  assert.match(schedule, /저장된 수업을 먼저 표시했습니다/);
});

test('changed student-info sources are cache-busted together', () => {
  const html = read('index.html');
  for (const token of [
    'olli-student-schedule-runtime.js?v=20260915-single-source-1',
    'olli-phone-student-schedule-editor.js?v=20260915-single-source-1',
    'olli-phone-kinder-student-info-card.js?v=20260915-single-source-1',
    'olli-phone-elementary-student-info-card.js?v=20260915-single-source-1',
    'olli-record-sort-student-ui.js?v=20260915-single-source-1'
  ]) assert.ok(html.includes(token), `missing cache token: ${token}`);
});
