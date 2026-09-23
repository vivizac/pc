const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const routerSource = fs.readFileSync('olli-command-router-common.js', 'utf8');
const scheduleSource = fs.readFileSync('olli-command-schedule-common.js', 'utf8');
const pcTalkSource = fs.readFileSync('pc-team-talk.js', 'utf8');

function loadRouter(scheduleStub) {
  const sandbox = { window:{}, console, Date };
  if (scheduleStub) sandbox.window.OlliCommandSchedule = scheduleStub;
  vm.runInNewContext(routerSource, sandbox);
  return sandbox.window.OlliCommandRouter;
}

function loadSchedule(week, flags = []) {
  const service = {
    async loadWeek() { return week; },
    async request(name) {
      if (name === 'olli_schedule_pickup_dropoff_flags') return { ok:true, flags };
      throw new Error('unexpected rpc ' + name);
    },
    clearWeekCache() {}
  };
  const sandbox = { window:{ OlliPhoneStudentScheduleService:service }, console, Date };
  vm.runInNewContext(scheduleSource, sandbox);
  return sandbox.window.OlliCommandSchedule;
}

test('multi read query parses two or three weekday/time seat lookups with a shared request', () => {
  const router = loadRouter();

  for (const text of [
    '월요일 4시, 화요일 4시 자리 있어?',
    '월요일 4시, 화요일 4시 자리',
    '월요일 4시, 화요일 4시, 수요일 5시 자리 있어?'
  ]) {
    const query = router.parseMultiQueryIntent(text);
    assert.ok(query, text);
    assert.equal(query.intent, 'multi_read_query', text);
    assert.equal(query.queries.length, text.includes('수요일') ? 3 : 2, text);
    query.queries.forEach(item => assert.equal(item.intent, 'find_available_slots', text));
  }

  const two = router.parseMultiQueryIntent('월요일 4시, 화요일 4시 자리');
  assert.equal(two.queries[0].weekday, 1);
  assert.equal(two.queries[0].timeSlot, 4);
  assert.equal(two.queries[1].weekday, 2);
  assert.equal(two.queries[1].timeSlot, 4);
});

test('multi read query keeps shared division, purpose and week scope across items', () => {
  const router = loadRouter();

  const division = router.parseMultiQueryIntent('초등부 월요일 4시, 화요일 5시 자리 있어?');
  assert.ok(division);
  assert.equal(division.queries[0].division, 'elementary');
  assert.equal(division.queries[1].division, 'elementary');

  const purpose = router.parseMultiQueryIntent('월요일 4시, 화요일 5시 보강 가능해?');
  assert.ok(purpose);
  assert.equal(purpose.queries[0].purpose, 'makeup');
  assert.equal(purpose.queries[1].purpose, 'makeup');

  const nextWeek = router.parseMultiQueryIntent('다음주 월요일 4시, 화요일 5시 자리 있어?');
  assert.ok(nextWeek);
  assert.equal(nextWeek.queries[0].scope, 'date');
  assert.equal(nextWeek.queries[0].dateSpec.mode, 'next_weekday');
  assert.equal(nextWeek.queries[1].scope, 'date');
  assert.equal(nextWeek.queries[1].dateSpec.mode, 'next_weekday');
});

test('multi read query also works for roster and pickup requests', () => {
  const router = loadRouter();

  const absence = router.parseMultiQueryIntent('월요일 4시, 화요일 4시 결석 학생 누구야?');
  assert.ok(absence);
  assert.equal(absence.queries.length, 2);
  absence.queries.forEach(item => {
    assert.equal(item.intent, 'find_roster_entries');
    assert.equal(item.rosterKind, 'absence');
  });

  const pickup = router.parseMultiQueryIntent('월요일 4시, 화요일 5시 픽업 누구 있어?');
  assert.ok(pickup);
  assert.equal(pickup.queries.length, 2);
  pickup.queries.forEach(item => assert.equal(item.intent, 'find_pickups'));
});

test('multi read query aggregates each sub-query answer into one response', async () => {
  let calls = 0;
  const router = loadRouter({
    async findAvailableSlots() {
      return { displaySlots:[], allSlots:[] };
    },
    async findRecurringAvailability(options) {
      calls += 1;
      return {
        scope:'recurring',
        viewMode:'availability',
        division:'',
        weekday:options.weekday,
        timeSlot:options.timeSlot,
        allSlots:[],
        displaySlots:[],
        regularChanges:[],
        oneTimeExceptions:[]
      };
    },
    describeRecurringAvailability(result) {
      return (result.weekday === 1 ? '월요일' : '화요일') + ' ' + result.timeSlot + '시 결과';
    }
  });

  const result = await router.runQuery('월요일 4시, 화요일 4시 자리 있어?', { source:'olli_talk_ai' });
  assert.equal(result.handled, true);
  assert.equal(result.intent, 'multi_read_query');
  assert.equal(calls, 2);
  assert.match(result.message, /월요일 4시 결과/);
  assert.match(result.message, /화요일 4시 결과/);
});

test('remaining write parsers cover waitlist cancel and pickup cancel/update', () => {
  const router = loadRouter();

  const waitCancel = router.parseWaitlistCancelMutationIntent('김민서 월요일 4시 대기 취소해줘');
  assert.ok(waitCancel);
  assert.equal(waitCancel.intent, 'cancel_waitlist');
  assert.equal(waitCancel.studentName, '김민서');
  assert.equal(waitCancel.timeSlot, 4);

  const pickupCancel = router.parsePickupCancelMutationIntent('김민서 월요일 4시 픽업 삭제해줘');
  assert.ok(pickupCancel);
  assert.equal(pickupCancel.intent, 'cancel_pickup');
  assert.equal(pickupCancel.pickupKind, 'all');

  const dropoffCancel = router.parsePickupCancelMutationIntent('김민서 월요일 4시 하원 픽업 삭제해줘');
  assert.ok(dropoffCancel);
  assert.equal(dropoffCancel.pickupKind, 'dropoff');

  const pickupUpdate = router.parsePickupUpdateMutationIntent('김민서 월요일 4시 픽업 시간을 3시 40분으로 수정해줘');
  assert.ok(pickupUpdate);
  assert.equal(pickupUpdate.intent, 'update_pickup');
  assert.equal(pickupUpdate.pickupKind, 'arrival');
  assert.equal(pickupUpdate.pickupTime, '15:40');

  const dropoffUpdate = router.parsePickupUpdateMutationIntent('김민서 월요일 4시 하원 픽업 장소 정문으로 수정해줘');
  assert.ok(dropoffUpdate);
  assert.equal(dropoffUpdate.pickupKind, 'dropoff');
  assert.match(dropoffUpdate.pickupLabel, /정문/);
});

test('dropoff pickup registration does not require pickup time', () => {
  const router = loadRouter();
  const command = router.parsePickupMutationIntent('김민서 월요일 4시 수업 정문 하원 픽업 등록해줘');
  assert.ok(command);
  assert.equal(command.intent, 'add_pickup');
  assert.equal(command.isDropoff, true);
  assert.equal(command.pickupTime, '');
  assert.match(command.pickupLabel, /정문/);
});

test('multi write parser accepts two or three independent write commands', () => {
  const router = loadRouter();
  const batch = router.parseMultiWriteIntent('김민서 월요일 4시 대기 취소해줘; 최서윤 화요일 5시 보강 등록해줘');
  assert.ok(batch);
  assert.equal(batch.intent, 'batch_write');
  assert.equal(batch.commands.length, 2);
  assert.equal(batch.commands[0].intent, 'cancel_waitlist');
  assert.equal(batch.commands[1].intent, 'add_makeup');
});

test('roster parser recognizes class, absence, makeup, trial, waitlist and move list questions', () => {
  const router = loadRouter();
  const cases = [
    ['오늘 4시 누구 수업이야?', 'class_roster', 'date', 4],
    ['오늘 결석 누구 있어?', 'absence', 'date', 0],
    ['이번주 보강 학생 보여줘', 'makeup', 'week', 0],
    ['오늘 5시 체험 누구 있어?', 'trial', 'date', 5],
    ['대기 몇 명이야?', 'waitlist', 'all', 0],
    ['수업 이동 예약된 학생 누구야?', 'move', 'all', 0]
  ];
  cases.forEach(([text, kind, scope, timeSlot]) => {
    const query = router.parseRosterQueryIntent(text);
    assert.ok(query, text);
    assert.equal(query.intent, 'find_roster_entries', text);
    assert.equal(query.rosterKind, kind, text);
    assert.equal(query.scope, scope, text);
    assert.equal(query.timeSlot, timeSlot, text);
  });

  assert.equal(router.parseRosterQueryIntent('오늘 4시 자리 있어?'), null);
  assert.equal(router.parseRosterQueryIntent('화요일 4시 보강 가능해?'), null);
  assert.equal(router.parseRosterQueryIntent('오늘 체험 학생 등록해줘'), null);
  assert.equal(router.isOlliReplyCandidate('오늘 결석 누구 있어?'), true);
  assert.equal(router.isOlliReplyCandidate('대기 몇 명이야?'), true);
});

test('runQuery routes roster reads without entering the write path', async () => {
  let readCalls = 0;
  let writeCalls = 0;
  const router = loadRouter({
    async findRosterEntries(options) {
      readCalls += 1;
      assert.equal(options.kind, 'absence');
      assert.equal(options.timeSlot, 4);
      return {
        kind:'absence',
        scope:'date',
        date:'2026-09-23',
        dateLabel:'오늘',
        timeSlot:4,
        items:[{ studentId:'s1', studentName:'김민서' }]
      };
    },
    describeRosterEntries(result) {
      return result.items[0].studentName + ' 학생이 결석이에요.';
    },
    async prepareWriteCommand() { writeCalls += 1; throw new Error('write path must not run'); },
    async executePreparedWrite() { writeCalls += 1; throw new Error('write path must not run'); }
  });

  const result = await router.runQuery('오늘 4시 결석 학생 누구야?', { source:'olli_talk_ai' });
  assert.equal(result.handled, true);
  assert.equal(result.intent, 'find_roster_entries');
  assert.equal(readCalls, 1);
  assert.equal(writeCalls, 0);
  assert.match(result.message, /김민서/);
});

test('roster reads return each stored list from the existing weekly schedule payload', async () => {
  const week = {
    enrollments:[
      { id:'e1', student_id:'s1', student_name:'김민서', division:'elementary', weekday:3, time_slot:4, class_group:'A', effective_from:'2026-09-01', effective_to:null },
      { id:'e2', student_id:'s2', student_name:'최서윤', division:'elementary', weekday:3, time_slot:4, class_group:'A', effective_from:'2026-09-01', effective_to:null },
      { id:'e3', student_id:'s1', student_name:'김민서', division:'elementary', weekday:4, time_slot:5, class_group:'A', effective_from:'2026-09-01', effective_to:null }
    ],
    attendance_overrides:[
      { student_id:'s2', session_date:'2026-09-23', time_slot:4, class_group:'A', register_session_kind:'regular', register_status:'absent' }
    ],
    one_time_sessions:[
      { id:'m1', student_id:'s3', student_name:'박보강', division:'elementary', session_date:'2026-09-23', time_slot:4, class_group:'A', session_type:'makeup', status:'scheduled', is_guest:false },
      { id:'t1', student_name:'이체험', division:'elementary', session_date:'2026-09-23', time_slot:4, class_group:'A', session_type:'trial', status:'scheduled', is_guest:true }
    ],
    waitlist:[
      { id:'w1', student_id:'s4', student_name:'정대기', division:'elementary', target_weekday:3, target_time_slot:4, target_class_group:'A', effective_date:'2026-09-01', status:'waiting', is_guest:false }
    ],
    changes:[
      { id:'c1', student_id:'s1', change_type:'move', status:'scheduled', effective_date:'2026-09-23', source_enrollment_id:'e1', target_enrollment_id:'e3' }
    ]
  };
  const schedule = loadSchedule(week);

  const classRoster = await schedule.findRosterEntries({
    kind:'class_roster', scope:'date', date:'2026-09-23', dateLabel:'오늘', timeSlot:4
  });
  assert.equal(classRoster.items.length, 4);
  assert.equal(classRoster.items.find(item => item.studentName === '최서윤').absent, true);

  const absence = await schedule.findRosterEntries({
    kind:'absence', scope:'date', date:'2026-09-23', dateLabel:'오늘', timeSlot:4
  });
  assert.equal(absence.items.map(item => item.studentName).join(','), '최서윤');

  const makeup = await schedule.findRosterEntries({
    kind:'makeup', scope:'date', date:'2026-09-23', dateLabel:'오늘', timeSlot:4
  });
  assert.equal(makeup.items.map(item => item.studentName).join(','), '박보강');

  const trial = await schedule.findRosterEntries({
    kind:'trial', scope:'date', date:'2026-09-23', dateLabel:'오늘', timeSlot:4
  });
  assert.equal(trial.items.map(item => item.studentName).join(','), '이체험');

  const waitlist = await schedule.findRosterEntries({
    kind:'waitlist', scope:'date', date:'2026-09-23', dateLabel:'오늘', timeSlot:4
  });
  assert.equal(waitlist.items.map(item => item.studentName).join(','), '정대기');

  const move = await schedule.findRosterEntries({
    kind:'move', scope:'date', date:'2026-09-23', dateLabel:'오늘'
  });
  assert.equal(move.items.length, 1);
  assert.equal(move.items[0].studentName, '김민서');
  assert.equal(move.items[0].sourceTimeSlot, 4);
  assert.equal(move.items[0].targetTimeSlot, 5);
});

test('roster descriptions show counts, names and useful status labels', async () => {
  const schedule = loadSchedule({});
  const message = schedule.describeRosterEntries({
    kind:'class_roster',
    scope:'date',
    date:'2026-09-23',
    dateLabel:'오늘',
    timeSlot:4,
    items:[
      { studentId:'s1', studentName:'김민서', division:'elementary', timeSlot:4, classGroup:'A', entryKind:'regular', absent:false },
      { studentId:'s2', studentName:'최서윤', division:'elementary', timeSlot:4, classGroup:'A', entryKind:'regular', absent:true },
      { studentId:'s3', studentName:'박보강', division:'elementary', timeSlot:4, classGroup:'A', entryKind:'makeup', absent:false }
    ]
  });
  assert.match(message, /수업 학생은 3명이에요/);
  assert.match(message, /김민서/);
  assert.match(message, /최서윤/);
  assert.match(message, /결석/);
  assert.match(message, /박보강/);
  assert.match(message, /보강/);
});

test('passive pickup lookup is not mistaken for pickup registration', () => {
  const router = loadRouter();
  assert.equal(router.parsePickupMutationIntent('오늘 픽업 등록된 학생 있어?'), null);

  const query = router.parsePickupQueryIntent('오늘 픽업 등록된 학생 있어?');
  assert.ok(query);
  assert.equal(query.type, 'query');
  assert.equal(query.intent, 'find_pickups');
  assert.equal(query.dateSpec.mode, 'today');
  assert.equal(query.kind, 'all');
});

test('pickup query accepts natural today and class-time questions plus short lookup forms', () => {
  const router = loadRouter();

  const today = router.parsePickupQueryIntent('오늘 픽업 누구 있어?');
  assert.ok(today);
  assert.equal(today.dateSpec.mode, 'today');
  assert.equal(today.classTime, 0);
  assert.equal(today.kind, 'all');

  for (const text of [
    '오늘 4시 픽업',
    '오늘 4시 픽업 누구 있어?',
    '오늘 4시 픽업 몇 명이야?'
  ]) {
    const query = router.parsePickupQueryIntent(text);
    assert.ok(query, text);
    assert.equal(query.dateSpec.mode, 'today', text);
    assert.equal(query.classTime, 4, text);
    assert.equal(query.kind, 'all', text);
  }

  const reversed = router.parsePickupQueryIntent('픽업 5시');
  assert.ok(reversed);
  assert.equal(reversed.dateSpec.mode, 'today');
  assert.equal(reversed.classTime, 5);

  assert.equal(router.parsePickupQueryIntent('오늘 4시 픽업 등록해줘'), null);
  assert.equal(router.isOlliReplyCandidate('오늘 픽업 누구 있어?'), true);
});

test('pickup query understands dropoff and class-time filters', () => {
  const router = loadRouter();
  const query = router.parsePickupQueryIntent('다음주 화요일 5시 수업 하원 픽업 학생 보여줘');
  assert.ok(query);
  assert.equal(query.intent, 'find_pickups');
  assert.equal(query.dateSpec.mode, 'next_weekday');
  assert.equal(query.dateSpec.weekday, 2);
  assert.equal(query.classTime, 5);
  assert.equal(query.kind, 'dropoff');
});

test('runQuery reads pickup data without preparing or executing a write', async () => {
  let findCalls = 0;
  let writeCalls = 0;
  const router = loadRouter({
    async findPickups(options) {
      findCalls += 1;
      return {
        date:'2026-09-21',
        dateLabel:options.dateLabel,
        kind:options.kind,
        classTime:options.classTime,
        items:[{ student_name:'김민서', class_time:5, pickup_label:'리슈빌', pickup_time:'15:30:00', is_dropoff:false }]
      };
    },
    describePickups(result) {
      return result.items[0].student_name + ' 학생이 있어요.';
    },
    async prepareWriteCommand() { writeCalls += 1; throw new Error('write path must not run'); },
    async executePreparedWrite() { writeCalls += 1; throw new Error('write path must not run'); }
  });

  const result = await router.runQuery('오늘 픽업 등록된 학생 있어?', { source:'olli_talk_ai' });
  assert.equal(result.handled, true);
  assert.equal(result.intent, 'find_pickups');
  assert.equal(findCalls, 1);
  assert.equal(writeCalls, 0);
  assert.match(result.message, /김민서/);
});

test('pickup read filters by date, class time and dropoff state', async () => {
  const week = {
    pickups:[
      { id:'p1', student_name:'김민서', weekday:1, class_time:5, pickup_label:'리슈빌', pickup_time:'15:30:00', effective_from:'2026-09-01', effective_to:null },
      { id:'p2', student_name:'최서윤', weekday:1, class_time:5, pickup_label:'정문', pickup_time:'17:00:00', effective_from:'2026-09-01', effective_to:null },
      { id:'p3', student_name:'다른날', weekday:2, class_time:5, pickup_label:'정문', pickup_time:'17:10:00', effective_from:'2026-09-01', effective_to:null }
    ]
  };
  const schedule = loadSchedule(week, [
    { id:'p1', is_dropoff:false },
    { id:'p2', is_dropoff:true },
    { id:'p3', is_dropoff:true }
  ]);

  const result = await schedule.findPickups({
    date:'2026-09-21',
    dateLabel:'오늘',
    classTime:5,
    kind:'dropoff'
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].student_name, '최서윤');
  assert.equal(result.items[0].is_dropoff, true);
  const message = schedule.describePickups(result);
  assert.match(message, /1명이에요/);
  assert.match(message, /최서윤/);
  assert.match(message, /하원/);
});

test('pickup description counts unique students and shows pickup/dropoff details', () => {
  const schedule = loadSchedule({ pickups:[] });
  const message = schedule.describePickups({
    date:'2026-09-23',
    dateLabel:'오늘',
    classTime:4,
    kind:'all',
    items:[
      { student_id:'s1', student_name:'김민서', class_time:4, pickup_label:'리슈빌', pickup_time:'15:30:00', is_dropoff:false },
      { student_id:'s1', student_name:'김민서', class_time:4, pickup_label:'정문', pickup_time:'17:10:00', is_dropoff:true },
      { student_id:'s2', student_name:'최서윤', class_time:4, pickup_label:'센트럴', pickup_time:'15:40:00', is_dropoff:false }
    ]
  });

  assert.match(message, /픽업 관리 학생은 2명이에요/);
  assert.match(message, /김민서/);
  assert.match(message, /최서윤/);
  assert.match(message, /등원 픽업/);
  assert.match(message, /하원 픽업/);
});

test('existing availability lookup remains a read query', () => {
  const router = loadRouter();
  const classified = router.classifyRequest('10월 4일 초등부 5시 자리 있어?');
  assert.equal(classified.type, 'query');
  assert.equal(classified.intent, 'find_available_slots');
});

test('PC AI uses Olli read query before calling OpenAI and keeps query result out of AI history', () => {
  const queryIndex = pcTalkSource.indexOf("typeof router.runQuery === 'function'");
  const openAiIndex = pcTalkSource.indexOf('const resolved = await resolveAiReply(commandText, current)', queryIndex);
  assert.ok(queryIndex >= 0);
  assert.ok(openAiIndex > queryIndex);

  const block = pcTalkSource.slice(queryIndex, openAiIndex);
  assert.match(block, /saveAssistantReply\(current, queryMessage, replyToMessageId\)/);
  assert.match(block, /recordAi:false/);
});


test('short weekday/time text is treated as a recurring schedule lookup', () => {
  const router = loadRouter();

  const elementary = router.parseAvailableSlotsIntent('초등 화요일 4시');
  assert.ok(elementary);
  assert.equal(elementary.scope, 'recurring');
  assert.equal(elementary.viewMode, 'schedule');
  assert.equal(elementary.division, 'elementary');
  assert.equal(elementary.weekday, 2);
  assert.equal(elementary.timeSlot, 4);

  const both = router.parseAvailableSlotsIntent('화요일 4시');
  assert.ok(both);
  assert.equal(both.scope, 'recurring');
  assert.equal(both.viewMode, 'schedule');
  assert.equal(both.division, '');
  assert.equal(both.weekday, 2);
  assert.equal(both.timeSlot, 4);

  const kinder = router.parseAvailableSlotsIntent('유치부 화요일 4시?');
  assert.ok(kinder);
  assert.equal(kinder.division, 'kinder');
});

test('short schedule lookup does not swallow unrelated weekday/time sentences', () => {
  const router = loadRouter();
  assert.equal(router.parseAvailableSlotsIntent('화요일 4시에 회의 있어'), null);
});

test('schedule lookup describes current seats and future changes for both divisions', () => {
  const schedule = loadSchedule({});
  const elementary = {
    division:'elementary',
    weekday:2,
    timeSlot:4,
    classGroup:'A',
    grouped:false,
    regularCount:3,
    capacity:5,
    remaining:2,
    safeRegularRemaining:1
  };
  const kinder = {
    division:'kinder',
    weekday:2,
    timeSlot:4,
    classGroup:'A',
    grouped:false,
    regularCount:4,
    capacity:5,
    remaining:1,
    safeRegularRemaining:1
  };

  const message = schedule.describeRecurringAvailability({
    scope:'recurring',
    viewMode:'schedule',
    division:'',
    weekday:2,
    timeSlot:4,
    allSlots:[elementary, kinder],
    displaySlots:[elementary, kinder],
    regularChanges:[{
      ...elementary,
      date:'2026-10-06',
      regularCount:4,
      remaining:1
    }],
    oneTimeExceptions:[{
      ...elementary,
      date:'2026-09-29',
      makeupCount:1,
      trialCount:0,
      remaining:1
    }]
  });

  assert.match(message, /초등부 화요일 4시는 현재 정규수업 기준 2자리 있습니다/);
  assert.match(message, /10월 6일부터 정규 등록 \+1명 예정/);
  assert.match(message, /9월 29일은 보강 1명이 예약되어 있어 1자리 있습니다/);
  assert.match(message, /유치부 화요일 4시는 현재 정규수업 기준 1자리 있습니다/);
});

test('combined short schedule lookup explicitly reports a missing division', () => {
  const schedule = loadSchedule({});
  const elementary = {
    division:'elementary',
    weekday:2,
    timeSlot:4,
    classGroup:'A',
    grouped:false,
    regularCount:3,
    capacity:5,
    remaining:2,
    safeRegularRemaining:2
  };

  const message = schedule.describeRecurringAvailability({
    scope:'recurring',
    viewMode:'schedule',
    division:'',
    weekday:2,
    timeSlot:4,
    allSlots:[elementary],
    displaySlots:[elementary],
    regularChanges:[],
    oneTimeExceptions:[]
  });

  assert.match(message, /초등부 화요일 4시는 현재 정규수업 기준 2자리 있습니다/);
  assert.match(message, /유치부 화요일 4시는 운영 수업이 없어요/);
});


test('student info lookup parser extracts an exact student name without treating it as a schedule query', () => {
  const router = loadRouter();

  const spaced = router.parseStudentInfoLookupIntent('금오주 학생 정보');
  assert.ok(spaced);
  assert.equal(spaced.intent, 'open_student_info');
  assert.equal(spaced.studentName, '금오주');

  const compact = router.parseStudentInfoLookupIntent('금오주 학생정보');
  assert.ok(compact);
  assert.equal(compact.studentName, '금오주');

  const request = router.parseStudentInfoLookupIntent('금오주 학생 정보 열어줘');
  assert.ok(request);
  assert.equal(request.studentName, '금오주');

  assert.equal(router.parseStudentInfoLookupIntent('금오주 4시 자리 있어?'), null);
  assert.equal(router.parseStudentInfoLookupIntent('학생 정보'), null);
});

test('Olli reply accepts one temporal signal plus any short schedule target word', () => {
  const router = loadRouter();
  const temporal = ['10월 4일', '월요일', '4시'];
  const targets = ['보강', '대기', '체험', '자리', '빈자리', '여석'];

  temporal.forEach(time => {
    targets.forEach(target => {
      const text = time + ' ' + target;
      assert.equal(router.isOlliReplyCandidate(text), true, text);
      const query = router.parseAvailableSlotsIntent(text);
      assert.ok(query, text);
      assert.equal(query.intent, 'find_available_slots', text);
      assert.equal(query.viewMode, 'availability', text);
    });
  });

  assert.equal(router.isOlliReplyCandidate('월요일 체함'), true);
  assert.equal(router.parseAvailableSlotsIntent('월요일 체함').purpose, 'trial');

  assert.equal(router.isOlliReplyCandidate('월요일 보강 등록해줘'), false);
  assert.equal(router.parseAvailableSlotsIntent('월요일 보강 등록해줘'), null);
  assert.equal(router.isOlliReplyCandidate('월요일 회의'), false);
  assert.equal(router.isOlliReplyCandidate('보강'), false);
});

test('Olli reply button runs terse one-signal schedule combinations directly', async () => {
  let calls = 0;
  const router = loadRouter({
    async findRecurringAvailability(options) {
      calls += 1;
      assert.equal(options.weekday, 1);
      assert.equal(options.timeSlot, 0);
      assert.equal(options.purpose, 'makeup');
      assert.equal(options.viewMode, 'availability');
      return {
        scope:'recurring',
        viewMode:'availability',
        purpose:'makeup',
        weekday:1,
        timeSlot:0,
        displaySlots:[],
        allSlots:[]
      };
    },
    describeRecurringAvailability() {
      return '월요일 보강 가능 시간을 확인했어요.';
    }
  });

  const result = await router.runSuggestedQuery('월요일 보강', { source:'olli_talk_reply_button' });
  assert.equal(result.handled, true);
  assert.equal(calls, 1);
  assert.match(result.message, /월요일 보강/);
});

test('Olli reply suggestion accepts either two temporal signals or one temporal signal with a schedule inquiry', () => {
  const router = loadRouter();
  assert.equal(router.isOlliReplyCandidate('10월 4일 5시 자리 어때?'), true);
  assert.equal(router.isOlliReplyCandidate('화요일 4시 자리 어때?'), true);
  assert.equal(router.isOlliReplyCandidate('10월 4일 화요일 괜찮아?'), true);
  assert.equal(router.isOlliReplyCandidate('다음주 화요일 가능해?'), true);

  assert.equal(router.isOlliReplyCandidate('4시 자리 있어?'), true);
  assert.equal(router.isOlliReplyCandidate('월요일 자리 있어?'), true);
  assert.equal(router.isOlliReplyCandidate('10월 4일 자리 있어?'), true);
  assert.equal(router.isOlliReplyCandidate('4시 대기 가능해?'), true);
  assert.equal(router.isOlliReplyCandidate('화요일 체험 가능해?'), true);
  assert.equal(router.isOlliReplyCandidate('10월 4일 보강 가능해?'), true);

  assert.equal(router.isOlliReplyCandidate('화요일 수업 어때?'), false);
  assert.equal(router.isOlliReplyCandidate('4시 회의 있어?'), false);
  assert.equal(router.isOlliReplyCandidate('월요일 보강 등록해줘'), false);
});

test('Olli reply suggestion routes a one-signal seat question when the response button is pressed', async () => {
  let recurringCalls = 0;
  const router = loadRouter({
    async findRecurringAvailability(options) {
      recurringCalls += 1;
      assert.equal(options.weekday, 0);
      assert.equal(options.timeSlot, 4);
      return { displaySlots:[], allSlots:[] };
    },
    describeRecurringAvailability() {
      return '4시 빈자리를 확인했어요.';
    }
  });

  const result = await router.runSuggestedQuery('4시 자리 있어?', { source:'olli_talk_reply_button' });
  assert.equal(result.handled, true);
  assert.equal(recurringCalls, 1);
  assert.match(result.message, /4시/);
});

test('Olli reply suggestion can turn temporal shorthand into a read query only when explicitly requested', async () => {
  let recurringCalls = 0;
  const router = loadRouter({
    async findRecurringAvailability(options) {
      recurringCalls += 1;
      assert.equal(options.weekday, 2);
      assert.equal(options.timeSlot, 4);
      return { displaySlots:[], allSlots:[] };
    },
    describeRecurringAvailability() {
      return '화요일 4시 시간표예요.';
    }
  });
  const result = await router.runSuggestedQuery('화요일 4시 확인', { source:'olli_talk_reply_button' });
  assert.equal(result.handled, true);
  assert.equal(recurringCalls, 1);
  assert.match(result.message, /화요일 4시/);
});

test('PC renders a small Olli reply button only on eligible own messages and reuses reply_to_message_id', () => {
  assert.match(pcTalkSource, /shouldOfferOlliReply\(item, own, options\.olliReplyTargetIds\)/);
  assert.match(pcTalkSource, /router\.isOlliReplyCandidate\(body\)/);
  assert.match(pcTalkSource, /olliPcTeamTalkReplySuggestionButton/);
  assert.match(pcTalkSource, /allowSuggestedQuery:true/);
  assert.match(pcTalkSource, /reply_to_message_id/);
  assert.match(pcTalkSource, /removeOlliReplySuggestion/);
});
