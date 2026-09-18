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

test('regular timetable card carries clicked date and renders explicit absence state', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /data-session-date="\$\{dateKey\(date\)\}"/);
  assert.match(code, /attendanceStatus === 'absent'/);
  assert.match(code, /absent \? ' absent' : ''/);
});

test('class settings reuse timetable memo and save session-specific absence', () => {
  const code = source('pc-timetable.js');
  assert.match(code, /olliTtAddMemo olliTtAbsenceMemo/);
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
