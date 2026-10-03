'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeMentionConversation,
  resolveOlliSystemInterpretation,
  OLLI_INTERPRETER_LANES,
  routeForSystemIntent,
  resolveContextualReadRewrite,
  resolveContextualMakeupRewrite,
  studentLabel,
} = require('../apps/mobile/api/_lib/olli-agent/context-route.cjs');



test('unified interpreter runs on the first turn without loading student data', async () => {
  let observed=null;
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:10,
    currentMessage:'이민형 시간표 알려줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [{id:'student-1',name:'이민형'}];
    },
    modelRunner:async(input)=>{
      observed=input;
      return {
        lane:'routine',
        route:'rule',
        intent:'get_student_schedule',
        standalone_command:'이민형 시간표 알려줘',
        structured_command:{
          action:'get_student_schedule',
          student_name:'이민형',
          division:'',
          date_expression:'',
          time_slot:0,
          class_group:'',
        },
        context_used:false,
      };
    },
  });

  assert.ok(observed);
  assert.equal(studentLoadCalled,false,'routine interpretation must not load the academy student list');
  assert.equal(observed.transcript,'');
  assert.equal(observed.currentText,'이민형 시간표 알려줘');
  assert.equal(result.lane,'routine');
  assert.equal(result.route,'rule');
  assert.equal(result.intent,'get_student_schedule');
  assert.equal(result.standaloneCommand,'이민형 시간표 알려줘');
  assert.equal(result.structuredCommand.action,'get_student_schedule');
  assert.equal(result.structuredCommand.studentName,'이민형');
  assert.equal(result.structuredCommand.dateExpression,'');
  assert.equal(result.contextUsed,false);
});

test('unified interpreter resolves follow-up context from conversation text only', async () => {
  let observed=null;
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:11,
    currentMessage:'그럼 지난주는?',
    conversation:[
      {role:'user',content:'이민형 시간표 알려줘'},
      {role:'assistant',content:'이민형님의 정규 수업은 월요일 4시 A반입니다.'},
    ],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [{id:'student-1',name:'이민형'}];
    },
    modelRunner:async(input)=>{
      observed=input;
      return {
        lane:'routine',
        route:'agent',
        intent:'get_student_schedule',
        standalone_command:'이민형 지난주 시간표 알려줘',
        structured_command:{
          action:'get_student_schedule',
          student_name:'이민형',
          division:'',
          date_expression:'지난주',
          time_slot:0,
          class_group:'',
        },
        context_used:true,
      };
    },
  });

  assert.equal(studentLoadCalled,false);
  assert.match(observed.transcript,/이민형 시간표 알려줘/);
  assert.match(observed.transcript,/이민형님의 정규 수업/);
  assert.equal(result.lane,'routine');
  assert.equal(result.route,'rule','server route is derived from the intent contract, not model route text');
  assert.equal(result.intent,'get_student_schedule');
  assert.equal(result.standaloneCommand,'이민형 지난주 시간표 알려줘');
  assert.equal(result.structuredCommand.action,'get_student_schedule');
  assert.equal(result.structuredCommand.studentName,'이민형');
  assert.equal(result.structuredCommand.dateExpression,'지난주');
  assert.equal(result.contextUsed,true);
});

test('unified interpreter emits a structured add_makeup command from conversation context', async () => {
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:14,
    currentMessage:'B반으로 해줘',
    conversation:[
      {role:'user',content:'민준이 다음주 수요일 5시 보강 등록해줘'},
      {role:'assistant',content:'5시는 A반과 B반이 가능해요.'},
    ],
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'add_makeup',
      standalone_command:'민준이 다음주 수요일 5시 B반 보강 등록해줘',
      structured_command:{
        action:'add_makeup',
        student_name:'민준',
        division:'',
        date_expression:'다음주 수요일',
        time_slot:5,
        class_group:'B',
      },
      reply:'',
      context_used:true,
    }),
  });

  assert.equal(result.lane,'routine');
  assert.equal(result.intent,'add_makeup');
  assert.deepEqual(result.structuredCommand,{
    action:'add_makeup',
    studentName:'민준',
    division:'',
    dateExpression:'다음주 수요일',
    timeSlot:5,
    classGroup:'B',
    weekday:0,
    classTime:0,
    classMinute:0,
    pickupKind:'',
    pickupLabel:'',
    pickupTime:'',
    sourceDateExpression:'',
    sourceWeekday:0,
    sourceTimeSlot:0,
    sourceMinute:0,
    sourceClassGroup:'',
    targetDateExpression:'',
    targetWeekday:0,
    targetTimeSlot:0,
    targetMinute:0,
    targetClassGroup:'',
    reason:'',
    availabilityPurpose:'unknown',
    rosterKind:'',
  });
  assert.equal(result.contextUsed,true);
});

test('unified interpreter emits structured cancel_makeup facts without loading student data', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:115,
    currentMessage:'민준이 다음주 화요일 4시 보강 취소해줘 사유 개인사정',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'cancel_makeup',
      standalone_command:'민준 다음주 화요일 4시 보강 취소 사유: 개인사정',
      structured_command:{
        action:'cancel_makeup',
        student_name:'민준',
        division:'',
        date_expression:'다음주 화요일',
        time_slot:4,
        class_group:'',
        weekday:0,
        class_time:0,
        class_minute:0,
        pickup_kind:'',
        pickup_label:'',
        pickup_time:'',
        source_date_expression:'',
        source_weekday:0,
        source_time_slot:0,
        source_minute:0,
        source_class_group:'',
        target_date_expression:'',
        target_weekday:0,
        target_time_slot:0,
        target_minute:0,
        target_class_group:'',
        reason:'개인사정',
        availability_purpose:'',
        roster_kind:'',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.lane,'routine');
  assert.equal(result.route,'rule');
  assert.equal(result.intent,'cancel_makeup');
  assert.equal(result.structuredCommand.action,'cancel_makeup');
  assert.equal(result.structuredCommand.studentName,'민준');
  assert.equal(result.structuredCommand.dateExpression,'다음주 화요일');
  assert.equal(result.structuredCommand.timeSlot,4);
  assert.equal(result.structuredCommand.reason,'개인사정');
});

test('unified interpreter emits a structured add_trial command without student data lookup', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:15,
    currentMessage:'서준이 초등부 다음주 금요일 5시 체험 등록해줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'add_trial',
      standalone_command:'서준이 초등부 다음주 금요일 5시 체험 등록해줘',
      structured_command:{
        action:'add_trial',
        student_name:'서준',
        division:'elementary',
        date_expression:'다음주 금요일',
        time_slot:5,
        class_group:'',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'add_trial');
  assert.deepEqual(result.structuredCommand,{
    action:'add_trial',
    studentName:'서준',
    division:'elementary',
    dateExpression:'다음주 금요일',
    timeSlot:5,
    classGroup:'',
    weekday:0,
    classTime:0,
    classMinute:0,
    pickupKind:'',
    pickupLabel:'',
    pickupTime:'',
    sourceDateExpression:'',
    sourceWeekday:0,
    sourceTimeSlot:0,
    sourceMinute:0,
    sourceClassGroup:'',
    targetDateExpression:'',
    targetWeekday:0,
    targetTimeSlot:0,
    targetMinute:0,
    targetClassGroup:'',
    reason:'',
    availabilityPurpose:'unknown',
    rosterKind:'',
  });
});

test('unified interpreter emits a structured add_waitlist command without student data lookup', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:16,
    currentMessage:'지우 초등부 다음주 목요일 4시 대기 등록해줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'add_waitlist',
      standalone_command:'지우 초등부 다음주 목요일 4시 대기 등록해줘',
      structured_command:{
        action:'add_waitlist',
        student_name:'지우',
        division:'elementary',
        date_expression:'다음주 목요일',
        time_slot:4,
        class_group:'',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'add_waitlist');
  assert.deepEqual(result.structuredCommand,{
    action:'add_waitlist',
    studentName:'지우',
    division:'elementary',
    dateExpression:'다음주 목요일',
    timeSlot:4,
    classGroup:'',
    weekday:0,
    classTime:0,
    classMinute:0,
    pickupKind:'',
    pickupLabel:'',
    pickupTime:'',
    sourceDateExpression:'',
    sourceWeekday:0,
    sourceTimeSlot:0,
    sourceMinute:0,
    sourceClassGroup:'',
    targetDateExpression:'',
    targetWeekday:0,
    targetTimeSlot:0,
    targetMinute:0,
    targetClassGroup:'',
    reason:'',
    availabilityPurpose:'unknown',
    rosterKind:'',
  });
});

test('unified interpreter emits structured pickup fields without student data lookup', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:17,
    currentMessage:'민서 월요일 4시 30분 수업 리슈빌 3시 30분 픽업 등록해줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'add_pickup',
      standalone_command:'민서 월요일 4시 30분 수업 리슈빌 3시 30분 픽업 등록해줘',
      structured_command:{
        action:'add_pickup',
        student_name:'민서',
        division:'',
        date_expression:'',
        time_slot:0,
        class_group:'',
        weekday:1,
        class_time:4,
        class_minute:30,
        pickup_kind:'arrival',
        pickup_label:'리슈빌',
        pickup_time:'15:30',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'add_pickup');
  assert.deepEqual(result.structuredCommand,{
    action:'add_pickup',
    studentName:'민서',
    division:'',
    dateExpression:'',
    timeSlot:0,
    classGroup:'',
    weekday:1,
    classTime:4,
    classMinute:30,
    pickupKind:'arrival',
    pickupLabel:'리슈빌',
    pickupTime:'15:30',
    sourceDateExpression:'',
    sourceWeekday:0,
    sourceTimeSlot:0,
    sourceMinute:0,
    sourceClassGroup:'',
    targetDateExpression:'',
    targetWeekday:0,
    targetTimeSlot:0,
    targetMinute:0,
    targetClassGroup:'',
    reason:'',
    availabilityPurpose:'unknown',
    rosterKind:'',
  });
});

test('unified interpreter emits a structured add_pickup command without student data lookup', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:17,
    currentMessage:'민서 월요일 4시 수업 리슈빌 3시 30분 픽업 등록해줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'add_pickup',
      standalone_command:'민서 월요일 4시 수업 리슈빌 3시 30분 픽업 등록해줘',
      structured_command:{
        action:'add_pickup',
        student_name:'민서',
        division:'',
        date_expression:'',
        time_slot:0,
        class_group:'',
        weekday:1,
        class_time:4,
        class_minute:0,
        pickup_kind:'arrival',
        pickup_label:'리슈빌',
        pickup_time:'15:30',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'add_pickup');
  assert.equal(result.structuredCommand.action,'add_pickup');
  assert.equal(result.structuredCommand.studentName,'민서');
  assert.equal(result.structuredCommand.weekday,1);
  assert.equal(result.structuredCommand.classTime,4);
  assert.equal(result.structuredCommand.classMinute,0);
  assert.equal(result.structuredCommand.pickupKind,'arrival');
  assert.equal(result.structuredCommand.pickupLabel,'리슈빌');
  assert.equal(result.structuredCommand.pickupTime,'15:30');
});

test('unified interpreter emits structured class move fields without student data lookup', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:18,
    currentMessage:'민준 월요일 4시 수업을 수요일 5시로 옮겨줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'move_class',
      standalone_command:'민준 월요일 4시 수업을 수요일 5시로 옮겨줘',
      structured_command:{
        action:'move_class',
        student_name:'민준',
        division:'',
        date_expression:'',
        time_slot:0,
        class_group:'',
        weekday:0,
        class_time:0,
        class_minute:0,
        pickup_kind:'',
        pickup_label:'',
        pickup_time:'',
        source_weekday:1,
        source_time_slot:4,
        target_weekday:3,
        target_time_slot:5,
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'move_class');
  assert.deepEqual(result.structuredCommand,{
    action:'move_class',
    studentName:'민준',
    division:'',
    dateExpression:'',
    timeSlot:0,
    classGroup:'',
    weekday:0,
    classTime:0,
    classMinute:0,
    pickupKind:'',
    pickupLabel:'',
    pickupTime:'',
    sourceDateExpression:'',
    sourceWeekday:1,
    sourceTimeSlot:4,
    sourceMinute:0,
    sourceClassGroup:'',
    targetDateExpression:'',
    targetWeekday:3,
    targetTimeSlot:5,
    targetMinute:0,
    targetClassGroup:'',
    reason:'',
    availabilityPurpose:'unknown',
    rosterKind:'',
  });
});

test('unified interpreter emits a structured mark_absent command without loading student data', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:19,
    currentMessage:'민준이 오늘 4시 결석 처리해줘 사유 감기',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'mark_absent',
      standalone_command:'민준이 오늘 4시 결석 처리해줘 사유 감기',
      structured_command:{
        action:'mark_absent',
        student_name:'민준',
        division:'',
        date_expression:'오늘',
        time_slot:4,
        class_group:'',
        weekday:0,
        class_time:0,
        class_minute:0,
        pickup_kind:'',
        pickup_label:'',
        pickup_time:'',
        source_weekday:0,
        source_time_slot:0,
        target_weekday:0,
        target_time_slot:0,
        reason:'감기',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'mark_absent');
  assert.deepEqual(result.structuredCommand,{
    action:'mark_absent',
    studentName:'민준',
    division:'',
    dateExpression:'오늘',
    timeSlot:4,
    classGroup:'',
    weekday:0,
    classTime:0,
    classMinute:0,
    pickupKind:'',
    pickupLabel:'',
    pickupTime:'',
    sourceDateExpression:'',
    sourceWeekday:0,
    sourceTimeSlot:0,
    sourceMinute:0,
    sourceClassGroup:'',
    targetDateExpression:'',
    targetWeekday:0,
    targetTimeSlot:0,
    targetMinute:0,
    targetClassGroup:'',
    reason:'감기',
    availabilityPurpose:'unknown',
    rosterKind:'',
  });
});

test('unified interpreter emits a structured find_available_slots query without reading academy data', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:20,
    currentMessage:'다음주 초등부 보강 가능한 자리 알려줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'find_available_slots',
      standalone_command:'다음주 초등부 보강 가능한 자리 알려줘',
      structured_command:{
        action:'find_available_slots',
        student_name:'',
        division:'elementary',
        date_expression:'다음주',
        time_slot:0,
        class_group:'',
        weekday:0,
        class_time:0,
        class_minute:0,
        pickup_kind:'',
        pickup_label:'',
        pickup_time:'',
        source_weekday:0,
        source_time_slot:0,
        target_weekday:0,
        target_time_slot:0,
        reason:'',
        availability_purpose:'makeup',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'find_available_slots');
  assert.equal(result.structuredCommand.action,'find_available_slots');
  assert.equal(result.structuredCommand.division,'elementary');
  assert.equal(result.structuredCommand.dateExpression,'다음주');
  assert.equal(result.structuredCommand.weekday,0);
  assert.equal(result.structuredCommand.timeSlot,0);
  assert.equal(result.structuredCommand.classGroup,'');
  assert.equal(result.structuredCommand.availabilityPurpose,'makeup');
});

test('unified interpreter emits a structured find_roster_entries query without reading student data', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:21,
    currentMessage:'화요일 5시 B반 학생 누구야?',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'find_roster_entries',
      standalone_command:'화요일 5시 B반 학생 누구야?',
      structured_command:{
        action:'find_roster_entries',
        student_name:'',
        division:'',
        date_expression:'화요일',
        time_slot:5,
        class_group:'B',
        weekday:2,
        class_time:0,
        class_minute:0,
        pickup_kind:'',
        pickup_label:'',
        pickup_time:'',
        source_weekday:0,
        source_time_slot:0,
        target_weekday:0,
        target_time_slot:0,
        reason:'',
        availability_purpose:'',
        roster_kind:'class_roster',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'find_roster_entries');
  assert.equal(result.structuredCommand.action,'find_roster_entries');
  assert.equal(result.structuredCommand.rosterKind,'class_roster');
  assert.equal(result.structuredCommand.dateExpression,'화요일');
  assert.equal(result.structuredCommand.weekday,2);
  assert.equal(result.structuredCommand.timeSlot,5);
  assert.equal(result.structuredCommand.classGroup,'B');
});

test('unified interpreter emits a structured find_pickups query without reading pickup data', async () => {
  let studentLoadCalled=false;
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:22,
    currentMessage:'민서 내일 4시 수업 하원 픽업 알려줘',
    conversation:[],
    loadStudents:async()=>{
      studentLoadCalled=true;
      return [];
    },
    modelRunner:async()=>({
      lane:'routine',
      route:'rule',
      intent:'find_pickups',
      standalone_command:'민서 내일 4시 수업 하원 픽업 알려줘',
      structured_command:{
        action:'find_pickups',
        student_name:'민서',
        division:'',
        date_expression:'내일',
        time_slot:0,
        class_group:'',
        weekday:0,
        class_time:4,
        class_minute:0,
        pickup_kind:'dropoff',
        pickup_label:'',
        pickup_time:'',
        source_weekday:0,
        source_time_slot:0,
        target_weekday:0,
        target_time_slot:0,
        reason:'',
        availability_purpose:'',
        roster_kind:'',
      },
      reply:'',
      context_used:false,
    }),
  });

  assert.equal(studentLoadCalled,false);
  assert.equal(result.intent,'find_pickups');
  assert.equal(result.structuredCommand.action,'find_pickups');
  assert.equal(result.structuredCommand.studentName,'민서');
  assert.equal(result.structuredCommand.dateExpression,'내일');
  assert.equal(result.structuredCommand.classTime,4);
  assert.equal(result.structuredCommand.pickupKind,'dropoff');
});

test('unified interpreter classifies feedback/data work separately from routine work', async () => {
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:12,
    currentMessage:'민준이 최근 관찰노트 보고 성장피드백 작성해줘',
    conversation:[],
    modelRunner:async()=>({
      lane:'feedback',
      route:'chat',
      intent:'complex_analysis',
      standalone_command:'민준이 최근 관찰노트 보고 성장피드백 작성해줘',
      structured_command:{
        action:'none',
        student_name:'',
        date_expression:'',
        time_slot:0,
        class_group:'',
      },
      context_used:false,
    }),
  });

  assert.equal(result.lane,'feedback');
  assert.equal(result.route,'chat');
  assert.equal(result.intent,'complex_analysis');
});

test('interpreter lane contract is explicit', () => {
  assert.deepEqual(OLLI_INTERPRETER_LANES,['routine','feedback','chat']);
});

test('chat lane can return a direct reply without a second chat-model contract', async () => {
  const result=await resolveOlliSystemInterpretation({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:13,
    currentMessage:'왜 그렇게 되는 거야?',
    conversation:[
      {role:'user',content:'앞에서 설명한 내용'},
      {role:'assistant',content:'앞 설명'},
    ],
    modelRunner:async()=>({
      lane:'chat',
      route:'chat',
      intent:'general_chat',
      standalone_command:'왜 그렇게 되는 거야?',
      structured_command:{
        action:'none',
        student_name:'',
        date_expression:'',
        time_slot:0,
        class_group:'',
      },
      reply:'앞에서 설명한 이유를 이어서 설명할게요.',
      context_used:true,
    }),
  });

  assert.equal(result.lane,'chat');
  assert.equal(result.reply,'앞에서 설명한 이유를 이어서 설명할게요.');
  assert.equal(result.route,'chat');
  assert.equal(result.contextUsed,true);
});

test('unified interpreter has one deterministic route contract per system intent', () => {
  assert.equal(routeForSystemIntent('add_makeup'),'rule');
  assert.equal(routeForSystemIntent('cancel_makeup'),'rule');
  assert.equal(routeForSystemIntent('get_student_schedule'),'rule');
  assert.equal(routeForSystemIntent('get_attendance'),'agent');
  assert.equal(routeForSystemIntent('set_attendance_status'),'agent');
  assert.equal(routeForSystemIntent('complex_analysis'),'chat');
  assert.equal(routeForSystemIntent('general_chat'),'chat');
});

test('active mention conversation keeps every valid user/assistant turn without truncation', () => {
  const source=[];
  for(let i=0;i<20;i+=1){
    source.push({role:'user',content:'질문 '+i});
    source.push({role:'assistant',content:'답변 '+i});
  }
  const result=normalizeMentionConversation(source);
  assert.equal(result.length,40);
  assert.deepEqual(result[0],{role:'user',text:'질문 0'});
  assert.deepEqual(result[39],{role:'assistant',text:'답변 19'});
});

test('student pseudonyms continue beyond Z for a long mention conversation', () => {
  assert.equal(studentLabel(0),'학생A');
  assert.equal(studentLabel(25),'학생Z');
  assert.equal(studentLabel(26),'학생AA');
  assert.equal(studentLabel(27),'학생AB');
});

test('context resolver anonymizes the full active mention conversation and restores standalone follow-up', async () => {
  let observed=null;
  const conversation=[
    {role:'user',content:'테스트 학생의 시간표를 알려줘'},
    {role:'assistant',content:'2026-10-02 기준으로 테스트 학생의 정규 수업이 없습니다.'},
  ];
  for(let i=0;i<12;i+=1){
    conversation.push({role:'user',content:'중간 질문 '+i});
    conversation.push({role:'assistant',content:'중간 답변 '+i});
  }

  const result=await resolveContextualReadRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:99,
    currentMessage:'테스트2학생은?',
    conversation,
    loadStudents:async()=>[
      {id:'student-1',name:'테스트 학생'},
      {id:'student-2',name:'테스트2학생'},
    ],
    modelRunner:async(input)=>{
      observed=input;
      return '학생B의 시간표를 알려줘';
    },
  });

  assert.ok(observed);
  assert.match(observed.transcript,/학생A/);
  assert.doesNotMatch(observed.transcript,/테스트 학생/);
  assert.match(observed.transcript,/중간 질문 11/);
  assert.match(observed.currentText,/학생B/);
  assert.doesNotMatch(observed.currentText,/테스트2학생/);
  assert.equal(result.usedContext,true);
  assert.equal(result.resolvedText,'테스트2학생의 시간표를 알려줘');
});

test('makeup continuation restores B반 into the prior complete makeup request', async () => {
  let observed=null;
  const result=await resolveContextualMakeupRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:30,
    currentMessage:'B반',
    conversation:[
      {role:'user',content:'테스트2 학생 다음주 화요일 4시 보강 등록'},
      {role:'assistant',content:'A반과 B반 중 어느 반으로 보강을 진행할까요?'},
    ],
    loadStudents:async()=>[
      {id:'student-2',name:'테스트2 학생'},
    ],
    modelRunner:async(input)=>{
      observed=input;
      return '학생A 다음주 화요일 4시 B반 보강 등록';
    },
  });

  assert.ok(observed);
  assert.match(observed.transcript,/학생A 다음주 화요일 4시 보강 등록/);
  assert.match(observed.currentText,/B반/);
  assert.equal(result.usedContext,true);
  assert.equal(result.resolvedText,'테스트2 학생 다음주 화요일 4시 B반 보강 등록');
});

test('makeup continuation restores a changed date after a blocked makeup result', async () => {
  const result=await resolveContextualMakeupRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:31,
    currentMessage:'그럼 다다음주로 해줘',
    conversation:[
      {role:'user',content:'테스트 학생 다음주 월요일 5시에 보강 등록해줘'},
      {role:'assistant',content:'공휴일에는 보강을 등록할 수 없습니다.'},
    ],
    loadStudents:async()=>[
      {id:'student-1',name:'테스트 학생'},
    ],
    modelRunner:async()=> '학생A 다다음주 월요일 5시 보강 등록',
  });

  assert.equal(result.usedContext,true);
  assert.equal(result.resolvedText,'테스트 학생 다다음주 월요일 5시 보강 등록');
});

test('makeup continuation can reject an unrelated reply without hijacking general chat', async () => {
  const result=await resolveContextualMakeupRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:32,
    currentMessage:'오늘 비 와?',
    conversation:[
      {role:'user',content:'테스트 학생 다음주 화요일 4시 보강 등록'},
      {role:'assistant',content:'A반과 B반 중 어느 반으로 보강을 진행할까요?'},
    ],
    loadStudents:async()=>[
      {id:'student-1',name:'테스트 학생'},
    ],
    modelRunner:async()=> 'OLLI_CONTEXT_UNRELATED',
  });

  assert.equal(result.usedContext,false);
  assert.equal(result.resolvedText,'오늘 비 와?');
});

test('context resolver does not call AI without an active mention conversation containing an Olli reply', async () => {
  let called=false;
  const result=await resolveContextualReadRewrite({
    requestContext:{
      sessionToken:'session',
      academyId:'academy',
      memberId:'member-a',
    },
    sourceMessageId:2,
    currentMessage:'테스트2학생은?',
    conversation:[
      {role:'user',content:'테스트 학생 시간표 알려줘'},
    ],
    loadStudents:async()=>[],
    modelRunner:async()=>{
      called=true;
      return 'should not run';
    },
  });

  assert.equal(called,false);
  assert.equal(result.usedContext,false);
  assert.equal(result.resolvedText,'테스트2학생은?');
});

test('PC and Mobile record every AI turn while their persistent Olli conversation is active', () => {
  const root=path.resolve(__dirname,'..');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');

  assert.doesNotMatch(mobile,/olliTalkAiConversationMessages\.slice\(-12\)/);
  assert.match(
    mobile,
    /recordOlliTalkAiConversationTurn\(commandText, turn\.replyText\);/
  );
  assert.match(
    pc,
    /recordAiConversationTurn\(commandText, turn\.replyText\);/
  );
  assert.match(mobile,/conversation:olliTalkAiConversationMessages\.map/);
  assert.match(pc,/conversation:state\.aiConversationMessages\.map/);
});


test('makeup context stays active for both clarification and recoverable blocked replies', () => {
  const root=path.resolve(__dirname,'..');
  const api=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');

  const branch=api.indexOf("if (mode === 'context_makeup_prepare')");
  const resolver=api.indexOf('resolveContextualMakeupRewrite',branch);
  const classify=api.indexOf("safeText(route?.key,40)!=='makeup_add'",branch);
  assert.ok(branch>=0 && resolver>branch && classify>resolver);
  assert.match(mobile,/olliTalkPendingMakeupDialogue=\{ active:true, status:interactionStatus, prompt:aiReply \};/);
  assert.match(pc,/state\.pendingMakeupDialogue=\{ active:true, status:interactionStatus, prompt:aiReply \};/);
});

test('PC and Mobile use one unified interpreter before rule or Agent routing', () => {
  const root=path.resolve(__dirname,'..');
  const api=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
  const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
  const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');

  const interpretBranch=api.indexOf("if (mode === 'interpret')");
  const validateIndex=api.indexOf('validatePickupSourceMessage({',interpretBranch);
  const resolverIndex=api.indexOf('resolveOlliSystemInterpretation',interpretBranch);
  assert.ok(interpretBranch>=0 && validateIndex>interpretBranch && resolverIndex>validateIndex);

  for(const source of [mobile,pc]){
    const resolveName=source===mobile ? 'async function resolveOlliTalkAiTurn' : 'async function resolveAiTurn';
    const start=source.indexOf(resolveName);
    const end=source===mobile
      ? source.indexOf('function getOlliTalkMentionMessageText',start)
      : source.indexOf('function updateComposerState',start);
    const block=source.slice(start,end);
    assert.match(source,/mode:'interpret'/);
    assert.doesNotMatch(block,/mode:'context_read'/);
    assert.doesNotMatch(block,/mode:'context_resolve'/);
    const interpret=block.indexOf('interpretOlli');
    const classify=block.indexOf('routeClassifier.classify(commandText,{router})');
    const prepare=block.search(/router\.prepareAction/);
    assert.ok(interpret>=0 && classify>interpret && prepare>interpret);
    assert.match(block,/sharedRoute=interpreterRoute==='agent'/);
    assert.match(block,/if\(interpreterRoute==='rule'\)/);
  }
});

