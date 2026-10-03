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

test('structured find_available_slots routes a next-week query to existing week availability SOT', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule={
    async findWeekAvailability(options){
      observed=options;
      return {scope:'week',label:options.dateLabel,days:[]};
    },
    async findAvailableSlots(){ throw new Error('date path should not run'); },
    async findRecurringAvailability(){ throw new Error('recurring path should not run'); },
    describeWeekAvailability(result){ return result.label+' 빈자리 조회 완료'; },
  };

  try{
    const result=await router.runStructuredQuery({
      action:'find_available_slots',
      division:'elementary',
      dateExpression:'다음주',
      weekday:0,
      timeSlot:0,
      classGroup:'',
      availabilityPurpose:'makeup',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.intent,'find_available_slots');
    assert.equal(result.payload.scope,'week');
    assert.equal(result.payload.weekOffset,1);
    assert.equal(result.payload.purpose,'makeup');
    assert.match(result.message,/다음 주/);
    assert.ok(observed);
    assert.equal(observed.weekOffset,1);
    assert.equal(observed.division,'elementary');
    assert.equal(observed.purpose,'makeup');
    assert.equal(observed.viewMode,'availability');
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured find_available_slots routes a recurring weekday/time/group query without reparsing Korean', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule={
    async findWeekAvailability(){ throw new Error('week path should not run'); },
    async findAvailableSlots(){ throw new Error('date path should not run'); },
    async findRecurringAvailability(options){
      observed=options;
      return {scope:'recurring',weekday:options.weekday,timeSlot:options.timeSlot,classGroup:options.classGroup};
    },
    describeRecurringAvailability(){ return '화요일 5시 B반은 1자리 있습니다.'; },
  };

  try{
    const result=await router.runStructuredQuery({
      action:'find_available_slots',
      division:'',
      dateExpression:'',
      weekday:2,
      timeSlot:5,
      classGroup:'B',
      availabilityPurpose:'unknown',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.payload.scope,'recurring');
    assert.equal(result.payload.weekday,2);
    assert.equal(result.payload.timeSlot,5);
    assert.equal(result.payload.classGroup,'B');
    assert.ok(observed);
    assert.equal(observed.weekday,2);
    assert.equal(observed.timeSlot,5);
    assert.equal(observed.classGroup,'B');
    assert.equal(observed.purpose,'unknown');
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured find_available_slots routes a specific date to existing date availability SOT', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule={
    async findWeekAvailability(){ throw new Error('week path should not run'); },
    async findRecurringAvailability(){ throw new Error('recurring path should not run'); },
    async findAvailableSlots(options){
      observed=options;
      return {date:options.date,dateLabel:options.dateLabel,slots:[],allSlots:[],displaySlots:[]};
    },
    describeAvailableSlots(result){ return result.dateLabel+' 체험 자리를 확인했어요.'; },
  };

  try{
    const result=await router.runStructuredQuery({
      action:'find_available_slots',
      division:'kinder',
      dateExpression:'내일',
      weekday:0,
      timeSlot:4,
      classGroup:'',
      availabilityPurpose:'trial',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.payload.scope,'date');
    assert.equal(result.payload.purpose,'trial');
    assert.ok(observed);
    assert.equal(observed.division,'kinder');
    assert.equal(observed.purpose,'trial');
    assert.equal(observed.timeSlot,4);
    assert.equal(observed.dateLabel,'내일');
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('PC and Mobile structured availability path bypasses chat and Agent calls after interpretation', () => {
  const pcStart=pc.indexOf("clean(structuredCommand?.action)==='find_available_slots'");
  const pcEnd=pc.indexOf("clean(structuredCommand?.action)==='get_student_schedule'",pcStart+10);
  const pcBlock=pc.slice(pcStart,pcEnd>pcStart?pcEnd:pcStart+1900);
  assert.ok(pcStart>=0);
  assert.match(pcBlock,/runStructuredQuery/);
  assert.doesNotMatch(pcBlock,/resolveAiReply|\/api\/chat|\/api\/olli-agent/);

  const mobileStart=mobile.indexOf("String(structuredCommand?.action || '').trim()==='find_available_slots'");
  const mobileEnd=mobile.indexOf("String(structuredCommand?.action || '').trim()==='get_student_schedule'",mobileStart+10);
  const mobileBlock=mobile.slice(mobileStart,mobileEnd>mobileStart?mobileEnd:mobileStart+1900);
  assert.ok(mobileStart>=0);
  assert.match(mobileBlock,/runStructuredQuery/);
  assert.doesNotMatch(mobileBlock,/resolveOlliTalkAiReply|\/api\/chat|\/api\/olli-agent/);
});

test('structured find_roster_entries routes a weekday class roster to existing roster SOT', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule={
    async findRosterEntries(options){
      observed=options;
      return {
        kind:options.kind,
        scope:options.scope,
        dateLabel:options.dateLabel,
        timeSlot:options.timeSlot,
        classGroup:options.classGroup,
        items:[
          {studentId:'s1',studentName:'민준',division:'elementary',timeSlot:5,classGroup:'B',entryKind:'regular'}
        ]
      };
    },
    describeRosterEntries(result){
      return result.dateLabel+' '+result.timeSlot+'시 수업 명단은 민준입니다.';
    },
  };

  try{
    const result=await router.runStructuredQuery({
      action:'find_roster_entries',
      rosterKind:'class_roster',
      division:'',
      dateExpression:'화요일',
      weekday:2,
      timeSlot:5,
      classGroup:'B',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.intent,'find_roster_entries');
    assert.equal(result.payload.scope,'date');
    assert.equal(result.payload.rosterKind,'class_roster');
    assert.ok(observed);
    assert.equal(observed.kind,'class_roster');
    assert.equal(observed.scope,'date');
    assert.equal(observed.weekday,2);
    assert.equal(observed.timeSlot,5);
    assert.equal(observed.classGroup,'B');
    assert.match(result.message,/민준/);
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured find_roster_entries keeps waitlist lookup in current all-scope when no date is stated', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule={
    async findRosterEntries(options){
      observed=options;
      return {kind:options.kind,scope:options.scope,dateLabel:options.dateLabel,items:[]};
    },
    describeRosterEntries(){ return '현재 대기 명단이 없어요.'; },
  };

  try{
    const result=await router.runStructuredQuery({
      action:'find_roster_entries',
      rosterKind:'waitlist',
      division:'',
      dateExpression:'',
      weekday:0,
      timeSlot:0,
      classGroup:'',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.payload.scope,'all');
    assert.equal(result.payload.dateLabel,'현재');
    assert.ok(observed);
    assert.equal(observed.kind,'waitlist');
    assert.equal(observed.scope,'all');
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured roster query refuses to invent a roster kind', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  globalThis.OlliCommandSchedule={
    async findRosterEntries(){ throw new Error('must not run'); },
    describeRosterEntries(){ return ''; },
  };

  try{
    const result=await router.runStructuredQuery({
      action:'find_roster_entries',
      rosterKind:'',
      dateExpression:'오늘',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.intent,'find_roster_entries');
    assert.match(result.message,/명단 종류/);
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('PC and Mobile structured roster path bypasses chat and Agent calls after interpretation', () => {
  const pcStart=pc.indexOf("clean(structuredCommand?.action)==='find_roster_entries'");
  const pcEnd=pc.indexOf("clean(structuredCommand?.action)==='find_available_slots'",pcStart+10);
  const pcBlock=pc.slice(pcStart,pcEnd>pcStart?pcEnd:pcStart+1900);
  assert.ok(pcStart>=0);
  assert.match(pcBlock,/runStructuredQuery/);
  assert.doesNotMatch(pcBlock,/resolveAiReply|\/api\/chat|\/api\/olli-agent/);

  const mobileStart=mobile.indexOf("String(structuredCommand?.action || '').trim()==='find_roster_entries'");
  const mobileEnd=mobile.indexOf("String(structuredCommand?.action || '').trim()==='find_available_slots'",mobileStart+10);
  const mobileBlock=mobile.slice(mobileStart,mobileEnd>mobileStart?mobileEnd:mobileStart+1900);
  assert.ok(mobileStart>=0);
  assert.match(mobileBlock,/runStructuredQuery/);
  assert.doesNotMatch(mobileBlock,/resolveOlliTalkAiReply|\/api\/chat|\/api\/olli-agent/);
});
