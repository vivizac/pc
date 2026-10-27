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


test('PC feedback homeroom is editable student profile data, not a timetable label', () => {
  const card = fs.readFileSync('pc-student-info-card-runtime.js', 'utf8');
  const ops = fs.readFileSync('olli-data-student-operations.js', 'utf8');
  assert.match(card, /id="pcStudentInfoFeedbackTeacher"/);
  assert.match(card, /피드백 담임/);
  assert.match(card, /profile\.__olli_feedback_teacher_changed/);
  assert.match(card, /studentInfoScheduleHtml\(student, student\.__olli_authoritative_enrollments\)/);
  assert.match(ops, /payload\.feedback_teacher/);
  assert.match(ops, /safeStudent\.__olli_feedback_teacher_changed/);
});

test('PC student info renders weekly pickups as individual weekday cards', () => {
  const source = fs.readFileSync('pc-student-info-card-runtime.js', 'utf8');
  const begin = source.indexOf('  function studentInfoPickupHtml(rows) {');
  const end = source.indexOf('  function syncPcSchoolUnit(', begin);
  assert.ok(begin >= 0 && end > begin);
  const render = new Function('NUM_DAY', 'clean', 'esc', source.slice(begin, end) + '; return studentInfoPickupHtml;')(
    { 1: '월', 3: '수' }, value => String(value ?? '').trim(), value => String(value ?? '')
  );
  const html = render([
    { weekday: 3, class_time: 5, pickup_label: '정문', pickup_time: '16:50' },
    { weekday: 1, class_time: 4, pickup_label: '도서관', pickup_time: '15:50' }
  ]);
  assert.equal((html.match(/pcStudentInfoPickupItem/g) || []).length, 2);
  assert.ok(html.indexOf('월요일') < html.indexOf('수요일'));
  assert.ok(html.includes('도서관'));
  assert.ok(html.includes('정문'));
  assert.match(render([]), /등록된 픽업이 없습니다/);
  assert.match(source, /previousPickup !== nextPickup/);
});

test('PC student info suffixes are visual only and raw saved fields remain unchanged', () => {
  const source = fs.readFileSync('pc-student-info-card-runtime.js', 'utf8');
  for (const id of ['elementarySchoolInput', 'kinderKindergartenInput']) {
    assert.ok(source.includes(id));
  }
  for (const suffix of ['초등학교', '유치원', 'pcStudentInfoDateControl', 'elementaryInfoEnrolledAtInput', 'kinderInfoEnrolledAtInput', '>살</span>']) {
    assert.ok(source.includes(suffix), suffix);
  }
  assert.match(source, /school: clean\(document\.getElementById\('elementarySchoolInput'\)\?\.value\)/);
  assert.match(source, /kindergarten: clean\(document\.getElementById\('kinderKindergartenInput'\)\?\.value\)/);
  assert.match(source, /const age = clean\(document\.getElementById\('kinderAgeInput'\)\?\.value\)/);
  assert.match(source, /const raw=clean\(document\.getElementById\(prefix\+'EnrolledAtInput'\)\?\.value\)/);
});
