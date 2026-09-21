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
    async loadAvailabilityHorizon() {
      return options.horizonData || weekData;
    },
    async addMakeup() {
      calls.addMakeup = Array.from(arguments);
      return options.addMakeupResult || { ok:true, result:'scheduled' };
    },
    async changeSchedule(payload) {
      calls.changeSchedule = payload;
      return options.changeScheduleResult || { ok:true, result:'applied' };
    },
    async addWaitlist(payload) {
      calls.addWaitlist = payload;
      return options.addWaitlistResult || { ok:true, result:'scheduled' };
    },
    async addGuestEntry(payload) {
      calls.addGuestEntry = payload;
      return options.addGuestEntryResult || { ok:true, result:'scheduled' };
    },
    async cancelMakeup(id) {
      calls.cancelMakeup = id;
      return options.cancelMakeupResult || { ok:true, result:'cancelled' };
    },
    async cancelChange(id) {
      calls.cancelChange = id;
      return options.cancelChangeResult || { ok:true, result:'cancelled' };
    },
    async setAttendanceSessionStatus(payload) {
      calls.setAttendanceSessionStatus = payload;
      return options.setAttendanceSessionStatusResult || { ok:true, result:'saved' };
    },
    async saveCellMemo(division, sessionDate, timeSlot, note, classGroup, memoId) {
      calls.saveCellMemo = { division, sessionDate, timeSlot, note, classGroup, memoId };
      return options.saveCellMemoResult || { ok:true, result:'saved' };
    },
    async savePickup(payload) {
      calls.savePickup = payload;
      return options.savePickupResult || { ok:true, result:'saved', is_dropoff:payload.isDropoff === true };
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

test('dated regular absence frees the same-day seat for makeup availability', async () => {
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r3', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r4', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r5', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    attendance_overrides:[
      {
        student_id:'r3', session_date:'2026-09-23', time_slot:2, class_group:'A',
        register_session_kind:'regular', register_status:'absent'
      }
    ],
    class_teachers:[
      { division:'elementary', weekday:3, time_slot:2, class_group:'A', teacher_name:'담임' }
    ]
  };
  const { schedule } = loadSchedule(week);
  const result = await schedule.findAvailableSlots({
    date:'2026-09-23',
    division:'elementary',
    purpose:'makeup',
    timeSlot:2
  });
  assert.equal(result.displaySlots.length, 1);
  const slot = result.displaySlots[0];
  assert.equal(slot.regularCount, 5);
  assert.equal(slot.absentCount, 1);
  assert.equal(slot.occupancy, 4);
  assert.equal(slot.remaining, 1);
  assert.match(schedule.describeAvailableSlots(result), /1결석/);
  assert.match(schedule.describeAvailableSlots(result), /1자리/);
});

test('same-day absence does not open a permanent regular-registration seat', async () => {
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r3', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r4', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r5', division:'elementary', weekday:3, time_slot:2, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    attendance_overrides:[
      {
        student_id:'r3', session_date:'2026-09-23', time_slot:2, class_group:'A',
        register_session_kind:'regular', register_status:'absent'
      }
    ],
    class_teachers:[
      { division:'elementary', weekday:3, time_slot:2, class_group:'A', teacher_name:'담임' }
    ]
  };
  const { schedule } = loadSchedule(week);
  const result = await schedule.findAvailableSlots({
    date:'2026-09-23',
    division:'elementary',
    purpose:'new_enrollment',
    timeSlot:2
  });
  assert.equal(result.displaySlots.length, 1);
  assert.equal(result.displaySlots[0].absentCount, 0);
  assert.equal(result.displaySlots[0].occupancy, 5);
  assert.equal(result.displaySlots[0].remaining, 0);
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

test('move write rechecks the target and does not silently waitlist', async () => {
  const calls = {};
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[],
    one_time_sessions:[],
    class_teachers:[
      { division:'elementary', weekday:3, time_slot:4, class_group:'A', teacher_name:'담임' }
    ]
  };
  const { schedule } = loadSchedule(week, [], { calls });
  const result = await schedule.executePreparedWrite({
    intent:'move_class',
    studentId:'student-1',
    studentName:'최민기',
    division:'elementary',
    sourceEnrollmentId:'source-1',
    sourceWeekday:1,
    sourceTimeSlot:4,
    targetWeekday:3,
    targetTimeSlot:4,
    targetClassGroup:'A',
    targetCheckDate:'2026-09-23',
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


test('phone write path uses the same schedule RPC actions', async () => {
  const calls = [];
  const sandbox = {
    window: {
      OlliPhoneStudentScheduleService: {
        async request(name, payload) {
          calls.push({ name, payload });
          return { ok:true, result:'scheduled' };
        },
        clearWeekCache() {}
      },
      dispatchEvent() {}
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Date,
    console
  };
  vm.runInNewContext(source, sandbox);
  const schedule = sandbox.window.OlliCommandSchedule;

  await schedule.executePreparedWrite({
    intent:'add_makeup',
    studentId:'student-1',
    studentName:'김태리',
    sessionDate:'2026-09-18',
    timeSlot:4,
    classGroup:'A'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'olli_schedule_execute');
  assert.equal(calls[0].payload.p_action, 'add_one_time');
  assert.equal(calls[0].payload.p_params.student_id, 'student-1');
  assert.equal(calls[0].payload.p_params.time_slot, 4);
});


test('enrolled student waitlist prepares and executes through existing addWaitlist service', async () => {
  const calls = {};
  const student = { id:'student-1', name:'최민기', division:'elementary' };
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { id:'e1', student_id:'other-1', division:'elementary', weekday:1, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    waitlist:[],
    one_time_sessions:[],
    class_teachers:[
      { division:'elementary', weekday:1, time_slot:4, class_group:'A', teacher_name:'담임' }
    ]
  };
  const { schedule } = loadSchedule(week, [], { calls, students:[student] });
  const prepared = await schedule.prepareWriteCommand('add_waitlist', {
    studentName:'최민기',
    date:'2026-09-21',
    dateLabel:'월요일',
    timeSlot:4
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.intent, 'add_waitlist');
  assert.equal(prepared.command.isGuest, false);
  assert.equal(prepared.command.targetWeekday, 1);
  assert.equal(prepared.command.targetTimeSlot, 4);

  await schedule.executePreparedWrite(prepared.command);
  assert.equal(calls.addWaitlist.studentId, 'student-1');
  assert.equal(calls.addWaitlist.targetWeekday, 1);
  assert.equal(calls.addWaitlist.targetTimeSlot, 4);
  assert.equal(calls.addWaitlist.effectiveDate, '2026-09-21');
});

test('unknown waitlist name becomes guest wait only when division is explicit', async () => {
  const calls = {};
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { id:'e1', student_id:'other-1', division:'kinder', weekday:1, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    waitlist:[],
    one_time_sessions:[],
    class_teachers:[
      { division:'kinder', weekday:1, time_slot:4, class_group:'A', teacher_name:'담임' }
    ]
  };
  const { schedule } = loadSchedule(week, [], { calls, students:[] });

  const missingDivision = await schedule.prepareWriteCommand('add_waitlist', {
    studentName:'박하늘',
    date:'2026-09-21',
    timeSlot:4
  });
  assert.equal(missingDivision.ok, false);
  assert.match(missingDivision.message, /유치부인지 초등부인지/);

  const prepared = await schedule.prepareWriteCommand('add_waitlist', {
    studentName:'박하늘',
    division:'kinder',
    date:'2026-09-21',
    timeSlot:4
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.isGuest, true);
  assert.equal(prepared.command.guestName, '박하늘');

  await schedule.executePreparedWrite(prepared.command);
  assert.equal(calls.addGuestEntry.guestName, '박하늘');
  assert.equal(calls.addGuestEntry.entryType, 'wait');
  assert.equal(calls.addGuestEntry.division, 'kinder');
});

test('trial prepares an open slot and executes through existing guest-entry service', async () => {
  const calls = {};
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { id:'e1', student_id:'other-1', division:'kinder', weekday:6, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    class_teachers:[
      { division:'kinder', weekday:6, time_slot:4, class_group:'A', teacher_name:'담임' }
    ]
  };
  const { schedule } = loadSchedule(week, [], { calls });
  const prepared = await schedule.prepareWriteCommand('add_trial', {
    guestName:'박하늘',
    division:'kinder',
    date:'2026-09-19',
    dateLabel:'내일',
    timeSlot:4
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.intent, 'add_trial');
  assert.equal(prepared.command.guestName, '박하늘');
  assert.equal(prepared.command.classGroup, 'A');

  await schedule.executePreparedWrite(prepared.command);
  assert.equal(calls.addGuestEntry.guestName, '박하늘');
  assert.equal(calls.addGuestEntry.entryType, 'trial');
  assert.equal(calls.addGuestEntry.sessionDate, '2026-09-19');
  assert.equal(calls.addGuestEntry.timeSlot, 4);
});

test('makeup cancellation resolves the one-time session id before execution', async () => {
  const calls = {};
  const student = { id:'student-1', name:'김태리', division:'elementary' };
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[],
    one_time_sessions:[
      {
        id:'makeup-1', student_id:'student-1', student_name:'김태리',
        division:'elementary', session_date:'2026-09-18', time_slot:4,
        class_group:'A', session_type:'makeup', status:'scheduled'
      }
    ]
  };
  const { schedule } = loadSchedule(week, [], { calls, students:[student] });
  const prepared = await schedule.prepareWriteCommand('cancel_makeup', {
    studentName:'김태리',
    date:'2026-09-18',
    timeSlot:4,
    reason:'감기'
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.oneTimeSessionId, 'makeup-1');
  assert.equal(prepared.command.reason, '감기');
  await schedule.executePreparedWrite(prepared.command);
  assert.equal(calls.cancelMakeup, 'makeup-1');
  assert.equal(calls.saveCellMemo.note, '[김태리][취소] : 감기');
});

test('ambiguous makeup cancellation requires a date and time instead of cancelling automatically', async () => {
  const student = { id:'student-1', name:'김태리', division:'elementary' };
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[],
    one_time_sessions:[
      { id:'m1', student_id:'student-1', session_date:'2026-09-18', time_slot:4, class_group:'A', session_type:'makeup', status:'scheduled' },
      { id:'m2', student_id:'student-1', session_date:'2026-09-19', time_slot:10, class_group:'A', session_type:'makeup', status:'scheduled' }
    ]
  };
  const { schedule } = loadSchedule(week, [], { students:[student] });
  const prepared = await schedule.prepareWriteCommand('cancel_makeup', {
    studentName:'김태리',
    effectiveDate:'2026-09-18'
  });

  assert.equal(prepared.ok, false);
  assert.match(prepared.message, /여러 개/);
  assert.match(prepared.message, /날짜와 시간을 함께/);
});

test('scheduled move cancellation resolves change id and uses existing cancelChange service', async () => {
  const calls = {};
  const student = { id:'student-1', name:'최민기', division:'elementary' };
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { id:'source-1', student_id:'student-1', division:'elementary', weekday:1, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { id:'target-1', student_id:'student-1', division:'elementary', weekday:3, time_slot:4, class_group:'A', effective_from:'2026-09-23' }
    ],
    changes:[
      {
        id:'change-1', student_id:'student-1', student_name:'최민기',
        source_enrollment_id:'source-1', target_enrollment_id:'target-1',
        effective_date:'2026-09-23', change_type:'move', status:'scheduled'
      }
    ]
  };
  const { schedule } = loadSchedule(week, [], { calls, students:[student] });
  const prepared = await schedule.prepareWriteCommand('cancel_move', {
    studentName:'최민기',
    sourceWeekday:1,
    sourceTimeSlot:4,
    effectiveDate:'2026-09-18'
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.changeId, 'change-1');
  await schedule.executePreparedWrite(prepared.command);
  assert.equal(calls.cancelChange, 'change-1');
});

test('new phone write commands use the existing schedule RPCs', async () => {
  const calls = [];
  const sandbox = {
    window: {
      OlliPhoneStudentScheduleService: {
        async request(name, payload) {
          calls.push({ name, payload });
          return { ok:true, result:'scheduled' };
        },
        async loadWeek() {
          return {
            elementary_capacity:5,
            kinder_capacity:5,
            enrollments:[],
            one_time_sessions:[],
            class_teachers:[
              { division:'kinder', weekday:6, time_slot:4, class_group:'A', teacher_name:'담임' }
            ],
            calendar_days:[
              { session_date:'2026-09-19', is_holiday:false }
            ]
          };
        },
        clearWeekCache() {}
      },
      dispatchEvent() {}
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Date,
    console
  };
  vm.runInNewContext(source, sandbox);
  const schedule = sandbox.window.OlliCommandSchedule;

  await schedule.executePreparedWrite({
    intent:'add_waitlist',
    studentId:'student-1',
    studentName:'최민기',
    isGuest:false,
    division:'elementary',
    effectiveDate:'2026-09-21',
    targetWeekday:1,
    targetTimeSlot:4,
    targetClassGroup:'A'
  });
  await schedule.executePreparedWrite({
    intent:'add_trial',
    guestName:'박하늘',
    studentName:'박하늘',
    division:'kinder',
    sessionDate:'2026-09-19',
    timeSlot:4,
    classGroup:'A'
  });
  await schedule.executePreparedWrite({
    intent:'cancel_makeup',
    studentId:'student-1',
    studentName:'김태리',
    division:'elementary',
    oneTimeSessionId:'makeup-1',
    sessionDate:'2026-09-18',
    timeSlot:4,
    classGroup:'A',
    reason:'감기'
  });
  await schedule.executePreparedWrite({
    intent:'cancel_move',
    studentId:'student-1',
    studentName:'최민기',
    changeId:'change-1'
  });

  assert.equal(calls[0].name, 'olli_schedule_execute');
  assert.equal(calls[0].payload.p_action, 'add_waitlist');
  assert.equal(calls[1].name, 'olli_schedule_add_guest_entry');
  assert.equal(calls[1].payload.p_entry_type, 'trial');
  assert.equal(calls[2].payload.p_action, 'cancel_one_time');
  assert.equal(calls[2].payload.p_params.one_time_session_id, 'makeup-1');
  assert.equal(calls[3].name, 'olli_schedule_save_cell_memo_v3');
  assert.equal(calls[3].payload.p_note, '[김태리][취소] : 감기');
  assert.equal(calls[4].payload.p_action, 'cancel_change');
  assert.equal(calls[4].payload.p_params.change_id, 'change-1');
});


test('absence command marks the regular session absent and stores the reason memo', async () => {
  const calls = {};
  const student = { id:'student-1', name:'김태리', division:'elementary' };
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { id:'e1', student_id:'student-1', student_name:'김태리', division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[]
  };
  const { schedule } = loadSchedule(week, [], { calls, students:[student] });
  const prepared = await schedule.prepareWriteCommand('mark_absent', {
    studentName:'김태리',
    date:'2026-09-18',
    reason:'감기'
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.timeSlot, 4);
  assert.equal(prepared.command.reason, '감기');

  await schedule.executePreparedWrite(prepared.command);
  assert.deepEqual(calls.setAttendanceSessionStatus, {
    studentId:'student-1',
    sessionDate:'2026-09-18',
    sessionKind:'regular',
    timeSlot:4,
    classGroup:'A',
    status:'absent'
  });
  assert.equal(calls.saveCellMemo.note, '[김태리][결석] : 감기');
});

test('trial cancellation resolves the guest trial and stores a tagged cancellation memo', async () => {
  const calls = {};
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[],
    one_time_sessions:[
      {
        id:'trial-1', student_id:null, student_name:'박하늘', is_guest:true,
        division:'kinder', session_date:'2026-09-19', time_slot:4,
        class_group:'A', session_type:'trial', status:'scheduled'
      }
    ]
  };
  const { schedule } = loadSchedule(week, [], { calls });
  const prepared = await schedule.prepareWriteCommand('cancel_trial', {
    guestName:'박하늘',
    date:'2026-09-19',
    timeSlot:4,
    reason:'일정 변경'
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.oneTimeSessionId, 'trial-1');
  await schedule.executePreparedWrite(prepared.command);
  assert.equal(calls.cancelMakeup, 'trial-1');
  assert.equal(calls.saveCellMemo.note, '[박하늘][취소] : 일정 변경');
});

test('absence and cancellation writes reject execution when the reason is missing', async () => {
  const { schedule } = loadSchedule({});
  await assert.rejects(
    schedule.executePreparedWrite({
      intent:'mark_absent',
      studentId:'student-1',
      studentName:'김태리',
      division:'elementary',
      sessionDate:'2026-09-18',
      timeSlot:4,
      classGroup:'A'
    }),
    /결석 사유/
  );
  await assert.rejects(
    schedule.executePreparedWrite({
      intent:'cancel_makeup',
      studentId:'student-1',
      studentName:'김태리',
      division:'elementary',
      oneTimeSessionId:'makeup-1',
      sessionDate:'2026-09-18',
      timeSlot:4,
      classGroup:'A'
    }),
    /보강 취소 사유/
  );
});


test('dated availability reports regular makeup and trial counts separately', async () => {
  const week = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r3', division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[
      { id:'m1', division:'elementary', session_date:'2026-09-18', time_slot:4, class_group:'A', session_type:'makeup', status:'scheduled' },
      { id:'t1', division:'elementary', session_date:'2026-09-18', time_slot:4, class_group:'A', session_type:'trial', status:'scheduled' }
    ],
    class_teachers:[
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(week);
  const result = await schedule.findAvailableSlots({
    date:'2026-09-18',
    dateLabel:'오늘',
    division:'elementary',
    viewMode:'schedule',
    timeSlot:4
  });

  assert.equal(result.displaySlots.length, 1);
  const slot = result.displaySlots[0];
  assert.equal(slot.regularCount, 3);
  assert.equal(slot.makeupCount, 1);
  assert.equal(slot.trialCount, 1);
  assert.equal(slot.occupancy, 5);
  assert.equal(slot.remaining, 0);
  assert.match(schedule.describeAvailableSlots(result), /정규 3명 \+ 보강 1명 \+ 체험 1명/);
  assert.match(schedule.describeAvailableSlots(result), /마감/);
});

test('recurring availability keeps regular vacancy even when one future date is full from makeup', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r3', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r4', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[
      {
        id:'m1', division:'elementary', session_date:'2026-09-22',
        time_slot:4, class_group:'A', session_type:'makeup', status:'scheduled'
      }
    ],
    class_teachers:[
      { division:'elementary', weekday:2, time_slot:4, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon, [], { horizonData:horizon });
  const result = await schedule.findRecurringAvailability({
    date:'2026-09-18',
    weekday:2,
    timeSlot:4,
    division:'elementary',
    viewMode:'availability'
  });

  assert.equal(result.displaySlots.length, 1);
  assert.equal(result.displaySlots[0].regularCount, 4);
  assert.equal(result.displaySlots[0].remaining, 1);
  assert.equal(result.oneTimeExceptions.length, 1);
  assert.equal(result.oneTimeExceptions[0].date, '2026-09-22');
  assert.equal(result.oneTimeExceptions[0].makeupCount, 1);
  assert.equal(result.oneTimeExceptions[0].remaining, 0);

  const message = schedule.describeRecurringAvailability(result);
  assert.match(message, /화요일 4시/);
  assert.match(message, /정규 4명/);
  assert.match(message, /1자리/);
  assert.match(message, /9월 22일/);
  assert.match(message, /보강 1명/);
  assert.match(message, /마감/);
});

test('recurring availability reports future regular enrollment changes separately', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r3', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r4', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r5', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-10-06' }
    ],
    one_time_sessions:[],
    class_teachers:[
      { division:'elementary', weekday:2, time_slot:4, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon, [], { horizonData:horizon });
  const result = await schedule.findRecurringAvailability({
    date:'2026-09-18',
    weekday:2,
    timeSlot:4,
    division:'elementary'
  });

  assert.equal(result.displaySlots[0].remaining, 1);
  assert.equal(result.regularChanges.length, 1);
  assert.equal(result.regularChanges[0].date, '2026-10-06');
  assert.equal(result.regularChanges[0].regularCount, 5);
  assert.equal(result.regularChanges[0].remaining, 0);
  assert.match(schedule.describeRecurringAvailability(result), /10월 6일부터/);
});

test('week schedule uses each actual date and separates one-time counts', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:5, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[
      {
        id:'t1', division:'elementary', session_date:'2026-09-18',
        time_slot:4, class_group:'A', session_type:'trial', status:'scheduled'
      }
    ],
    class_teachers:[
      { division:'elementary', weekday:5, time_slot:4, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon, [], { horizonData:horizon });
  const result = await schedule.findWeekAvailability({
    date:'2026-09-18',
    division:'elementary',
    viewMode:'schedule',
    dateLabel:'이번 주'
  });
  const friday = result.days.find(day => day.date === '2026-09-18');
  assert.ok(friday);
  const slot = friday.displaySlots.find(row => row.timeSlot === 4);
  assert.equal(slot.regularCount, 1);
  assert.equal(slot.trialCount, 1);
  assert.match(schedule.describeWeekAvailability(result), /정규 1명 \+ 체험 1명/);
});


test('recurring availability copy follows the natural single-slot format', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:5, time_slot:5, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[
      {
        id:'m1', division:'elementary', session_date:'2026-09-18',
        time_slot:5, class_group:'A', session_type:'makeup', status:'scheduled'
      }
    ],
    class_teachers:[
      { division:'elementary', weekday:5, time_slot:5, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon, [], { horizonData:horizon });
  const result = await schedule.findRecurringAvailability({
    date:'2026-09-18',
    weekday:5,
    timeSlot:5,
    division:'elementary'
  });

  assert.equal(
    schedule.describeRecurringAvailability(result),
    [
      '금요일 5시는 정규수업 기준 3자리 있습니다.',
      '금요일 5시 · 정규 2명 / 3자리',
      '9월 18일에는 보강 1명이 있어 2자리 있습니다.'
    ].join('\n')
  );
});

test('recurring availability copy explains future regular closure before dated makeup closure', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r3', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r4', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r5', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-10-06' }
    ],
    one_time_sessions:[
      {
        id:'m1', division:'elementary', session_date:'2026-09-22',
        time_slot:4, class_group:'A', session_type:'makeup', status:'scheduled'
      }
    ],
    class_teachers:[
      { division:'elementary', weekday:2, time_slot:4, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon, [], { horizonData:horizon });
  const result = await schedule.findRecurringAvailability({
    date:'2026-09-18',
    weekday:2,
    timeSlot:4,
    division:'elementary'
  });

  assert.equal(
    schedule.describeRecurringAvailability(result),
    [
      '화요일 4시는 정규수업 기준 마감되었습니다.',
      '초등부: 4시 · 정규 4명 (1자리)',
      '10월 6일부터 정규 5명 / 마감',
      '9월 22일은 보강 1명이 예약되어 있어 해당 날짜도 마감입니다.'
    ].join('\n')
  );
});


test('dated makeup availability leads with possible status and compact counts', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:1, time_slot:1, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:1, time_slot:1, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    class_teachers:[
      { division:'elementary', weekday:1, time_slot:1, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon);
  const result = await schedule.findAvailableSlots({
    date:'2026-09-21',
    dateLabel:'다음 주 월요일',
    division:'elementary',
    purpose:'makeup',
    viewMode:'availability'
  });

  assert.equal(
    schedule.describeAvailableSlots(result),
    [
      '다음 주 월요일 보강 가능합니다.',
      '초등부: 1시 · 정규 2명 (3자리)'
    ].join('\n')
  );
});

test('dated makeup availability shows existing makeup count compactly', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:1, time_slot:1, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:1, time_slot:1, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[
      {
        id:'m1', division:'elementary', session_date:'2026-09-21',
        time_slot:1, class_group:'A', session_type:'makeup', status:'scheduled'
      }
    ],
    class_teachers:[
      { division:'elementary', weekday:1, time_slot:1, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon);
  const result = await schedule.findAvailableSlots({
    date:'2026-09-21',
    dateLabel:'다음 주 월요일',
    division:'elementary',
    purpose:'makeup',
    viewMode:'availability'
  });

  assert.equal(
    schedule.describeAvailableSlots(result),
    [
      '다음 주 월요일 보강 가능합니다.',
      '초등부: 1시 · 정규 2명 · 1보강 (2자리)'
    ].join('\n')
  );
});

test('recurring makeup question ends with a clear booking verdict', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r3', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r4', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r5', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-10-06' }
    ],
    one_time_sessions:[
      {
        id:'m1', division:'elementary', session_date:'2026-09-22',
        time_slot:4, class_group:'A', session_type:'makeup', status:'scheduled'
      }
    ],
    class_teachers:[
      { division:'elementary', weekday:2, time_slot:4, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon, [], { horizonData:horizon });
  const result = await schedule.findRecurringAvailability({
    date:'2026-09-18',
    weekday:2,
    timeSlot:4,
    division:'elementary',
    purpose:'makeup'
  });
  const message = schedule.describeRecurringAvailability(result);
  assert.match(message, /정규수업 기준 마감되었습니다/);
  assert.match(message, /보강 예약 가능합니다\.$/);
});

test('recurring trial question reports no seat when every future occurrence is full', async () => {
  const horizon = {
    elementary_capacity:5,
    kinder_capacity:5,
    enrollments:[
      { student_id:'r1', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r2', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r3', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r4', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' },
      { student_id:'r5', division:'elementary', weekday:2, time_slot:4, class_group:'A', effective_from:'2026-01-01' }
    ],
    one_time_sessions:[],
    class_teachers:[
      { division:'elementary', weekday:2, time_slot:4, class_group:'A', teacher_name:'담임' }
    ],
    class_splits:[],
    kinder_class_merges:[]
  };
  const { schedule } = loadSchedule(horizon, [], { horizonData:horizon });
  const result = await schedule.findRecurringAvailability({
    date:'2026-09-18',
    weekday:2,
    timeSlot:4,
    division:'elementary',
    purpose:'trial'
  });
  assert.match(schedule.describeRecurringAvailability(result), /체험 자리가 없습니다\.$/);
});


test('prepare dropoff pickup write resolves a kinder student and preserves the dropoff flag', async () => {
  const student = { id:'student-k1', name:'김민서', division:'kinder' };
  const { schedule } = loadSchedule({}, [], { students:[student] });
  const prepared = await schedule.prepareWriteCommand('add_pickup', {
    studentName:'김민서',
    weekday:1,
    classTime:4,
    pickupLabel:'리슈빌',
    pickupTime:'',
    isDropoff:true,
    effectiveDate:new Date(2026, 8, 21, 12, 0, 0)
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.command.intent, 'add_pickup');
  assert.equal(prepared.command.studentId, 'student-k1');
  assert.equal(prepared.command.weekday, 1);
  assert.equal(prepared.command.classTime, 4);
  assert.equal(prepared.command.pickupLabel, '리슈빌');
  assert.equal(prepared.command.pickupTime, '');
  assert.equal(prepared.command.isDropoff, true);
  assert.equal(prepared.command.effectiveDate, '2026-09-21');
  assert.match(prepared.message, /하원 픽업/);
});

test('pickup write rejects incomplete details and elementary students before saving', async () => {
  const incomplete = loadSchedule({}, [], { students:[] });
  const missing = await incomplete.schedule.prepareWriteCommand('add_pickup', {
    isDropoff:true
  });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /학생 이름/);
  assert.match(missing.message, /픽업 장소/);
  assert.doesNotMatch(missing.message, /픽업 시간/);

  const student = { id:'student-e1', name:'최민기', division:'elementary' };
  const elementary = loadSchedule({}, [], { students:[student] });
  const rejected = await elementary.schedule.prepareWriteCommand('add_pickup', {
    studentName:'최민기',
    weekday:1,
    classTime:4,
    pickupLabel:'리슈빌',
    pickupTime:'15:30',
    isDropoff:true,
    effectiveDate:new Date(2026, 8, 21, 12, 0, 0)
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /유치부 학생만/);
});

test('dropoff pickup execution reuses the existing timetable savePickup service', async () => {
  const calls = {};
  const { schedule } = loadSchedule({}, [], { calls });
  const result = await schedule.executePreparedWrite({
    intent:'add_pickup',
    studentId:'student-k1',
    studentName:'김민서',
    division:'kinder',
    weekday:1,
    classTime:4,
    pickupLabel:'리슈빌',
    pickupTime:'15:30',
    effectiveDate:'2026-09-21',
    isDropoff:true
  });

  assert.equal(result.ok, true);
  assert.equal(calls.savePickup.studentId, 'student-k1');
  assert.equal(calls.savePickup.weekday, 1);
  assert.equal(calls.savePickup.classTime, 4);
  assert.equal(calls.savePickup.pickupLabel, '리슈빌');
  assert.equal(calls.savePickup.pickupTime, '');
  assert.equal(calls.savePickup.isDropoff, true);
  assert.match(schedule.writeSuccessMessage({
    intent:'add_pickup',
    studentName:'김민서',
    weekday:1,
    classTime:4,
    isDropoff:true
  }), /하원 픽업/);
});

test('phone dropoff pickup execution calls the same v2 pickup RPC with is_dropoff', async () => {
  const calls = [];
  const sandbox = {
    window: {
      OlliPhoneStudentScheduleService: {
        async request(name, payload) {
          calls.push({ name, payload });
          return { ok:true, result:'saved', is_dropoff:payload.p_is_dropoff === true };
        },
        clearWeekCache() {}
      },
      dispatchEvent() {}
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Date,
    console
  };
  vm.runInNewContext(source, sandbox);
  const schedule = sandbox.window.OlliCommandSchedule;

  await schedule.executePreparedWrite({
    intent:'add_pickup',
    studentId:'student-k1',
    studentName:'김민서',
    division:'kinder',
    weekday:1,
    classTime:4,
    pickupLabel:'리슈빌',
    pickupTime:'15:30',
    effectiveDate:'2026-09-21',
    isDropoff:true
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'olli_schedule_save_pickup_v2');
  assert.equal(calls[0].payload.p_student_id, 'student-k1');
  assert.equal(calls[0].payload.p_weekday, 1);
  assert.equal(calls[0].payload.p_class_time, 4);
  assert.equal(calls[0].payload.p_pickup_label, '리슈빌');
  assert.equal(calls[0].payload.p_pickup_time, null);
  assert.equal(calls[0].payload.p_is_dropoff, true);
});


test('regular pickup still requires a pickup time while dropoff does not', async () => {
  const student = { id:'student-k1', name:'김민서', division:'kinder' };
  const { schedule } = loadSchedule({}, [], { students:[student] });
  const dropoff = await schedule.prepareWriteCommand('add_pickup', {
    studentName:'김민서',
    weekday:1,
    classTime:4,
    pickupLabel:'리슈빌',
    pickupTime:'',
    isDropoff:true,
    effectiveDate:new Date(2026, 8, 21, 12, 0, 0)
  });
  const regular = await schedule.prepareWriteCommand('add_pickup', {
    studentName:'김민서',
    weekday:1,
    classTime:4,
    pickupLabel:'리슈빌',
    pickupTime:'',
    isDropoff:false,
    effectiveDate:new Date(2026, 8, 21, 12, 0, 0)
  });
  assert.equal(dropoff.ok, true);
  assert.equal(dropoff.command.pickupTime, '');
  assert.equal(regular.ok, false);
  assert.match(regular.message, /픽업 시간/);
});
