const test=require('node:test');
const assert=require('node:assert/strict');

globalThis.OlliCommandRouter=undefined;
const router=require('../packages/common/olli-command-router-common.js');

test('direct attendance status requires explicit attendance-register context',()=>{
  assert.equal(router.parseAttendanceStatusMutationIntent('민수 결석 처리해줘'),null);
  assert.equal(router.parseAttendanceStatusMutationIntent('민수 보강 등록해줘'),null);
  assert.equal(router.parseAttendanceStatusMutationIntent('민수 출석부 보여줘'),null);
});

test('parses regular attendance status changes without stealing legacy absence',()=>{
  const absent=router.parseAttendanceStatusMutationIntent('민수 오늘 출석부에서 결석으로 표시해줘');
  assert.equal(absent.intent,'set_attendance_status');
  assert.equal(absent.status,'absent');
  assert.equal(absent.sessionKind,'regular');
  assert.equal(absent.dateSpec.mode,'today');

  const present=router.parseAttendanceStatusMutationIntent('민수 출결부 5시 A반 출석 체크해줘');
  assert.equal(present.status,'present');
  assert.equal(present.sessionKind,'regular');
  assert.equal(present.classHour,5);
  assert.equal(present.classMinute,0);
  assert.equal(present.classGroup,'A');
});

test('parses makeup and blank states while keeping blank kind explicit or AUTO',()=>{
  const makeup=router.parseAttendanceStatusMutationIntent('민수 내일 출석부에서 보강으로 표시해줘');
  assert.equal(makeup.status,'makeup');
  assert.equal(makeup.sessionKind,'makeup');

  const makeupBlank=router.parseAttendanceStatusMutationIntent('민수 보강 출석부 표시를 빈칸으로 바꿔줘');
  assert.equal(makeupBlank.status,'blank');
  assert.equal(makeupBlank.sessionKind,'makeup');

  const autoBlank=router.parseAttendanceStatusMutationIntent('민수 출석부 상태를 빈칸으로 바꿔줘');
  assert.equal(autoBlank.status,'blank');
  assert.equal(autoBlank.sessionKind,'AUTO');
});

test('half-hour text is preserved as visible hour and minute for server resolution',()=>{
  const parsed=router.parseAttendanceStatusMutationIntent('민수 오늘 출석부 4시 30분 출석으로 표시해줘');
  assert.equal(parsed.classHour,4);
  assert.equal(parsed.classMinute,30);
});
