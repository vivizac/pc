'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const router=require('../packages/common/olli-command-router-common.js');

test('canonical trial translation keeps stated facts and leaves missing time to the system',()=>{
  const command=router.interpretedIntentToStructuredCommand(
    'add_trial',
    '민준 14일 체험수업 등록'
  );
  assert.equal(command.action,'add_trial');
  assert.equal(command.studentName,'민준');
  assert.equal(command.dateExpression,'14일');
  assert.equal(command.timeSlot,0);
  assert.equal(command.classGroup,'');
});

test('canonical update parser separates existing and target makeup facts',()=>{
  const command=router.interpretedIntentToStructuredCommand(
    'update_makeup',
    '민지 10월 3일 1시 보강을 10월 4일 2시로 변경'
  );
  assert.equal(command.action,'update_makeup');
  assert.equal(command.studentName,'민지');
  assert.equal(command.sourceDateExpression,'10월 3일');
  assert.equal(command.sourceTimeSlot,1);
  assert.equal(command.targetDateExpression,'10월 4일');
  assert.equal(command.targetTimeSlot,2);
});


test('canonical update parser carries the source week scope into an unscoped target weekday',()=>{
  const command=router.interpretedIntentToStructuredCommand(
    'update_makeup',
    '민지 다음주 화요일 4시 보강을 목요일 5시로 변경'
  );
  assert.equal(command.sourceDateExpression,'다음 주 화요일');
  assert.equal(command.targetDateExpression,'다음 주 목요일');
  assert.equal(command.targetWeekday,4);
  assert.equal(command.targetTimeSlot,5);
});

test('canonical move parser allows the current class to be resolved from timetable data',()=>{
  const command=router.interpretedIntentToStructuredCommand(
    'move_class',
    '민준 수업 화요일 5시로 이동'
  );
  assert.equal(command.action,'move_class');
  assert.equal(command.studentName,'민준');
  assert.equal(command.sourceWeekday,0);
  assert.equal(command.sourceTimeSlot,0);
  assert.equal(command.targetWeekday,2);
  assert.equal(command.targetTimeSlot,5);
});

test('canonical timetable memo uses the deterministic memo parser',()=>{
  const command=router.interpretedIntentToStructuredCommand(
    'add_timetable_memo',
    '10월 14일 5시 A반 시간표 메모 "재료 확인" 등록'
  );
  assert.equal(command.action,'add_timetable_memo');
  assert.equal(command.dateExpression,'10월 14일');
  assert.equal(command.timeSlot,5);
  assert.equal(command.classGroup,'A');
  assert.equal(command.memoNote,'재료 확인');
});

test('batch parser splits canonical text without Luna batch fields',()=>{
  const batch=router.parseMultiWriteIntent(
    '민지 오늘 결석 처리해줘 그리고 지수 보강 등록'
  );
  assert.equal(batch?.intent,'batch_write');
  assert.deepEqual(batch.commands.map(item=>item.intent),['mark_absent','add_makeup']);
  assert.equal(batch.commands[1].batchDraft,true);
  assert.deepEqual(batch.commands[1].missingBatchFields,['date','time']);
});

test('batch parser keeps incomplete trial and waitlist registration as deterministic drafts',()=>{
  const trial=router.parseBatchDraftWriteIntent('서준 체험수업 등록');
  const wait=router.parseBatchDraftWriteIntent('하늘 대기 등록');
  assert.equal(trial?.intent,'add_trial');
  assert.equal(trial?.studentName,'서준');
  assert.deepEqual(trial?.missingBatchFields,['date','time']);
  assert.equal(wait?.intent,'add_waitlist');
  assert.equal(wait?.studentName,'하늘');
  assert.deepEqual(wait?.missingBatchFields,['date','time']);
});


test('canonical query parser distinguishes student schedule from class roster',()=>{
  const student=router.parseQueryIntent('민준 다음주 시간표 조회');
  const roster=router.parseQueryIntent('다음주 화요일 5시 초등부 수업 명단 조회');
  assert.equal(student?.intent,'get_student_schedule');
  assert.equal(student?.studentName,'민준');
  assert.equal(roster?.intent,'find_roster_entries');
  assert.equal(roster?.rosterKind,'class_roster');
  assert.equal(roster?.timeSlot,5);
});

test('canonical multi-read parser splits requests and inherits shared date and division',()=>{
  const parsed=router.parseQueryIntent(
    '다음주 화요일 초등부 빈자리 조회 그리고 목요일 5시 수업 명단 조회'
  );
  assert.equal(parsed?.intent,'multi_read_query');
  assert.equal(parsed?.queries?.length,2);
  assert.equal(parsed.queries[0].intent,'find_available_slots');
  assert.equal(parsed.queries[1].intent,'find_roster_entries');
  assert.equal(parsed.queries[1].dateLabel,'다음 주 목요일');
  assert.equal(parsed.queries[1].division,'elementary');
});


test('canonical student possessive wording keeps the real student name',()=>{
  const command=router.interpretedIntentToStructuredCommand(
    'add_makeup',
    '테스트 학생의 내일 3시 보강 등록'
  );
  assert.equal(command?.studentName,'테스트');
  assert.equal(command?.dateExpression,'내일');
  assert.equal(command?.timeSlot,3);
});


test('canonical makeup accepts student role particles and afternoon time wording',()=>{
  const command=router.interpretedIntentToStructuredCommand(
    'add_makeup',
    '금우주 학생의 수요일 오후 5시 보강 등록'
  );
  assert.equal(command?.studentName,'금우주');
  assert.equal(command?.timeSlot,5);
});

test('canonical makeup accepts 24-hour clock without polluting the student name',()=>{
  const command=router.interpretedIntentToStructuredCommand(
    'add_makeup',
    '금우주 학생을 수요일 16:00에 보강 등록'
  );
  assert.equal(command?.studentName,'금우주');
  assert.equal(command?.timeSlot,4);
});


test('canonical makeup action words stay distinct',()=>{
  assert.equal(router.interpretedIntentToStructuredCommand('add_makeup','금우주 4시'),null);
  assert.equal(router.interpretedIntentToStructuredCommand('add_makeup','금우주 4시 보강'),null);

  const add=router.interpretedIntentToStructuredCommand('add_makeup','금우주 4시 보강 잡아줘');
  assert.equal(add?.action,'add_makeup');
  assert.equal(add?.studentName,'금우주');
  assert.equal(add?.timeSlot,4);

  const cancel=router.interpretedIntentToStructuredCommand('cancel_makeup','금우주 4시 보강 취소');
  assert.equal(cancel?.action,'cancel_makeup');
  assert.equal(cancel?.studentName,'금우주');
  assert.equal(cancel?.timeSlot,4);

  const update=router.interpretedIntentToStructuredCommand('update_makeup','금우주 4시 보강 변경');
  assert.equal(update?.action,'update_makeup');
  assert.equal(update?.studentName,'금우주');
  assert.equal(update?.sourceTimeSlot,4);
});
