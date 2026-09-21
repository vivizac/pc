const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const routerSource = fs.readFileSync('olli-command-router-common.js', 'utf8');
const scheduleSource = fs.readFileSync('olli-command-schedule-common.js', 'utf8');

function loadRouter(scheduleStub) {
  const sandbox = { window:{}, console, Date };
  if (scheduleStub) sandbox.window.OlliCommandSchedule = scheduleStub;
  vm.runInNewContext(routerSource, sandbox);
  return sandbox.window.OlliCommandRouter;
}

function loadSchedule(options = {}) {
  const week = options.week || {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[],
    one_time_sessions:[],
    attendance_overrides:[],
    class_teachers:[],
    class_splits:[],
    kinder_class_merges:[]
  };
  const students = options.students || [];
  const service = {
    async loadWeek() { return week; },
    async loadAvailabilityHorizon() { return week; },
    async loadCalendarRange() { return []; },
    async activeStudents() { return students; }
  };
  const sandbox = {
    window:{
      OlliTimetableService:service,
      getKinderChatFeedbackSaveStudentCandidates(name) {
        return students.filter(student => String(student.name || '').trim() === String(name || '').trim());
      },
      dispatchEvent() {}
    },
    CustomEvent:function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    console,
    Date
  };
  vm.runInNewContext(scheduleSource, sandbox);
  return sandbox.window.OlliCommandSchedule;
}

test('generic dated class registration is recognized as a one-time mutation', () => {
  const router = loadRouter();
  const parsed = router.parseClassMutationIntent('김민서 10월 4일 초등부 5시 수업 등록해줘');

  assert.ok(parsed);
  assert.equal(parsed.type, 'mutation');
  assert.equal(parsed.intent, 'add_class_once');
  assert.equal(parsed.studentName, '김민서');
  assert.equal(parsed.division, 'elementary');
  assert.equal(parsed.dateSpec.mode, 'month_day');
  assert.equal(parsed.dateSpec.month, 10);
  assert.equal(parsed.dateSpec.day, 4);
  assert.equal(parsed.timeSlot, 5);
});

test('request classification separates writes, reads, and ordinary conversation', () => {
  const router = loadRouter();

  const write = router.classifyRequest('김민서 10월 5일 초등부 5시 클래스 등록해줘');
  const read = router.classifyRequest('10월 5일 초등부 5시 자리 있어?');
  const other = router.classifyRequest('오늘 수업에서 집중을 잘했어요');

  assert.equal(write.type, 'mutation');
  assert.equal(write.intent, 'add_class_once');
  assert.equal(read.type, 'query');
  assert.equal(read.intent, 'find_available_slots');
  assert.equal(other.type, 'other');
});

test('prepareAction prepares a pending action and never executes the write', async () => {
  let preparedIntent = '';
  let executed = 0;
  const router = loadRouter({
    async prepareWriteCommand(intent, options) {
      preparedIntent = intent;
      return {
        ok:true,
        command:{
          intent,
          studentId:'student-1',
          studentName:'김민서',
          division:'elementary',
          sessionDate:'2026-10-05',
          timeSlot:5,
          classGroup:'A'
        },
        message:'김민서 · 10월 5일 5시\n이 수업에 등록할까요?'
      };
    },
    async executePreparedWrite() {
      executed += 1;
      return { ok:true };
    },
    writeConfirmationMessage() {
      return '';
    }
  });

  const result = await router.prepareAction('김민서 10월 5일 초등부 5시 수업 등록해줘', {
    source:'team_talk'
  });

  assert.equal(preparedIntent, 'add_class_once');
  assert.equal(result.handled, true);
  assert.equal(result.kind, 'action_pending');
  assert.equal(result.action.status, 'pending');
  assert.equal(result.action.intent, 'add_class_once');
  assert.equal(result.action.requiresReason, false);
  assert.equal(result.payload.studentId, 'student-1');
  assert.equal(executed, 0);
});

test('one-time class preparation resolves the student and checks the requested class seat', async () => {
  const student = { id:'student-1', name:'김민서', division:'elementary' };
  const schedule = loadSchedule({
    students:[student],
    week:{
      elementary_capacity:5,
      kinder_capacity:5,
      enrollments:[
        { student_id:'other-1', division:'elementary', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' },
        { student_id:'other-2', division:'elementary', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' }
      ],
      one_time_sessions:[],
      attendance_overrides:[],
      class_teachers:[],
      class_splits:[],
      kinder_class_merges:[]
    }
  });

  const prepared = await schedule.prepareWriteCommand('add_class_once', {
    studentName:'김민서',
    division:'elementary',
    date:'2026-09-25',
    dateLabel:'9월 25일',
    timeSlot:5
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.intent, 'add_class_once');
  assert.equal(prepared.command.studentId, 'student-1');
  assert.equal(prepared.command.sessionDate, '2026-09-25');
  assert.equal(prepared.command.timeSlot, 5);
  assert.equal(prepared.command.classGroup, 'A');
  assert.match(prepared.message, /이 수업에 등록할까요/);
});

test('one-time class preparation rejects a division mismatch before any write', async () => {
  const student = { id:'student-1', name:'김민서', division:'elementary' };
  const schedule = loadSchedule({ students:[student] });

  const prepared = await schedule.prepareWriteCommand('add_class_once', {
    studentName:'김민서',
    division:'kinder',
    date:'2026-09-25',
    timeSlot:5
  });

  assert.equal(prepared.ok, false);
  assert.match(prepared.message, /소속과 요청한 수업 구분이 달라요/);
});
