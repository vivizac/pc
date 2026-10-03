'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const router = require('../packages/common/olli-command-router-common.js');

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
