const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('olli-command-schedule-common.js', 'utf8');

function loadSchedule(weekData, calendarDays = [], options = {}) {
  const calls = options.calls || {};
  const service = {
    async loadWeek() { return weekData; },
    async loadCalendarRange() { return calendarDays; },
    async addMakeup() {
      calls.addMakeup = Array.from(arguments);
      return options.addMakeupResult || { ok:true, result:'scheduled' };
    },
    async changeSchedule(payload) {
      calls.changeSchedule = payload;
      return options.changeScheduleResult || { ok:true, result:'applied' };
    },
    async activeStudents() { return []; }
  };
  const sandbox = {
    window: {
      OlliTimetableService: service,
      getKinderChatFeedbackSaveStudentCandidates(name) {
        const students = Array.isArray(options.students) ? options.students : [];
        return students.filter(student => String(student.name || '').trim() === String(name || '').trim());
      },
      dispatchEvent() {}
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Date,
    console
  };
  vm.runInNewContext(source, sandbox);
  return { schedule:sandbox.window.OlliCommandSchedule, calls, sandbox };
}

test('available slots count regular, makeup, and trial sessions against the same capacity', async () => {
  const week = {
    elementary_capacity: 5,
    kinder_capacity: 5,
    class_splits: [{ weekday: 5, time_slot: 5 }],
    kinder_class_merges: [{ weekday: 5, time_slot: 5 }],
    enrollments: [
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'B', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'B', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'B', effective_from:'2026-01-01' },
      { division:'elementary', weekday:5, time_slot:5, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' },
      { division:'kinder', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions: [
      { division:'elementary', session_date:'2026-09-18', time_slot:4, class_group:'A', session_type:'trial', status:'scheduled' },
      { division:'elementary', session_date:'2026-09-18', time_slot:5, class_group:'A', session_type:'makeup', status:'scheduled' }
    ],
    class_teachers: [
      { division:'elementary', weekday:5, time_slot:6, class_group:'A', teacher_name:'김다미' }
    ]
  };

  const { schedule } = loadSchedule(week);
  const result = await schedule.findAvailableSlots({ date:'2026-09-18' });
  const key = slot => `${slot.division}|${slot.timeSlot}|${slot.classGroup}`;
  const byKey = new Map(result.slots.map(slot => [key(slot), slot]));

  assert.equal(byKey.get('elementary|4|A').remaining, 1);
  assert.equal(byKey.get('elementary|5|A').remaining, 3);
  assert.equal(byKey.get('elementary|5|B').remaining, 1);
  assert.equal(byKey.get('elementary|6|A').remaining, 5);
  assert.equal(byKey.get('kinder|4|A').remaining, 1);
  assert.equal(byKey.has('kinder|4|B'), false);
  assert.equal(byKey.get('kinder|5|A').remaining, 3);
});

test('closed calendar day returns no available classes', async () => {
  const { schedule } = loadSchedule({ elementary_capacity:5, kinder_capacity:5 }, [
    { session_date:'2026-09-18', is_holiday:true, name:'휴원' }
  ]);
  const result = await schedule.findAvailableSlots({ date:'2026-09-18' });
  assert.equal(result.closedDay, true);
  assert.equal(result.slots.length, 0);
  assert.match(schedule.describeAvailableSlots(result), /정상 수업이 없어요/);
});


test('availability response uses the requested date label instead of always saying today', async () => {
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { division:'elementary', weekday:1, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    class_teachers:[]
  };
  const { schedule } = loadSchedule(week);
  const result = await schedule.findAvailableSlots({
    date:'2026-09-21',
    dateLabel:'다음주월요일',
    division:'elementary',
    purpose:'makeup'
  });
  const message = schedule.describeAvailableSlots(result);
  assert.match(message, /^다음주월요일 보강 가능한 클래스예요\./);
  assert.doesNotMatch(message, /^오늘/);
});


test('prepare makeup write resolves student and checks an open target before confirmation', async () => {
  const student = { id:'student-1', name:'김태리', division:'elementary' };
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { id:'e1', student_id:'other-1', division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    class_teachers:[
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', teacher_name:'담임' }
    ]
  };
  const { schedule } = loadSchedule(week, [], { students:[student] });
  const prepared = await schedule.prepareWriteCommand('add_makeup', {
    studentName:'김태리',
    date:'2026-09-18',
    dateLabel:'오늘',
    timeSlot:4
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.intent, 'add_makeup');
  assert.equal(prepared.command.studentId, 'student-1');
  assert.equal(prepared.command.sessionDate, '2026-09-18');
  assert.equal(prepared.command.timeSlot, 4);
  assert.equal(prepared.command.classGroup, 'A');
  assert.match(prepared.message, /확인/);
});

test('prepare move write finds one source enrollment and keeps its class group when available', async () => {
  const student = { id:'student-1', name:'최민기', division:'elementary' };
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    class_splits:[{ weekday:3, time_slot:4 }],
    enrollments:[
      { id:'source-1', student_id:'student-1', student_name:'최민기', division:'elementary', weekday:1, time_slot:4, class_group:'B', effective_from:'2026-01-01' },
      { id:'other-1', student_id:'other-1', division:'elementary', weekday:3, time_slot:4, class_group:'B', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    class_teachers:[
      { division:'elementary', weekday:3, time_slot:4, class_group:'A', teacher_name:'A담임' },
      { division:'elementary', weekday:3, time_slot:4, class_group:'B', teacher_name:'B담임' }
    ]
  };
  const { schedule } = loadSchedule(week, [], { students:[student] });
  const prepared = await schedule.prepareWriteCommand('move_class', {
    studentName:'최민기',
    sourceWeekday:1,
    targetWeekday:3,
    targetTimeSlot:4,
    effectiveDate:'2026-09-18'
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.intent, 'move_class');
  assert.equal(prepared.command.sourceEnrollmentId, 'source-1');
  assert.equal(prepared.command.targetClassGroup, 'B');
  assert.equal(prepared.command.effectiveDate, '2026-09-18');
  assert.match(prepared.message, /월요일 4시/);
  assert.match(prepared.message, /수요일 4시 B반/);
});

test('move write does not silently waitlist and uses existing timetable change service', async () => {
  const calls = {};
  const { schedule } = loadSchedule({}, [], { calls });
  const result = await schedule.executePreparedWrite({
    intent:'move_class',
    studentId:'student-1',
    studentName:'최민기',
    sourceEnrollmentId:'source-1',
    sourceWeekday:1,
    sourceTimeSlot:4,
    targetWeekday:3,
    targetTimeSlot:4,
    targetClassGroup:'A',
    effectiveDate:'2026-09-18'
  });

  assert.equal(result.result, 'applied');
  assert.equal(calls.changeSchedule.studentId, 'student-1');
  assert.equal(calls.changeSchedule.sourceEnrollmentId, 'source-1');
  assert.equal(calls.changeSchedule.changeType, 'move');
  assert.equal(calls.changeSchedule.allowWait, false);
});

test('makeup write uses existing timetable addMakeup service', async () => {
  const calls = {};
  const { schedule } = loadSchedule({}, [], { calls });
  const result = await schedule.executePreparedWrite({
    intent:'add_makeup',
    studentId:'student-1',
    studentName:'김태리',
    sessionDate:'2026-09-18',
    timeSlot:4,
    classGroup:'A'
  });

  assert.equal(result.result, 'scheduled');
  assert.deepEqual(calls.addMakeup, ['student-1', '2026-09-18', 4, '', 'A']);
});

test('ambiguous duplicate student name is blocked before any write command is prepared', async () => {
  const students = [
    { id:'student-1', name:'김태리', division:'elementary' },
    { id:'student-2', name:'김태리', division:'kinder' }
  ];
  const { schedule } = loadSchedule({}, [], { students });
  const prepared = await schedule.prepareWriteCommand('add_makeup', {
    studentName:'김태리',
    date:'2026-09-18',
    timeSlot:4
  });

  assert.equal(prepared.ok, false);
  assert.match(prepared.message, /여러 명/);
});
