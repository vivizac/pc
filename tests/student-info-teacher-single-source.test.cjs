const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('PC student info derives feedback teacher only from the student schedule response', () => {
  const source = fs.readFileSync('pc-student-info-card-runtime.js', 'utf8');
  assert.ok(source.includes("scheduleRpc('olli_schedule_student_enrollments'"));
  assert.ok(!source.includes('loadAuthoritativeTeacherAssignments'));
  assert.ok(!source.includes("scheduleRpc('olli_schedule_class_teacher_context'"));
  assert.ok(source.includes('feedbackTeacherName: clean(result.feedback_teacher_name)'));
  assert.ok(source.includes('피드백 담임 · 1회차 수업 기준'));
  assert.ok(source.includes('__olli_feedback_teacher: feedbackTeacher'));
});

test('weekly schedule migration joins teacher id and name into regular and one-time rows', () => {
  const sql = fs.readFileSync('supabase/migrations/20260915071000_join_teacher_into_schedule_week.sql', 'utf8');
  assert.ok(sql.includes('ct.teacher_member_id'));
  assert.ok(sql.includes("coalesce(ct.teacher_name, '') as teacher_name"));
  assert.ok(sql.includes('from public.olli_schedule_enrollments e'));
  assert.ok(sql.includes('from public.olli_schedule_one_time_sessions o'));
  assert.ok(sql.includes('left join public.olli_schedule_class_teachers ct'));
});


test('teacher-role migration keeps one class-teacher source and derives feedback teacher', () => {
  const sql = fs.readFileSync('supabase/migrations/20260917190000_clarify_class_and_feedback_teacher_roles.sql', 'utf8');
  assert.ok(sql.includes('class_teacher_member_id'));
  assert.ok(sql.includes('class_teacher_name'));
  assert.ok(sql.includes('feedback_teacher_member_id'));
  assert.ok(sql.includes('feedback_teacher_name'));
  assert.ok(sql.includes('from public.olli_schedule_class_teachers ct'));
  assert.ok(!sql.includes('create table public.olli_schedule_feedback'));
});

test('timetable teacher picker is explicitly a class teacher picker', () => {
  const source = fs.readFileSync('pc-timetable-teacher-ui.js', 'utf8');
  assert.ok(source.includes('클래스 담임 선택'));
  assert.ok(source.includes('function selectedClassTeacherLabel'));
  assert.ok(source.includes('function classTeacherLabelFromEnrollment'));
});
