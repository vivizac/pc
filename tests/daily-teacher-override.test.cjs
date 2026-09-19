const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');

test('PC timetable loads date-scoped teacher overrides without replacing regular homeroom', () => {
  assert.ok(service.includes('olli_schedule_teacher_overrides_range'));
  assert.ok(service.includes('data.teacher_overrides'));
  assert.ok(service.includes('olli_schedule_set_teacher_override'));
  assert.ok(ui.includes('function teacherOverrideFor'));
  assert.ok(ui.includes('function effectiveClassTeacherLabel'));
  assert.ok(ui.includes('· 대체'));
});

test('PC class popup keeps regular homeroom and daily substitute as separate states', () => {
  assert.ok(ui.includes('teacherMemberId, originalTeacherMemberId: teacherMemberId'));
  assert.ok(ui.includes('overrideTeacherMemberId, originalOverrideTeacherMemberId: overrideTeacherMemberId'));
  assert.ok(ui.includes('data-tt-daily-teacher'));
  assert.ok(ui.includes('정규 담임은 유지됩니다.'));
});

test('PC daily substitute saves independently and can be cleared', () => {
  assert.ok(ui.includes('const overrideChanged = clean(dialog.overrideTeacherMemberId) !== clean(dialog.originalOverrideTeacherMemberId)'));
  assert.ok(ui.includes("service.setTeacherOverride(dialog.date, dialog.division, dialog.time, dialog.targetClassGroup, dialog.overrideTeacherMemberId, 'teacher_absence')"));
  assert.ok(ui.includes('당일 담당 변경을 해제했어요.'));
});
