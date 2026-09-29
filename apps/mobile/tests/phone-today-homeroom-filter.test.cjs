const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');

test('TODAY uses first regular session as feedback homeroom source', () => {
  assert.ok(source.includes('function primaryFeedbackEnrollment'));
  assert.ok(source.includes('a.session_order'));
  assert.ok(source.includes('resolveFeedbackTeacher'));
  assert.ok(source.includes('feedbackTeacherName: feedbackTeacher.name'));
  assert.ok(source.includes('feedbackTeacherMemberId: feedbackTeacher.memberId'));
});

test('TODAY keeps class homeroom separate from feedback homeroom', () => {
  assert.ok(source.includes('classTeacherName: classTeacherName'));
  assert.ok(source.includes('classTeacherMemberId: classTeacherMemberId'));
  assert.ok(source.includes('var classTeacherName = resolveTeacherName(row, week, student)'));
});

test('TODAY filters logged-in teacher by feedback homeroom', () => {
  assert.ok(source.includes('var feedbackTeacherMemberId = clean(item && (item.feedbackTeacherMemberId || item.teacherMemberId))'));
  assert.ok(source.includes('activeMemberId === feedbackTeacherMemberId'));
  assert.ok(source.includes('var feedbackTeacherName = clean(item && (item.feedbackTeacherName || item.teacherName))'));
});

test('TODAY can build a kinder student card from server schedule if local roster is stale', () => {
  assert.ok(source.includes('function scheduleStudentForRow'));
  assert.ok(source.includes('row.student_name || row.studentName'));
  assert.ok(source.includes("serverDivision !== 'kinder'"));
  assert.ok(source.includes('__olliScheduleFallback: true'));
});

test('TODAY retains teacher context and refreshed cache key', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.ok(source.includes('loadScheduleTeacherContext'));
  assert.ok(source.includes('rpc/olli_schedule_class_teacher_context'));
  assert.ok(html.includes('kcf-auto-mode-runtime.js?v=20260919-daily-substitute-1'));
});


test('TODAY uses a one-day substitute only when today is the feedback-first regular session', () => {
  assert.ok(source.includes('function teacherOverrideForRow'));
  assert.ok(source.includes('function resolveEffectiveTeacher'));
  assert.ok(source.includes("sourceKind === 'regular' && sameClassSession(firstSession, todayRow)"));
  assert.ok(source.includes('return resolveEffectiveTeacher(firstSession, week, student, todayKey())'));
  assert.ok(source.includes('rpc/olli_schedule_teacher_overrides_range'));
});

test('TODAY keeps second-session feedback assigned to the original first-session homeroom', () => {
  assert.ok(source.includes('var firstSession = primaryFeedbackEnrollment'));
  assert.ok(source.includes('if (todayIsPrimaryRegular) return resolveEffectiveTeacher'));
  assert.ok(source.includes('name: resolveTeacherName(firstSession, week, student)'));
  assert.ok(source.includes('memberId: resolveTeacherMemberId(firstSession, week)'));
});
