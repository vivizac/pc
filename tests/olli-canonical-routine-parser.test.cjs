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
