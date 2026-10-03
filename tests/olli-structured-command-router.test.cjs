'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const router = require('../packages/common/olli-command-router-common.js');
const root = path.resolve(__dirname,'..');
const contextRouteSource = fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const runtimeSource = fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const apiSource = fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
const pcSource = fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobileSource = fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('structured add_makeup bypasses natural-language parsing and reaches existing schedule SOT', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;
  let observed = null;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      observed = { intent, options };
      return {
        ok:true,
        command:{
          intent:'add_makeup',
          studentId:'student-1',
          studentName:'민준',
          division:'elementary',
          sessionDate:'2026-10-07',
          timeSlot:5,
          classGroup:'B',
        },
        message:'민준 · 10월 7일 5시 B반\n보강으로 등록할까요?',
      };
    },
    writeConfirmationMessage() {
      return '민준 · 10월 7일 5시 B반\n보강으로 등록할까요?';
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_makeup',
      studentName:'민준',
      dateExpression:'10월 7일',
      timeSlot:5,
      classGroup:'B',
    }, {
      source:'test',
      selectedStudent:null,
    });

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'add_makeup');
    assert.equal(result.payload.intent,'add_makeup');

    assert.ok(observed);
    assert.equal(observed.intent,'add_makeup');
    assert.equal(observed.options.studentName,'민준');
    assert.equal(observed.options.timeSlot,5);
    assert.equal(observed.options.classGroup,'B');
    assert.equal(observed.options.dateSpec.mode,'month_day');
    assert.equal(observed.options.dateSpec.month,10);
    assert.equal(observed.options.dateSpec.day,7);
    assert.ok(observed.options.date instanceof Date);
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured write draft core orders missing add fields without requiring A/B early', () => {
  const state = router.getStructuredWriteDraftState({
    action:'add_makeup',
    student_name:'민준',
    date_expression:'',
    time_slot:0,
    class_group:'',
  });

  assert.equal(state.supported,true);
  assert.deepEqual(state.requiredFields,['student','date','time']);
  assert.deepEqual(state.missingFields,['date','time']);
  assert.equal(state.nextField,'date');
  assert.equal(state.complete,false);
  assert.equal(state.draft.studentName,'민준');
  assert.equal(state.draft.classGroup,'');
});

test('structured write draft core advances one missing field at a time and preserves normalized command facts', () => {
  let draft = router.createStructuredWriteDraft({
    action:'add_trial',
    studentName:'서준',
    division:'elementary',
    class_group:'b',
  });

  let state = router.getStructuredWriteDraftState(draft);
  assert.equal(state.nextField,'date');

  draft = router.updateStructuredWriteDraft(draft,'date','내일');
  state = router.getStructuredWriteDraftState(draft);
  assert.deepEqual(state.missingFields,['time']);
  assert.equal(state.nextField,'time');

  draft = router.updateStructuredWriteDraft(draft,'time',5);
  state = router.getStructuredWriteDraftState(draft);
  assert.equal(state.complete,true);
  assert.equal(state.nextField,'');
  assert.equal(state.draft.dateExpression,'내일');
  assert.equal(state.draft.timeSlot,5);
  assert.equal(state.draft.classGroup,'B');
  assert.equal(state.draft.division,'elementary');
});

test('structured write draft core stays inert for actions not migrated to the common draft flow yet', () => {
  const state = router.getStructuredWriteDraftState({
    action:'update_pickup',
    studentName:'민준',
  });

  assert.equal(state.supported,false);
  assert.equal(state.complete,false);
  assert.deepEqual(state.requiredFields,[]);
  assert.deepEqual(state.missingFields,[]);
});

test('structured command adapter does not claim unsupported actions', async () => {
  const result = await router.prepareStructuredAction({
    action:'update_trial',
    studentName:'민준',
  }, {});

  assert.equal(result.handled,false);
  assert.equal(result.kind,'pass_through');
});

test('structured add_makeup rejects missing conversational facts without inventing them', async () => {
  const result = await router.prepareStructuredAction({
    action:'add_makeup',
    studentName:'민준',
    dateExpression:'',
    timeSlot:5,
    classGroup:'',
  }, {});

  assert.equal(result.handled,true);
  assert.equal(result.kind,'action_rejected');
  assert.match(result.message,/학생, 날짜, 시간이 필요/);
});

test('structured add_makeup surfaces a persisted A/B choice instead of rejecting the command', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      assert.equal(intent,'add_makeup');
      assert.equal(options.studentName,'민준');
      assert.equal(options.classGroup,'');
      return {
        ok:false,
        code:'class_group_required',
        choices:['A','B'],
        commandDraft:{
          intent:'choose_makeup_group',
          targetIntent:'add_makeup',
          studentId:'student-1',
          studentName:'민준',
          division:'elementary',
          sessionDate:'2026-10-07',
          timeSlot:5,
          classGroup:'',
          allowedClassGroups:['A','B'],
        },
        message:'민준 · 10월 7일 5시\n반을 선택해 주세요.',
      };
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_makeup',
      studentName:'민준',
      dateExpression:'10월 7일',
      timeSlot:5,
      classGroup:'',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_choice');
    assert.equal(result.intent,'choose_makeup_group');
    assert.equal(result.payload.intent,'choose_makeup_group');
    assert.equal(result.payload.targetIntent,'add_makeup');
    assert.deepEqual(result.payload.allowedClassGroups,['A','B']);
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured add_trial bypasses natural-language parsing and reaches existing schedule SOT', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;
  let observed = null;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      observed = { intent, options };
      return {
        ok:true,
        command:{
          intent:'add_trial',
          guestName:'서준',
          studentName:'서준',
          division:'elementary',
          sessionDate:'2026-10-09',
          timeSlot:5,
          classGroup:'A',
        },
        message:'서준 · 10월 9일 5시 A반\n체험수업으로 등록할까요?',
      };
    },
    writeConfirmationMessage() {
      return '서준 · 10월 9일 5시 A반\n체험수업으로 등록할까요?';
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_trial',
      studentName:'서준',
      division:'elementary',
      dateExpression:'10월 9일',
      timeSlot:5,
      classGroup:'A',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'add_trial');
    assert.equal(result.payload.intent,'add_trial');

    assert.ok(observed);
    assert.equal(observed.intent,'add_trial');
    assert.equal(observed.options.guestName,'서준');
    assert.equal(observed.options.studentName,'서준');
    assert.equal(observed.options.division,'elementary');
    assert.equal(observed.options.timeSlot,5);
    assert.equal(observed.options.classGroup,'A');
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured add_trial surfaces a persisted A/B choice instead of asking for typed A/B', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      assert.equal(intent,'add_trial');
      assert.equal(options.guestName,'서준');
      assert.equal(options.division,'elementary');
      return {
        ok:false,
        code:'class_group_required',
        choices:['A','B'],
        commandDraft:{
          intent:'choose_trial_group',
          targetIntent:'add_trial',
          guestName:'서준',
          studentName:'서준',
          division:'elementary',
          sessionDate:'2026-10-09',
          timeSlot:5,
          classGroup:'',
          allowedClassGroups:['A','B'],
        },
        message:'서준 · 10월 9일 5시\n반을 선택해 주세요.',
      };
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_trial',
      studentName:'서준',
      division:'elementary',
      dateExpression:'10월 9일',
      timeSlot:5,
      classGroup:'',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_choice');
    assert.equal(result.intent,'choose_trial_group');
    assert.equal(result.payload.intent,'choose_trial_group');
    assert.equal(result.payload.targetIntent,'add_trial');
    assert.deepEqual(result.payload.allowedClassGroups,['A','B']);
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured add_waitlist bypasses natural-language parsing and reaches existing schedule SOT', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;
  let observed = null;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      observed = { intent, options };
      return {
        ok:true,
        command:{
          intent:'add_waitlist',
          studentId:'',
          studentName:'지우',
          guestName:'지우',
          isGuest:true,
          division:'elementary',
          effectiveDate:'2026-10-08',
          sessionDate:'2026-10-08',
          targetWeekday:4,
          targetTimeSlot:4,
          targetClassGroup:'B',
        },
        message:'지우 (비재원) · 목요일 4시 B반\n대기로 등록할까요?',
      };
    },
    writeConfirmationMessage() {
      return '지우 (비재원) · 목요일 4시 B반\n대기로 등록할까요?';
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_waitlist',
      studentName:'지우',
      division:'elementary',
      dateExpression:'10월 8일',
      timeSlot:4,
      classGroup:'B',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'add_waitlist');
    assert.equal(result.payload.intent,'add_waitlist');

    assert.ok(observed);
    assert.equal(observed.intent,'add_waitlist');
    assert.equal(observed.options.studentName,'지우');
    assert.equal(observed.options.division,'elementary');
    assert.equal(observed.options.timeSlot,4);
    assert.equal(observed.options.classGroup,'B');
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured add_waitlist surfaces a persisted A/B choice instead of asking for typed A/B', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      assert.equal(intent,'add_waitlist');
      assert.equal(options.studentName,'지우');
      assert.equal(options.division,'elementary');
      return {
        ok:false,
        code:'class_group_required',
        choices:['A','B'],
        commandDraft:{
          intent:'choose_waitlist_group',
          targetIntent:'add_waitlist',
          studentId:'',
          studentName:'지우',
          guestName:'지우',
          isGuest:true,
          division:'elementary',
          effectiveDate:'2026-10-08',
          sessionDate:'2026-10-08',
          targetWeekday:4,
          targetTimeSlot:4,
          targetClassGroup:'',
          allowedClassGroups:['A','B'],
        },
        message:'지우 (비재원) · 목요일 4시\n반을 선택해 주세요.',
      };
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_waitlist',
      studentName:'지우',
      division:'elementary',
      dateExpression:'10월 8일',
      timeSlot:4,
      classGroup:'',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_choice');
    assert.equal(result.intent,'choose_waitlist_group');
    assert.equal(result.payload.intent,'choose_waitlist_group');
    assert.equal(result.payload.targetIntent,'add_waitlist');
    assert.deepEqual(result.payload.allowedClassGroups,['A','B']);
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured add_pickup passes class and pickup clocks directly to existing schedule SOT', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;
  let observed = null;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      observed = { intent, options };
      return {
        ok:true,
        command:{
          intent:'add_pickup',
          studentId:'student-1',
          studentName:'민서',
          division:'kinder',
          weekday:1,
          classTime:10,
          timetableMode:'half_hour',
          pickupLabel:'리슈빌',
          pickupTime:'15:30',
          dropoffLabel:'',
          effectiveDate:'2026-10-05',
          isDropoff:false,
        },
        message:'민서 · 월요일 4시 30분 수업\n리슈빌 · 3시 30분 · 등원 픽업\n등록할까요?',
      };
    },
    writeConfirmationMessage() {
      return '';
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_pickup',
      studentName:'민서',
      weekday:1,
      classTime:4,
      classMinute:30,
      pickupKind:'arrival',
      pickupLabel:'리슈빌',
      pickupTime:'15:30',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'add_pickup');
    assert.equal(result.payload.intent,'add_pickup');

    assert.ok(observed);
    assert.equal(observed.intent,'add_pickup');
    assert.equal(observed.options.studentName,'민서');
    assert.equal(observed.options.weekday,1);
    assert.equal(observed.options.classTime,4);
    assert.equal(observed.options.classMinute,30);
    assert.equal(observed.options.pickupLabel,'리슈빌');
    assert.equal(observed.options.pickupTime,'15:30');
    assert.equal(observed.options.isDropoff,false);
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured add_pickup preserves dropoff semantics without inventing pickup time', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;
  let observed = null;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      observed = { intent, options };
      return {
        ok:true,
        command:{
          intent:'add_pickup',
          studentId:'student-1',
          studentName:'민서',
          division:'kinder',
          weekday:1,
          classTime:4,
          timetableMode:'hourly',
          pickupLabel:'',
          pickupTime:'',
          dropoffLabel:'정문',
          effectiveDate:'2026-10-05',
          isDropoff:true,
        },
        message:'민서 · 월요일 4시 수업\n정문 · 하원 픽업\n등록할까요?',
      };
    },
    writeConfirmationMessage() {
      return '';
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_pickup',
      studentName:'민서',
      weekday:1,
      classTime:4,
      classMinute:0,
      pickupKind:'dropoff',
      pickupLabel:'정문',
      pickupTime:'',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.ok(observed);
    assert.equal(observed.options.isDropoff,true);
    assert.equal(observed.options.pickupLabel,'정문');
    assert.equal(observed.options.pickupTime,'');
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured add_pickup bypasses natural-language parsing and reaches existing pickup SOT', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;
  let observed = null;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      observed = { intent, options };
      return {
        ok:true,
        command:{
          intent:'add_pickup',
          studentId:'student-1',
          studentName:'민서',
          division:'kinder',
          weekday:1,
          classTime:4,
          timetableMode:'hour',
          pickupLabel:'리슈빌',
          pickupTime:'15:30',
          dropoffLabel:'',
          effectiveDate:'2026-10-05',
          isDropoff:false,
        },
        message:'민서 · 월요일 4시 수업\n리슈빌 · 3시 30분 · 등원 픽업\n등록할까요?',
      };
    },
    writeConfirmationMessage() {
      return '';
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_pickup',
      studentName:'민서',
      weekday:1,
      classTime:4,
      classMinute:0,
      pickupKind:'arrival',
      pickupLabel:'리슈빌',
      pickupTime:'15:30',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'add_pickup');
    assert.equal(result.payload.intent,'add_pickup');

    assert.ok(observed);
    assert.equal(observed.intent,'add_pickup');
    assert.equal(observed.options.studentName,'민서');
    assert.equal(observed.options.weekday,1);
    assert.equal(observed.options.classTime,4);
    assert.equal(observed.options.classMinute,0);
    assert.equal(observed.options.pickupLabel,'리슈빌');
    assert.equal(observed.options.pickupTime,'15:30');
    assert.equal(observed.options.isDropoff,false);
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured pickup preserves deterministic update intent when an existing pickup card is found', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      assert.equal(intent,'add_pickup');
      assert.equal(options.studentName,'민서');
      return {
        ok:true,
        command:{
          intent:'update_pickup_arrival',
          studentId:'student-1',
          studentName:'민서',
          pickupId:'pickup-1',
          weekday:1,
          classTime:4,
          pickupLabel:'새 장소',
          pickupTime:'15:40',
        },
        message:'민서 학생은 이미 이 수업의 픽업 카드가 있어요.\n등원 픽업 새 장소 · 3시 40분을 저장할까요?',
      };
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'add_pickup',
      studentName:'민서',
      weekday:1,
      classTime:4,
      classMinute:0,
      pickupKind:'arrival',
      pickupLabel:'새 장소',
      pickupTime:'15:40',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'update_pickup_arrival');
    assert.equal(result.payload.intent,'update_pickup_arrival');
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured pickup does not invent missing pickup details', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      observed={intent,options};
      return {ok:false,message:'등원 픽업 등록은 학생 이름, 수업 요일·시간, 픽업 장소, 픽업 시간을 함께 적어 주세요.'};
    },
  };

  try {
    const result=await router.prepareStructuredAction({
      action:'add_pickup',
      studentName:'민서',
      weekday:1,
      classTime:4,
      classMinute:0,
      pickupKind:'arrival',
      pickupLabel:'',
      pickupTime:'',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_rejected');
    assert.match(result.message,/픽업 장소, 픽업 시간을 함께/);
    assert.equal(observed.options.pickupLabel,'');
    assert.equal(observed.options.pickupTime,'');
  } finally {
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured move_class reaches the existing schedule move SOT without reparsing Korean', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;
  let observed = null;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      observed = { intent, options };
      return {
        ok:true,
        command:{
          intent:'move_class',
          studentId:'student-1',
          studentName:'민준',
          division:'elementary',
          sourceEnrollmentId:'enrollment-1',
          sourceWeekday:1,
          sourceTimeSlot:4,
          targetWeekday:3,
          targetTimeSlot:5,
          targetClassGroup:'A',
          targetCheckDate:'2026-10-07',
          effectiveDate:'2026-10-03',
        },
        message:'민준 · 월요일 4시 → 수요일 5시 A반\n정규수업 시간을 변경할까요?',
      };
    },
    writeConfirmationMessage() {
      return '';
    },
  };

  try {
    const result = await router.prepareStructuredAction({
      action:'move_class',
      studentName:'민준',
      sourceWeekday:1,
      sourceTimeSlot:4,
      targetWeekday:3,
      targetTimeSlot:5,
      classGroup:'',
    }, {});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'move_class');
    assert.equal(result.payload.intent,'move_class');

    assert.ok(observed);
    assert.equal(observed.intent,'move_class');
    assert.equal(observed.options.studentName,'민준');
    assert.equal(observed.options.sourceWeekday,1);
    assert.equal(observed.options.sourceTimeSlot,4);
    assert.equal(observed.options.targetWeekday,3);
    assert.equal(observed.options.targetTimeSlot,5);
    assert.equal(observed.options.classGroup,'');
  } finally {
    globalThis.OlliCommandSchedule = previousSchedule;
  }
});

test('structured move_class surfaces an A/B choice without another AI turn', async () => {
  const previousSchedule = globalThis.OlliCommandSchedule;

  globalThis.OlliCommandSchedule = {
    async prepareWriteCommand(intent, options) {
      assert.equal(intent,'move_class');
      assert.equal(options.studentName,'민준');
      return {
        ok:false,
        code:'class_group_required',
        choices:['A','B'],
        commandDraft:{
          intent:'choose_move_group',
          targetIntent:'move_class',
          studentId:'student-1',
          studentName:'민준',
          division:'elementary',
          sourceEnrollmentId:'enrollment-1',
          sourceWeekday:1,
          sourceTimeSlot:4,
          targetWeekday:3,
          targetTimeSlot:5,
          targetClassGroup:'',
          targetCheckDate:'2026-10-07',
          effectiveDate:'2026-10-03',
          allowedClassGroups:['A','B'],
        },
        message:'민준 · 월요일 4시 → 수요일 5시\n이동할 반을 선택해 주세요.',
      };
    },
  };

  try {
    const result=await router.prepareStructuredAction({
      action:'move_class',
      studentName:'민준',
      sourceWeekday:1,
      sourceTimeSlot:4,
      targetWeekday:3,
      targetTimeSlot:5,
      classGroup:'',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_choice');
    assert.equal(result.intent,'choose_move_group');
    assert.equal(result.payload.intent,'choose_move_group');
    assert.equal(result.payload.targetIntent,'move_class');
    assert.deepEqual(result.payload.allowedClassGroups,['A','B']);
  } finally {
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured mark_absent passes a stated reason to the existing schedule SOT', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;
  let observed=null;

  globalThis.OlliCommandSchedule={
    async prepareWriteCommand(intent,options){
      observed={intent,options};
      return {
        ok:true,
        command:{
          intent:'mark_absent',
          studentId:'student-1',
          studentName:'민준',
          division:'elementary',
          sessionDate:'2026-10-03',
          timeSlot:4,
          classGroup:'A',
          reason:'감기',
        },
        message:'민준 · 10월 3일 4시 A반\n결석 처리할까요?',
      };
    },
    writeConfirmationMessage(){ return ''; },
  };

  try{
    const result=await router.prepareStructuredAction({
      action:'mark_absent',
      studentName:'민준',
      dateExpression:'오늘',
      timeSlot:4,
      classGroup:'',
      reason:'감기',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_pending');
    assert.equal(result.intent,'mark_absent');
    assert.equal(result.payload.reason,'감기');
    assert.ok(observed);
    assert.equal(observed.intent,'mark_absent');
    assert.equal(observed.options.studentName,'민준');
    assert.equal(observed.options.reason,'감기');
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});

test('structured mark_absent asks for a free-text reason without inventing one', async () => {
  const previousSchedule=globalThis.OlliCommandSchedule;

  globalThis.OlliCommandSchedule={
    async prepareWriteCommand(){
      return {
        ok:true,
        command:{
          intent:'mark_absent',
          studentId:'student-1',
          studentName:'민준',
          division:'elementary',
          sessionDate:'2026-10-03',
          timeSlot:4,
          classGroup:'A',
          reason:'',
        },
        message:'민준 · 10월 3일 4시 A반',
      };
    },
    writeReasonPrompt(){ return '민준 학생의 결석 사유를 알려주세요.'; },
  };

  try{
    const result=await router.prepareStructuredAction({
      action:'mark_absent',
      studentName:'민준',
      dateExpression:'오늘',
      timeSlot:4,
      classGroup:'',
      reason:'',
    },{});

    assert.equal(result.handled,true);
    assert.equal(result.kind,'action_needs_reason');
    assert.equal(result.intent,'mark_absent');
    assert.equal(result.payload.reason,'');
    assert.match(result.message,/결석 사유/);
  }finally{
    globalThis.OlliCommandSchedule=previousSchedule;
  }
});


test('structured update_makeup bypasses Agents SDK and reuses the deterministic makeup-update SOT', () => {
  assert.match(contextRouteSource,/update_makeup/);
  assert.match(contextRouteSource,/source_date_expression/);
  assert.match(contextRouteSource,/target_date_expression/);
  assert.match(contextRouteSource,/source_class_group/);
  assert.match(contextRouteSource,/target_class_group/);

  assert.match(apiSource,/structured_makeup_update_prepare/);
  assert.match(apiSource,/runStructuredMakeupUpdatePrepare/);

  const runtimeStart=runtimeSource.indexOf('async function runStructuredMakeupUpdatePrepare');
  const runtimeEnd=runtimeSource.indexOf('\nasync function ',runtimeStart+20);
  assert.ok(runtimeStart>=0 && runtimeEnd>runtimeStart);
  const runtimeBlock=runtimeSource.slice(runtimeStart,runtimeEnd);
  assert.match(runtimeBlock,/resolveStudentReferences/);
  assert.match(runtimeBlock,/prepareMakeupUpdateAction/);
  assert.match(runtimeBlock,/validateMakeupSourceMessage/);
  assert.doesNotMatch(runtimeBlock,/loadAgentsSdk|new Agent|runMakeupUpdatePrepareAgent/);

  for(const source of [pcSource,mobileSource]){
    assert.match(source,/structured_makeup_update_prepare/);
    assert.match(source,/structuredCommand/);
  }

  const pcStart=pcSource.indexOf('async function resolveStructuredMakeupUpdateTurn');
  const pcEnd=pcSource.indexOf('\n  async function ',pcStart+20);
  const pcBlock=pcSource.slice(pcStart,pcEnd);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  assert.match(pcBlock,/mode:'structured_makeup_update_prepare'/);
  assert.doesNotMatch(pcBlock,/mode:'makeup_update_prepare'/);

  const mobileStart=mobileSource.indexOf('async function resolveOlliTalkStructuredMakeupUpdateTurn');
  const mobileEnd=mobileSource.indexOf('\n  async function ',mobileStart+20);
  const mobileBlock=mobileSource.slice(mobileStart,mobileEnd);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  assert.match(mobileBlock,/mode:'structured_makeup_update_prepare'/);
  assert.doesNotMatch(mobileBlock,/mode:'makeup_update_prepare'/);
});


test('structured cancel_makeup bypasses Agents SDK and preserves source-bound reason validation', () => {
  assert.match(contextRouteSource,/cancel_makeup/);
  assert.match(apiSource,/structured_makeup_cancel_prepare/);
  assert.match(apiSource,/runStructuredMakeupCancelPrepare/);

  const runtimeStart=runtimeSource.indexOf('async function runStructuredMakeupCancelPrepare');
  const runtimeEnd=runtimeSource.indexOf('\nasync function ',runtimeStart+20);
  assert.ok(runtimeStart>=0 && runtimeEnd>runtimeStart);
  const runtimeBlock=runtimeSource.slice(runtimeStart,runtimeEnd);
  assert.match(runtimeBlock,/validateMakeupSourceMessage/);
  assert.match(runtimeBlock,/validateMakeupReasonMessage/);
  assert.match(runtimeBlock,/resolveStudentReferences/);
  assert.match(runtimeBlock,/prepareMakeupCancelAction/);
  assert.doesNotMatch(runtimeBlock,/loadAgentsSdk|new Agent|runMakeupCancelPrepareAgent/);

  for(const source of [pcSource,mobileSource]){
    assert.match(source,/structured_makeup_cancel_prepare/);
    assert.match(source,/__structuredMakeupCancel/);
    assert.match(source,/보강 취소 사유를 알려주세요/);
  }

  const pcStart=pcSource.indexOf('async function resolveStructuredMakeupCancelTurn');
  const pcEnd=pcSource.indexOf('\n  async function ',pcStart+20);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  const pcBlock=pcSource.slice(pcStart,pcEnd);
  assert.match(pcBlock,/mode:'structured_makeup_cancel_prepare'/);
  assert.doesNotMatch(pcBlock,/mode:'makeup_cancel_prepare'/);

  const mobileStart=mobileSource.indexOf('async function resolveOlliTalkStructuredMakeupCancelTurn');
  const mobileEnd=mobileSource.indexOf('\n  async function ',mobileStart+20);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  const mobileBlock=mobileSource.slice(mobileStart,mobileEnd);
  assert.match(mobileBlock,/mode:'structured_makeup_cancel_prepare'/);
  assert.doesNotMatch(mobileBlock,/mode:'makeup_cancel_prepare'/);
});


test('structured update_trial bypasses Agents SDK and reuses the deterministic trial-update SOT', () => {
  assert.match(contextRouteSource,/update_trial/);
  assert.match(contextRouteSource,/source_date_expression/);
  assert.match(contextRouteSource,/target_date_expression/);
  assert.match(apiSource,/structured_trial_update_prepare/);
  assert.match(apiSource,/runStructuredTrialUpdatePrepare/);

  const runtimeStart=runtimeSource.indexOf('async function runStructuredTrialUpdatePrepare');
  const runtimeEnd=runtimeSource.indexOf('\nasync function ',runtimeStart+20);
  assert.ok(runtimeStart>=0 && runtimeEnd>runtimeStart);
  const runtimeBlock=runtimeSource.slice(runtimeStart,runtimeEnd);
  assert.match(runtimeBlock,/validateTrialSourceMessage/);
  assert.match(runtimeBlock,/prepareTrialGuestPrivacyInput/);
  assert.match(runtimeBlock,/prepareTrialUpdateAction/);
  assert.doesNotMatch(runtimeBlock,/loadAgentsSdk|new Agent|runTrialUpdatePrepareAgent/);

  for(const source of [pcSource,mobileSource]){
    assert.match(source,/structured_trial_update_prepare/);
    assert.match(source,/structuredCommand/);
  }

  const pcStart=pcSource.indexOf('async function resolveStructuredTrialUpdateTurn');
  const pcEnd=pcSource.indexOf('\n  async function ',pcStart+20);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  const pcBlock=pcSource.slice(pcStart,pcEnd);
  assert.match(pcBlock,/mode:'structured_trial_update_prepare'/);
  assert.doesNotMatch(pcBlock,/mode:'trial_update_prepare'/);

  const mobileStart=mobileSource.indexOf('async function resolveOlliTalkStructuredTrialUpdateTurn');
  const mobileEnd=mobileSource.indexOf('\n  async function ',mobileStart+20);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  const mobileBlock=mobileSource.slice(mobileStart,mobileEnd);
  assert.match(mobileBlock,/mode:'structured_trial_update_prepare'/);
  assert.doesNotMatch(mobileBlock,/mode:'trial_update_prepare'/);
});


test('structured cancel_trial bypasses Agents SDK and preserves source-bound reason validation', () => {
  assert.match(contextRouteSource,/cancel_trial/);
  assert.match(apiSource,/structured_trial_cancel_prepare/);
  assert.match(apiSource,/runStructuredTrialCancelPrepare/);

  const runtimeStart=runtimeSource.indexOf('async function runStructuredTrialCancelPrepare');
  const runtimeEnd=runtimeSource.indexOf('\nasync function ',runtimeStart+20);
  assert.ok(runtimeStart>=0 && runtimeEnd>runtimeStart);
  const runtimeBlock=runtimeSource.slice(runtimeStart,runtimeEnd);
  assert.match(runtimeBlock,/validateTrialSourceMessage/);
  assert.match(runtimeBlock,/validateTrialReasonMessage/);
  assert.match(runtimeBlock,/prepareTrialCancelPrivacyInput/);
  assert.match(runtimeBlock,/prepareTrialCancelAction/);
  assert.doesNotMatch(runtimeBlock,/loadAgentsSdk|new Agent|runTrialCancelPrepareAgent/);

  for(const source of [pcSource,mobileSource]){
    assert.match(source,/structured_trial_cancel_prepare/);
    assert.match(source,/__structuredTrialCancel/);
    assert.match(source,/체험 취소 사유를 알려주세요/);
  }

  const pcStart=pcSource.indexOf('async function resolveStructuredTrialCancelTurn');
  const pcEnd=pcSource.indexOf('\n  async function ',pcStart+20);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  const pcBlock=pcSource.slice(pcStart,pcEnd);
  assert.match(pcBlock,/mode:'structured_trial_cancel_prepare'/);
  assert.doesNotMatch(pcBlock,/mode:'trial_cancel_prepare'/);

  const mobileStart=mobileSource.indexOf('async function resolveOlliTalkStructuredTrialCancelTurn');
  const mobileEnd=mobileSource.indexOf('\n  async function ',mobileStart+20);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  const mobileBlock=mobileSource.slice(mobileStart,mobileEnd);
  assert.match(mobileBlock,/mode:'structured_trial_cancel_prepare'/);
  assert.doesNotMatch(mobileBlock,/mode:'trial_cancel_prepare'/);
});


test('structured update_waitlist bypasses Agents SDK and reuses the deterministic waitlist-update SOT', () => {
  assert.match(contextRouteSource,/update_waitlist/);
  assert.match(contextRouteSource,/source_weekday/);
  assert.match(contextRouteSource,/target_weekday/);
  assert.match(apiSource,/structured_waitlist_update_prepare/);
  assert.match(apiSource,/runStructuredWaitlistUpdatePrepare/);

  const runtimeStart=runtimeSource.indexOf('async function runStructuredWaitlistUpdatePrepare');
  const runtimeEnd=runtimeSource.indexOf('\nasync function ',runtimeStart+20);
  assert.ok(runtimeStart>=0 && runtimeEnd>runtimeStart);
  const runtimeBlock=runtimeSource.slice(runtimeStart,runtimeEnd);
  assert.match(runtimeBlock,/validateWaitlistSourceMessage/);
  assert.match(runtimeBlock,/prepareStructuredWaitlistPrivacy/);
  assert.match(runtimeBlock,/resolveWaitlistUpdatePrepareScope/);
  assert.match(runtimeBlock,/prepareWaitlistUpdateAction/);
  assert.doesNotMatch(runtimeBlock,/loadAgentsSdk|new Agent|runWaitlistUpdatePrepareAgent/);

  const privacyStart=runtimeSource.indexOf('async function prepareStructuredWaitlistPrivacy');
  const privacyEnd=runtimeSource.indexOf('\nasync function ',privacyStart+20);
  assert.ok(privacyStart>=0 && privacyEnd>privacyStart);
  const privacyBlock=runtimeSource.slice(privacyStart,privacyEnd);
  assert.match(privacyBlock,/structuredCommand/);
  assert.match(privacyBlock,/studentName/);
  assert.match(privacyBlock,/prepareAgentPrivacyInput/);
  assert.match(privacyBlock,/prepareWaitlistGuestPrivacyInput/);
  assert.doesNotMatch(privacyBlock,/sourceMessageText/);

  for(const source of [pcSource,mobileSource]){
    assert.match(source,/structured_waitlist_update_prepare/);
    assert.match(source,/structuredCommand/);
  }

  const pcStart=pcSource.indexOf('async function resolveStructuredWaitlistUpdateTurn');
  const pcEnd=pcSource.indexOf('\n  async function ',pcStart+20);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  const pcBlock=pcSource.slice(pcStart,pcEnd);
  assert.match(pcBlock,/mode:'structured_waitlist_update_prepare'/);
  assert.doesNotMatch(pcBlock,/mode:'waitlist_update_prepare'/);

  const mobileStart=mobileSource.indexOf('async function resolveOlliTalkStructuredWaitlistUpdateTurn');
  const mobileEnd=mobileSource.indexOf('\n  async function ',mobileStart+20);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  const mobileBlock=mobileSource.slice(mobileStart,mobileEnd);
  assert.match(mobileBlock,/mode:'structured_waitlist_update_prepare'/);
  assert.doesNotMatch(mobileBlock,/mode:'waitlist_update_prepare'/);
});


test('structured cancel_waitlist bypasses Agents SDK and reuses the deterministic waitlist-cancel SOT', () => {
  assert.match(contextRouteSource,/cancel_waitlist/);
  assert.match(apiSource,/structured_waitlist_cancel_prepare/);
  assert.match(apiSource,/runStructuredWaitlistCancelPrepare/);

  const runtimeStart=runtimeSource.indexOf('async function runStructuredWaitlistCancelPrepare');
  const runtimeEnd=runtimeSource.indexOf('\nasync function ',runtimeStart+20);
  assert.ok(runtimeStart>=0 && runtimeEnd>runtimeStart);
  const runtimeBlock=runtimeSource.slice(runtimeStart,runtimeEnd);
  assert.match(runtimeBlock,/validateWaitlistSourceMessage/);
  assert.match(runtimeBlock,/prepareStructuredWaitlistCancelPrivacy/);
  assert.match(runtimeBlock,/resolveWaitlistCancelPrepareScope/);
  assert.match(runtimeBlock,/prepareWaitlistCancelAction/);
  assert.doesNotMatch(runtimeBlock,/loadAgentsSdk|new Agent|runWaitlistCancelPrepareAgent/);

  const privacyStart=runtimeSource.indexOf('async function prepareStructuredWaitlistCancelPrivacy');
  const privacyEnd=runtimeSource.indexOf('\nfunction structuredWaitlistCancelDateKey',privacyStart+20);
  assert.ok(privacyStart>=0 && privacyEnd>privacyStart);
  const privacyBlock=runtimeSource.slice(privacyStart,privacyEnd);
  assert.match(privacyBlock,/studentName/);
  assert.match(privacyBlock,/prepareAgentPrivacyInput/);
  assert.match(privacyBlock,/prepareWaitlistGuestPrivacyInput/);
  assert.doesNotMatch(privacyBlock,/sourceMessageText/);

  const dateStart=runtimeSource.indexOf('function structuredWaitlistCancelDateKey');
  const dateEnd=runtimeSource.indexOf('\nasync function ',dateStart+20);
  assert.ok(dateStart>=0 && dateEnd>dateStart);
  const dateBlock=runtimeSource.slice(dateStart,dateEnd);
  assert.match(dateBlock,/dateExpression/);
  assert.match(dateBlock,/weekday/);
  assert.match(dateBlock,/nextOccurrenceOnOrAfter/);

  const pcStart=pcSource.indexOf('async function resolveWaitlistCancelAgentTurn');
  const pcEnd=pcSource.indexOf('\n  async function ',pcStart+20);
  assert.ok(pcStart>=0 && pcEnd>pcStart);
  const pcBlock=pcSource.slice(pcStart,pcEnd);
  assert.match(pcBlock,/structuredCommand/);
  assert.match(pcBlock,/structured_waitlist_cancel_prepare/);
  assert.match(pcBlock,/waitlist_cancel_prepare/);

  const mobileStart=mobileSource.indexOf('async function resolveOlliTalkWaitlistCancelAgentTurn');
  const mobileEnd=mobileSource.indexOf('\n  async function ',mobileStart+20);
  assert.ok(mobileStart>=0 && mobileEnd>mobileStart);
  const mobileBlock=mobileSource.slice(mobileStart,mobileEnd);
  assert.match(mobileBlock,/structuredCommand/);
  assert.match(mobileBlock,/structured_waitlist_cancel_prepare/);
  assert.match(mobileBlock,/waitlist_cancel_prepare/);

  assert.match(pcSource,/structuredCommand\?\.action\)===\'cancel_waitlist\'/);
  assert.match(mobileSource,/structuredCommand\?\.action \|\| \'\'\)\.trim\(\)===\'cancel_waitlist\'/);
});
