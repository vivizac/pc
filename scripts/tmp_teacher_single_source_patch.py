from pathlib import Path
import re

path = Path('pc-student-info-card-runtime.js')
text = path.read_text(encoding='utf-8')

if 'loadAuthoritativeTeacherAssignments' in text:
    text, count = re.subn(
        r"\n  async function loadAuthoritativeTeacherAssignments\(\) \{\n    const result = await scheduleRpc\('olli_schedule_class_teacher_context'\);\n    return Array\.isArray\(result\.assignments\) \? result\.assignments : \[\];\n  \}\n",
        "\n",
        text,
        count=1,
    )
    assert count == 1, 'teacher assignment loader block not found exactly once'

    old_open = """      let teacherAssignments = [];
      if (context.enrollments.length && !resolveTimetableTeacherName(student.type === 'kinder' ? 'kinder' : 'elementary', context.enrollments, [])) {
        teacherAssignments = await loadAuthoritativeTeacherAssignments();
      }"""
    assert old_open in text, 'open-card teacher fallback block not found'
    text = text.replace(old_open, "      const teacherAssignments = [];", 1)

    old_refresh = """      let teacherAssignments = [];
      const division = latest.type === 'kinder' ? 'kinder' : 'elementary';
      if (context.enrollments.length && !resolveTimetableTeacherName(division, context.enrollments, [])) {
        teacherAssignments = await loadAuthoritativeTeacherAssignments();
      }"""
    assert old_refresh in text, 'refresh teacher fallback block not found'
    text = text.replace(old_refresh, "      const teacherAssignments = [];", 1)

    assert 'loadAuthoritativeTeacherAssignments' not in text
    assert 'olli_schedule_class_teacher_context' not in text
    path.write_text(text, encoding='utf-8')

test = """const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('PC student info reads teacher only from student enrollment response', () => {
  const source = fs.readFileSync('pc-student-info-card-runtime.js', 'utf8');
  assert.ok(source.includes(\"scheduleRpc('olli_schedule_student_enrollments'\"));
  assert.ok(!source.includes('loadAuthoritativeTeacherAssignments'));
  assert.ok(!source.includes(\"scheduleRpc('olli_schedule_class_teacher_context'\"));
});

test('weekly schedule migration joins teacher id and name into regular and one-time rows', () => {
  const sql = fs.readFileSync('supabase/migrations/20260915071000_join_teacher_into_schedule_week.sql', 'utf8');
  assert.ok(sql.includes('ct.teacher_member_id'));
  assert.ok(sql.includes(\"coalesce(ct.teacher_name, '') as teacher_name\"));
  assert.ok(sql.includes('from public.olli_schedule_enrollments e'));
  assert.ok(sql.includes('from public.olli_schedule_one_time_sessions o'));
  assert.ok(sql.includes('left join public.olli_schedule_class_teachers ct'));
});
"""
Path('tests/student-info-teacher-single-source.test.cjs').write_text(test, encoding='utf-8')
