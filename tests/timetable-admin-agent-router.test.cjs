const test=require('node:test');
const assert=require('node:assert/strict');

globalThis.OlliCommandRouter=undefined;
const router=require('../packages/common/olli-command-router-common.js');

test('parses elementary A/B split and merge commands',()=>{
  const split=router.parseClassLayoutMutationIntent('다음주 수요일 초등부 5시 분반해줘');
  assert.equal(split.intent,'set_class_layout');
  assert.equal(split.division,'elementary');
  assert.equal(split.split,true);
  assert.equal(split.timeSlot,5);
  assert.equal(split.dateSpec.mode,'next_weekday');
  assert.equal(split.dateSpec.weekday,3);

  const merge=router.parseClassLayoutMutationIntent('이번주 금요일 유치부 4시 합반으로 바꿔줘');
  assert.equal(merge.intent,'set_class_layout');
  assert.equal(merge.division,'kinder');
  assert.equal(merge.split,false);
});

test('plain weekday teacher assignment is recurring while scoped date is one-day override',()=>{
  const recurring=router.parseTeacherAssignmentMutationIntent('초등부 수요일 5시 A반 담당 선생님 김민지로 배정해줘');
  assert.equal(recurring.intent,'set_class_teacher');
  assert.equal(recurring.teacherName,'김민지');
  assert.equal(recurring.weekday,3);
  assert.equal(recurring.classGroup,'A');

  const override=router.parseTeacherAssignmentMutationIntent('이번주 금요일 유치부 4시 선생님 김민지로 변경해줘');
  assert.equal(override.intent,'set_teacher_override');
  assert.equal(override.teacherName,'김민지');
  assert.equal(override.dateSpec.mode,'this_weekday');
});

test('teacher name before 선생님 is parsed without T suffix particle',()=>{
  const parsed=router.parseTeacherAssignmentMutationIntent('초등부 화요일 4시 김민지 선생님으로 바꿔줘');
  assert.equal(parsed.intent,'set_class_teacher');
  assert.equal(parsed.teacherName,'김민지');
});

test('parses student session order change with private student name preserved only in router result',()=>{
  const parsed=router.parseSessionOrderMutationIntent('민지 화요일 4시 수업 순서 1회차로 변경해줘');
  assert.equal(parsed.intent,'set_session_order');
  assert.equal(parsed.studentName,'민지');
  assert.equal(parsed.sessionOrder,1);
  assert.equal(parsed.weekday,2);
  assert.equal(parsed.timeSlot,4);
});

test('parses holiday to normal class and back to closure only with scoped date',()=>{
  const normal=router.parseNormalClassDayMutationIntent('10월 9일 정상수업으로 변경해줘');
  assert.equal(normal.intent,'set_normal_class_day');
  assert.equal(normal.normalClass,true);
  assert.equal(normal.dateSpec.mode,'month_day');

  const closed=router.parseNormalClassDayMutationIntent('10월 9일 휴원일로 돌려줘');
  assert.equal(closed.intent,'set_normal_class_day');
  assert.equal(closed.normalClass,false);

  assert.equal(router.parseNormalClassDayMutationIntent('금요일 휴원일로 바꿔줘'),null);
});

test('admin-only parsers do not silently enter legacy parseWriteIntent',()=>{
  assert.equal(router.parseWriteIntent('다음주 수요일 초등부 5시 분반해줘'),null);
  assert.equal(router.parseWriteIntent('초등부 수요일 5시 담당 선생님 김민지로 배정해줘'),null);
});
