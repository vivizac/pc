'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root=path.resolve(__dirname,'..');
const router=require('../packages/common/olli-command-router-common.js');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('structured get_student_schedule calls existing schedule SOT without Korean reparsing', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule={
    async findStudentSchedule(options){
      observed=options;
      return {
        ok:true,
        studentName:'이민형',
        division:'elementary',
        dateLabel:options.dateLabel,
        items:[
          {weekday:1,weekdayLabel:'월요일',timeSlot:4,timeLabel:'4시',classGroup:'A'}
        ]
      };
    },
    describeStudentSchedule(result){
      return result.studentName+'님의 '+result.dateLabel+' 기준 정규 수업은 월요일 4시 A반입니다.';
    },
  };

  try{
    const result=await router.runStructuredQuery({
      action:'get_student_schedule',
      studentName:'이민형',
      dateExpression:'지난주',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'command_result');
    assert.equal(result.intent,'get_student_schedule');
    assert.match(result.message,/지난주/);
    assert.ok(observed);
    assert.equal(observed.studentName,'이민형');
    assert.equal(observed.dateLabel,'지난주');
    assert.ok(observed.referenceDate instanceof Date);
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured schedule query keeps the current period when no period is stated', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule={
    async findStudentSchedule(options){
      observed=options;
      return {ok:true,studentName:'이민형',dateLabel:options.dateLabel,items:[]};
    },
    describeStudentSchedule(){ return '조회 완료'; },
  };

  try{
    const result=await router.runStructuredQuery({
      action:'get_student_schedule',
      studentName:'이민형',
      dateExpression:'',
    },{});

    assert.equal(result.handled,true);
    assert.equal(observed.dateLabel,'현재');
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured schedule query requires only the student name and does not invent one', async () => {
  const result=await router.runStructuredQuery({
    action:'get_student_schedule',
    studentName:'',
    dateExpression:'지난주',
  },{});

  assert.equal(result.handled,true);
  assert.equal(result.kind,'command_result');
  assert.match(result.message,/학생 이름/);
});

test('PC and Mobile structured schedule query path bypasses chat and Agent calls after interpretation', () => {
  const pcStart=pc.indexOf("clean(structuredCommand?.action)==='get_student_schedule'");
  const pcEnd=pc.indexOf("if(\n      interpreterLane==='routine'",pcStart+10);
  const pcBlock=pc.slice(pcStart,pcEnd>pcStart?pcEnd:pcStart+1800);
  assert.ok(pcStart>=0);
  assert.match(pcBlock,/runStructuredQuery/);
  assert.doesNotMatch(pcBlock,/resolveAiReply|\/api\/chat|\/api\/olli-agent/);

  const mobileStart=mobile.indexOf("String(structuredCommand?.action || '').trim()==='get_student_schedule'");
  const mobileEnd=mobile.indexOf("if(\n      interpreterLane==='routine'",mobileStart+10);
  const mobileBlock=mobile.slice(mobileStart,mobileEnd>mobileStart?mobileEnd:mobileStart+1800);
  assert.ok(mobileStart>=0);
  assert.match(mobileBlock,/runStructuredQuery/);
  assert.doesNotMatch(mobileBlock,/resolveOlliTalkAiReply|\/api\/chat|\/api\/olli-agent/);
});
