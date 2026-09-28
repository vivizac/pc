const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('PC student info reads teacher only from student enrollment response', () => {
  const source = fs.readFileSync('pc-student-info-card-runtime.js', 'utf8');
  assert.ok(source.includes("scheduleRpc('olli_schedule_student_enrollments'"));
  assert.ok(!source.includes('loadAuthoritativeTeacherAssignments'));
  assert.ok(!source.includes("scheduleRpc('olli_schedule_class_teacher_context'"));
});

test('weekly schedule migration joins teacher id and name into regular and one-time rows', () => {
  const sql = fs.readFileSync('supabase/migrations/20260915071000_join_teacher_into_schedule_week.sql', 'utf8');
  assert.ok(sql.includes('ct.teacher_member_id'));
  assert.ok(sql.includes("coalesce(ct.teacher_name, '') as teacher_name"));
  assert.ok(sql.includes('from public.olli_schedule_enrollments e'));
  assert.ok(sql.includes('from public.olli_schedule_one_time_sessions o'));
  assert.ok(sql.includes('left join public.olli_schedule_class_teachers ct'));
});
