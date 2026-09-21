const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('timetable absence memo source files compile', () => {
  assert.doesNotThrow(() => new vm.Script(source('pc-timetable.js'), { filename: 'pc-timetable.js' }));
  assert.doesNotThrow(() => new vm.Script(source('pc-timetable-service.js'), { filename: 'pc-timetable-service.js' }));
});

test('regular timetable card separates today absence from pre-registered future absence', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /const sessionKey = dateKey\(date\)/);
  assert.match(code, /const currentDayKey = todayKey\(\)/);
  assert.match(code, /const absent = sessionKey === currentDayKey && attendanceStatus === 'absent'/);
  assert.match(code, /const upcomingAbsence = sessionKey > currentDayKey && attendanceStatus === 'absent'/);
  assert.match(code, /upcomingAbsence \? ' absenceUpcoming' : ''/);
  assert.match(code, /data-session-date="\$\{sessionKey\}"/);
});

test('class settings reuse timetable memo and save session-specific absence', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /olliTtAbsenceRow/);
  assert.match(code, /olliTtAddMemo olliTtMoveMemo/);
  assert.match(code, /data-tt-absence-toggle/);
  assert.match(code, /setAttendanceSessionStatus\(\{/);
  assert.match(code, /status: dialog\.absenceSelected \? 'absent' : 'blank'/);
  assert.match(code, /saveCellMemoText\(divisionOf\(student\), dialog\.effectiveDate/);
});

test('week and attendance register both receive session override rows', () => {
  const service = source('pc-timetable-service.js');
  assert.match(service, /olli_schedule_attendance_session_overrides_range/);
  assert.match(service, /data\.attendance_overrides = Array\.isArray\(attendanceOverrides\)/);
  assert.match(service, /concat\(Array\.isArray\(overrides\) \? overrides : \[\]\)/);
});

test('absence override migration keeps schedule realtime revision in sync', () => {
  const sql = source('supabase/migrations/20260918090421_timetable_absence_status_range.sql');
  assert.match(sql, /private\.olli_schedule_attendance_session_overrides/);
  assert.match(sql, /create trigger olli_schedule_sync_revision_trg/);
  assert.match(sql, /private\.olli_schedule_bump_sync_revision\(\)/);
  assert.match(sql, /grant execute on function public\.olli_schedule_attendance_session_overrides_range/);
});

test('existing makeup and trial cancellation memo flow remains wired', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /data-tt-cancel-note/);
  assert.match(code, /async function cancelMakeupSession\(\)/);
  assert.match(code, /취소 사유 메모/);
});


test('existing timetable cell memos stay independent from absence override loading', () => {
  const code = source('pc-timetable.js');
  const service = source('pc-timetable-service.js');
  assert.match(code, /cellMemos\(\)\.filter/);
  assert.match(code, /olliTtCellMemoCard/);
  assert.match(service, /olli_schedule_cell_memos_week_v2/);
  assert.match(service, /loadAttendanceOverridesRange\(start, end\)\.catch/);
});

test('absence UI is square beside a two-line memo and uses white text on red today card', () => {
  const css = source('pc-timetable.css');
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) 86px/);
  assert.match(css, /\.olliTtMoveMemo \{ min-height:86px; height:86px/);
  assert.match(css, /\.olliTtAbsenceBtn \{[\s\S]*width:86px;[\s\S]*height:86px;/);
  assert.match(css, /\.olliTtStudent\.regular\.absent \{ border-color:#e5484d; color:#fff; background:#e5484d/);
  assert.match(css, /\.olliTtStudent\.regular\.absent \.olliTtSecondSessionMark/);
});

test('future absence colors stay lighter than today and kinder is redder than its base pink', () => {
  const css = source('pc-timetable.css');
  assert.match(css, /\.olliTtStudent\.regular\.elementary\.absenceUpcoming \{ border-color:#f2b8b6; color:#9a4448; background:#fde8e7/);
  assert.match(css, /\.olliTtStudent\.regular\.kinder\.absenceUpcoming \{ border-color:#e28e98; color:#843b43; background:#f2b8bf/);
  assert.match(css, /\.olliTtStudent\.regular\.kinder \{ border-color: #f5c7d4; background: #ffe4eb; \}/);
  assert.match(css, /\.olliTtStudent\.regular\.absent \{ border-color:#e5484d; color:#fff; background:#e5484d/);
});


test('class-setting memo prefixes the student name without duplication', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /const rawNote = dialog\.actionType === 'move' \? clean\(dialog\.note\) : ''/);
  assert.match(code, /!rawNote\.startsWith\(studentName\)/);
  assert.match(code, /\$\{studentName\} \$\{rawNote\}/);
});

test('class-setting memo row keeps the same vertical spacing as other fields', () => {
  const css = source('pc-timetable.css');
  assert.match(css, /\.olliTtAbsenceRow \{ margin-top:21px;/);
});


test('absence memo uses tagged student format', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /\[\$\{studentName\}\]\[결석\] : /);
});

test('makeup trial and wait cancellation memos use tagged cancel format', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /\[\$\{clean\(item\.student_name\)\}\]\[취소\] : \$\{cancelNote\}/);
  assert.match(code, /data-tt-entry="wait"[\s\S]*data-session-date="\$\{dateKey\(date\)\}"/);
  assert.match(code, /state\.dialog = \{ kind: 'wait'[\s\S]*cancelDate: selectedDate, cancelNote: '' \}/);
  assert.match(code, /saveCellMemoText\(clean\(item\.division\), clean\(dialog\.cancelDate\) \|\| todayKey\(\)/);
});

test('memo text size matches timetable student card text size', () => {
  const css = source('pc-timetable.css');
  assert.match(css, /\.olliTtCellMemoCard > strong \{[^\n]*font-size: calc\(10px \* var\(--olli-text-scale\)\)/);
  assert.match(css, /\.olliTtAddMemo textarea \{[^\n]*font: 680 calc\(10px \* var\(--olli-text-scale\)\)/);
});


test('attendance removal requires confirmation only after attendance is marked', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /if \(wasAttended\) \{/);
  assert.match(code, /global\.confirm\(/);
  assert.match(code, /출석 체크를 해제할까요/);
  assert.match(code, /if \(!global\.confirm\([\s\S]*\)\) return;/);
});


test('same-day absence reduces timetable capacity count for makeup registration', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /const absentRegularCount = regular\.filter/);
  assert.match(code, /timetableAttendanceSessionStatus\([\s\S]*'regular'[\s\S]*\) === 'absent'/);
  assert.match(code, /Math\.max\(0, regular\.length - absentRegularCount\)/);
});


test('makeup capacity migration excludes same-day absent regular students', () => {
  const sql = source('supabase/migrations/20260921055325_allow_makeup_in_absence_vacancy.sql');
  assert.match(sql, /private\.olli_schedule_attendance_session_overrides/);
  assert.match(sql, /a\.session_kind = 'regular'/);
  assert.match(sql, /a\.status = 'absent'/);
  assert.match(sql, /not exists \(/);
});
