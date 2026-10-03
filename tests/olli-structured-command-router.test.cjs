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
