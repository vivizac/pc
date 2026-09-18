const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const routerSource = fs.readFileSync('olli-command-router-common.js', 'utf8');
const registration = fs.readFileSync('olli-feedback-registration-runtime.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

function loadRouter(scheduleStub) {
  const sandbox = { window: {}, console, Date };
  if (scheduleStub) sandbox.window.OlliCommandSchedule = scheduleStub;
  vm.runInNewContext(routerSource, sandbox);
  return sandbox.window.OlliCommandRouter;
}

test('different Korean phrasings normalize to the same available-slot intent', () => {
  const router = loadRouter();
  const cases = [
    ['오늘 보강 가능한 시간을 알려줘', 'makeup'],
    ['오늘 보강 할수있는 시간이 있어?', 'makeup'],
    ['오늘 시간표 중 자리가 남는 클래스를 알려줄래?', 'unknown']
  ];

  cases.forEach(([text, purpose]) => {
    const parsed = router.parseAvailableSlotsIntent(text);
    assert.equal(parsed.intent, 'find_available_slots');
    assert.equal(parsed.date, 'today');
    assert.equal(parsed.dateLabel, '오늘');
    assert.equal(parsed.purpose, purpose);
  });
});

test('division and purpose are extracted without requiring one exact command phrase', () => {
  const router = loadRouter();
  const trial = router.parseAvailableSlotsIntent('오늘 유치부 체험수업 가능한 자리 있어?');
  assert.equal(trial.division, 'kinder');
  assert.equal(trial.purpose, 'trial');

  const enrollment = router.parseAvailableSlotsIntent('오늘 초등부 신규 학생 들어갈 수 있는 반 있어?');
  assert.equal(enrollment.division, 'elementary');
  assert.equal(enrollment.purpose, 'new_enrollment');
});

test('recognized availability query is handled by shared schedule service', async () => {
  let received = null;
  const router = loadRouter({
    async findAvailableSlots(options) {
      received = options;
      return { closedDay:false, purpose:options.purpose, division:options.division, slots:[] };
    },
    describeAvailableSlots() {
      return '오늘 빈자리를 확인했어요.';
    }
  });

  const result = await router.route('오늘 초등부 보강 가능한 시간을 알려줘', {
    source:'one_minute_feedback'
  });
  assert.equal(result.handled, true);
  assert.equal(result.kind, 'command_result');
  assert.equal(result.intent, 'find_available_slots');
  assert.equal(result.clearInput, true);
  assert.equal(result.message, '오늘 빈자리를 확인했어요.');
  assert.equal(received.division, 'elementary');
  assert.equal(received.purpose, 'makeup');
});

test('ordinary feedback text still passes through unchanged', async () => {
  const router = loadRouter();
  const result = await router.route('오늘 촉감놀이에 집중했고 자신의 감정을 잘 이야기함', {
    source:'one_minute_feedback'
  });
  assert.equal(result.handled, false);
  assert.equal(result.kind, 'feedback');
  assert.equal(result.text, '오늘 촉감놀이에 집중했고 자신의 감정을 잘 이야기함');
  assert.equal(result.clearInput, false);
});

test('one-minute submit routes commands first and no longer requires legacy first-line names', () => {
  const submitStart = registration.indexOf('window.submitKinderChatFeedback = async function');
  const submitEnd = registration.indexOf('window.openKinderChatFeedbackSaveStudentPicker', submitStart);
  const submit = registration.slice(submitStart, submitEnd);
  const routeIndex = submit.indexOf('OlliCommandRouter.route');

  assert.ok(routeIndex >= 0);
  assert.match(submit, /commandRoute\.handled === true/);
  assert.doesNotMatch(submit, /parseKcfTypedStudentInput/);
  assert.doesNotMatch(submit, /학생을 먼저 선택해 주세요/);
  assert.match(submit, /아직 이 문장은 실행 가능한 명령으로 연결되지 않았어요/);
  assert.match(registration, /renderKinderChatFeedbackCommandConfirmation/);
  assert.match(registration, /submitKinderChatFeedbackCommandChoice/);
});

test('PC loads command schedule and router before shared feedback registration', () => {
  const scheduleIndex = html.indexOf('olli-command-schedule-common.js');
  const routerIndex = html.indexOf('olli-command-router-common.js');
  const registrationIndex = html.indexOf('olli-feedback-registration-runtime.js');
  assert.ok(scheduleIndex >= 0);
  assert.ok(routerIndex > scheduleIndex);
  assert.ok(registrationIndex > routerIndex);
});


test('schedule-move availability is a read query purpose', () => {
  const router = loadRouter();
  const parsed = router.parseAvailableSlotsIntent('오늘 수업 이동 가능한 시간 알려줘');
  assert.equal(parsed.intent, 'find_available_slots');
  assert.equal(parsed.purpose, 'schedule_move');
});

test('specific class move wording parses as a write command', () => {
  const router = loadRouter();
  const parsed = router.parseScheduleMoveMutationIntent('최민기 월요일 수업을 수요일 4시로 변경');
  assert.equal(parsed.intent, 'move_class');
  assert.equal(parsed.type, 'mutation');
  assert.equal(parsed.studentName, '최민기');
  assert.equal(parsed.sourceWeekday, 1);
  assert.equal(parsed.sourceTimeSlot, 0);
  assert.equal(parsed.targetWeekday, 3);
  assert.equal(parsed.targetTimeSlot, 4);
});

test('makeup write wording parses date, time, and optional class group', () => {
  const router = loadRouter();
  const parsed = router.parseMakeupMutationIntent('김태리 다음 주 월요일 4시 B반 보강 넣어줘');
  assert.equal(parsed.intent, 'add_makeup');
  assert.equal(parsed.studentName, '김태리');
  assert.equal(parsed.dateSpec.mode, 'next_weekday');
  assert.equal(parsed.dateSpec.weekday, 1);
  assert.equal(parsed.timeSlot, 4);
  assert.equal(parsed.classGroup, 'B');
});

test('write command requires confirmation before execution', async () => {
  let prepared = null;
  let executed = null;
  const router = loadRouter({
    async prepareWriteCommand(intent, options) {
      prepared = { intent, options };
      return {
        ok:true,
        command:{ intent, studentId:'student-1', studentName:'최민기', marker:'prepared' },
        message:'이 작업을 진행할까요?'
      };
    },
    async executePreparedWrite(command) {
      executed = command;
      return { ok:true, result:'applied' };
    },
    writeSuccessMessage() {
      return '시간표를 변경했어요.';
    }
  });

  const first = await router.route('최민기 월요일 수업을 수요일 4시로 변경', {
    source:'one_minute_feedback'
  });
  assert.equal(first.handled, true);
  assert.equal(first.kind, 'command_confirmation');
  assert.equal(first.intent, 'move_class');
  assert.equal(prepared.intent, 'move_class');
  assert.equal(executed, null);
  assert.equal(router.getPendingWriteCommand().marker, 'prepared');

  const second = await router.route('확인', { source:'one_minute_feedback' });
  assert.equal(second.handled, true);
  assert.equal(second.kind, 'command_result');
  assert.equal(second.message, '시간표를 변경했어요.');
  assert.equal(executed.marker, 'prepared');
  assert.equal(router.getPendingWriteCommand(), null);
});

test('write command can be cancelled without execution', async () => {
  let executed = false;
  const router = loadRouter({
    async prepareWriteCommand(intent) {
      return { ok:true, command:{ intent, studentId:'student-1' }, message:'진행할까요?' };
    },
    async executePreparedWrite() {
      executed = true;
      return {};
    }
  });

  const first = await router.route('김태리 금요일 4시 보강 넣어줘', {
    source:'one_minute_feedback'
  });
  assert.equal(first.kind, 'command_confirmation');
  const cancelled = await router.route('취소', { source:'one_minute_feedback' });
  assert.equal(cancelled.kind, 'command_result');
  assert.match(cancelled.message, /취소/);
  assert.equal(executed, false);
  assert.equal(router.getPendingWriteCommand(), null);
});


test('date expressions resolve today, tomorrow, this week, next week, and upcoming weekdays', () => {
  const router = loadRouter();
  const base = new Date(2026, 8, 18, 12, 0, 0); // Friday

  const cases = [
    ['오늘 초등부 자리 있어?', 'today', '오늘', '2026-09-18'],
    ['내일 초등부 자리 있어?', 'tomorrow', '내일', '2026-09-19'],
    ['이번 주 수요일 초등부 자리 있어?', 'this_weekday', '이번 주 수요일', '2026-09-16'],
    ['다음 주 월요일 보강 가능한 시간 있어?', 'next_weekday', '다음 주 월요일', '2026-09-21'],
    ['월요일 체험 가능한 자리 있어?', 'upcoming_weekday', '월요일', '2026-09-21'],
    ['금요일 수업 이동 가능한 시간 알려줘', 'upcoming_weekday', '금요일', '2026-09-18']
  ];

  function key(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  cases.forEach(([text, mode, label, expected]) => {
    const parsed = router.parseAvailableSlotsIntent(text);
    assert.equal(parsed.dateSpec.mode, mode);
    assert.equal(parsed.dateLabel, label);
    assert.equal(key(router.resolveDateExpression(parsed.dateSpec, base)), expected);
  });
});


test('waitlist add wording parses enrolled or guest wait intent', () => {
  const router = loadRouter();

  const enrolled = router.parseWaitlistMutationIntent('최민기 월요일 4시 대기 넣어줘');
  assert.equal(enrolled.intent, 'add_waitlist');
  assert.equal(enrolled.studentName, '최민기');
  assert.equal(enrolled.dateSpec.weekday, 1);
  assert.equal(enrolled.timeSlot, 4);

  const guest = router.parseWaitlistMutationIntent('유치부 박하늘 화요일 5시 대기 추가해줘');
  assert.equal(guest.intent, 'add_waitlist');
  assert.equal(guest.studentName, '박하늘');
  assert.equal(guest.division, 'kinder');
  assert.equal(guest.dateSpec.weekday, 2);
  assert.equal(guest.timeSlot, 5);
});

test('trial add wording parses guest name, division, date, time, and class group', () => {
  const router = loadRouter();
  const parsed = router.parseTrialMutationIntent('유치부 박하늘 내일 4시 B반 체험수업 등록해줘');

  assert.equal(parsed.intent, 'add_trial');
  assert.equal(parsed.guestName, '박하늘');
  assert.equal(parsed.division, 'kinder');
  assert.equal(parsed.dateSpec.mode, 'tomorrow');
  assert.equal(parsed.timeSlot, 4);
  assert.equal(parsed.classGroup, 'B');
});

test('makeup cancellation wording parses optional date and time', () => {
  const router = loadRouter();

  const detailed = router.parseMakeupCancelMutationIntent('김태리 오늘 4시 보강 취소해줘');
  assert.equal(detailed.intent, 'cancel_makeup');
  assert.equal(detailed.studentName, '김태리');
  assert.equal(detailed.dateSpec.mode, 'today');
  assert.equal(detailed.timeSlot, 4);

  const short = router.parseMakeupCancelMutationIntent('김태리 보강 취소해줘');
  assert.equal(short.intent, 'cancel_makeup');
  assert.equal(short.studentName, '김태리');
  assert.equal(short.dateSpec, null);
  assert.equal(short.timeSlot, 0);
});

test('scheduled move cancellation wording parses optional source day and time', () => {
  const router = loadRouter();

  const detailed = router.parseMoveCancelMutationIntent('최민기 월요일 4시 수업이동 취소해줘');
  assert.equal(detailed.intent, 'cancel_move');
  assert.equal(detailed.studentName, '최민기');
  assert.equal(detailed.sourceWeekday, 1);
  assert.equal(detailed.sourceTimeSlot, 4);

  const short = router.parseMoveCancelMutationIntent('최민기 수업이동 취소해줘');
  assert.equal(short.intent, 'cancel_move');
  assert.equal(short.studentName, '최민기');
  assert.equal(short.sourceWeekday, 0);
});

test('new write commands all enter the same confirmation pipeline', async () => {
  const preparedIntents = [];
  const router = loadRouter({
    async prepareWriteCommand(intent, options) {
      preparedIntents.push({ intent, options });
      return {
        ok:true,
        command:{ intent, marker:intent },
        message:'실행할까요?'
      };
    },
    async executePreparedWrite(command) {
      return { ok:true, marker:command.marker };
    },
    writeSuccessMessage(command) {
      return command.intent + ' 완료';
    }
  });

  const cases = [
    ['최민기 월요일 4시 대기 넣어줘', 'add_waitlist'],
    ['유치부 박하늘 내일 4시 체험 등록해줘', 'add_trial'],
    ['김태리 오늘 4시 보강 취소해줘', 'cancel_makeup'],
    ['최민기 수업이동 취소해줘', 'cancel_move']
  ];

  for (const [text, intent] of cases) {
    const result = await router.route(text, { source:'one_minute_feedback' });
    assert.equal(result.handled, true);
    assert.equal(result.kind, 'command_confirmation');
    assert.equal(result.intent, intent);

    const cancelled = await router.route('취소', { source:'one_minute_feedback' });
    assert.equal(cancelled.kind, 'command_result');
  }

  assert.deepEqual(preparedIntents.map(item => item.intent), [
    'add_waitlist',
    'add_trial',
    'cancel_makeup',
    'cancel_move'
  ]);
});


test('makeup cancellation accepts natural word order, possessive, scheduled filler, and delete synonyms', () => {
  const router = loadRouter();
  const cases = [
    '다음주 수요일 5시에 잡혀있는 테스트2의 보강을 삭제해줘',
    '테스트2의 다음주 수요일 5시 보강을 삭제해줘',
    '다음주 수요일 5시에 잡혀있는 테스트2의 보강을 취소해줘',
    '테스트2 다음주 수요일 5시 보강 취소해줘'
  ];

  cases.forEach((text) => {
    const parsed = router.parseMakeupCancelMutationIntent(text);
    assert.equal(parsed.intent, 'cancel_makeup');
    assert.equal(parsed.studentName, '테스트2');
    assert.equal(parsed.dateSpec.mode, 'next_weekday');
    assert.equal(parsed.dateSpec.weekday, 3);
    assert.equal(parsed.timeSlot, 5);
  });

  const short = router.parseMakeupCancelMutationIntent('테스트2의 보강을 지워줘');
  assert.equal(short.intent, 'cancel_makeup');
  assert.equal(short.studentName, '테스트2');
  assert.equal(short.dateSpec, null);
});

test('natural makeup delete sentence enters confirmation pipeline', async () => {
  let prepared = null;
  const router = loadRouter({
    async prepareWriteCommand(intent, options) {
      prepared = { intent, options };
      return {
        ok:true,
        command:{ intent, studentId:'student-test2', oneTimeSessionId:'makeup-test2' },
        message:'이 보강을 취소할까요?'
      };
    }
  });

  const result = await router.route('다음주 수요일 5시에 잡혀있는 테스트2의 보강을 삭제해줘', {
    source:'one_minute_feedback'
  });

  assert.equal(result.handled, true);
  assert.equal(result.kind, 'command_confirmation');
  assert.equal(result.intent, 'cancel_makeup');
  assert.equal(prepared.intent, 'cancel_makeup');
  assert.equal(prepared.options.studentName, '테스트2');
  assert.equal(prepared.options.timeSlot, 5);
  assert.ok(prepared.options.date instanceof Date);
  assert.equal(prepared.options.date.getFullYear(), 2026);
  assert.equal(prepared.options.date.getMonth(), 8);
  assert.equal(prepared.options.date.getDate(), 23);
});


test('command language normalization accepts common synonyms and different word order across current read/write features', () => {
  const router = loadRouter();

  const cases = [
    ['parseMakeupMutationIntent', '다음주 수요일 5시에 김태리 보강 잡아줘', 'add_makeup', '김태리'],
    ['parseMakeupMutationIntent', '김태리 차주 수요일 5시 보충수업 예약해줘', 'add_makeup', '김태리'],
    ['parseMakeupMutationIntent', '금주 수요일 5시 김태리 보강 배정해줘', 'add_makeup', '김태리'],

    ['parseWaitlistMutationIntent', '월요일 4시에 최민기 웨이팅 걸어줘', 'add_waitlist', '최민기'],
    ['parseWaitlistMutationIntent', '유치부 박하늘 화요일 5시 대기명단에 추가해줘', 'add_waitlist', '박하늘'],
    ['parseWaitlistMutationIntent', '박하늘 유치부 화요일 5시 대기 예약해줘', 'add_waitlist', '박하늘'],

    ['parseTrialMutationIntent', '내일 4시에 유치부 박하늘 체험수업 잡아줘', 'add_trial', '박하늘'],
    ['parseTrialMutationIntent', '박하늘 유치부 내일 4시 체험클래스 예약해줘', 'add_trial', '박하늘'],
    ['parseTrialMutationIntent', '내일 4시 박하늘 유치부 체험 수업 신청해줘', 'add_trial', '박하늘'],

    ['parseScheduleMoveMutationIntent', '월요일 수업 최민기 수요일 4시로 옮겨주세요', 'move_class', '최민기'],
    ['parseScheduleMoveMutationIntent', '최민기 월요일 4시에서 수요일 5시로 바꿔줘', 'move_class', '최민기'],

    ['parseMakeupCancelMutationIntent', '다음주 수요일 5시 테스트2 보충수업 빼줘', 'cancel_makeup', '테스트2'],
    ['parseMakeupCancelMutationIntent', '테스트2 금주 수요일 5시 보강 없애줘', 'cancel_makeup', '테스트2'],

    ['parseMoveCancelMutationIntent', '월요일 4시 최민기 시간표 변경 예약 삭제해줘', 'cancel_move', '최민기'],
    ['parseMoveCancelMutationIntent', '최민기 수업이동 없애줘', 'cancel_move', '최민기']
  ];

  cases.forEach(([fn, text, intent, name]) => {
    const parsed = router[fn](text);
    assert.ok(parsed, text);
    assert.equal(parsed.intent, intent, text);
    assert.equal(parsed.studentName || parsed.guestName, name, text);
  });
});

test('availability read commands accept natural lookup synonyms', () => {
  const router = loadRouter();
  const cases = [
    ['월요일 보강 여유 있는 시간 체크해줘', 'makeup', 'upcoming_weekday'],
    ['내일 유치부 자리 몇 개 남았어?', 'unknown', 'tomorrow'],
    ['금일 초등 빈곳 조회해줘', 'unknown', 'today'],
    ['차주 금요일 체험 가능한 반 봐줘', 'trial', 'next_weekday'],
    ['다음주 수요일 초등부 자리 남아 있어?', 'unknown', 'next_weekday']
  ];

  cases.forEach(([text, purpose, mode]) => {
    const parsed = router.parseAvailableSlotsIntent(text);
    assert.ok(parsed, text);
    assert.equal(parsed.intent, 'find_available_slots', text);
    assert.equal(parsed.purpose, purpose, text);
    assert.equal(parsed.dateSpec.mode, mode, text);
  });
});

test('date language normalization treats 금일·금주·차주 as canonical dates', () => {
  const router = loadRouter();
  assert.equal(router.parseAvailableSlotsIntent('금일 초등 빈자리 알려줘').dateSpec.mode, 'today');
  assert.equal(router.parseAvailableSlotsIntent('금주 수요일 초등 자리 있어?').dateSpec.mode, 'this_weekday');
  assert.equal(router.parseAvailableSlotsIntent('차주 금요일 초등 자리 있어?').dateSpec.mode, 'next_weekday');
});

test('pending write confirmation accepts explicit natural confirmation and cancellation variants', async () => {
  let executeCount = 0;
  const router = loadRouter({
    async prepareWriteCommand(intent) {
      return { ok:true, command:{ intent, marker:'pending' }, message:'진행할까요?' };
    },
    async executePreparedWrite(command) {
      executeCount += 1;
      return { ok:true, marker:command.marker };
    },
    writeSuccessMessage() { return '완료'; }
  });

  await router.route('김태리 내일 4시 보강 추가해줘', { source:'one_minute_feedback' });
  const confirmed = await router.route('확인해줘', { source:'one_minute_feedback' });
  assert.equal(confirmed.kind, 'command_result');
  assert.equal(executeCount, 1);

  await router.route('김태리 내일 4시 보강 추가해줘', { source:'one_minute_feedback' });
  const cancelled = await router.route('안할래', { source:'one_minute_feedback' });
  assert.equal(cancelled.kind, 'command_result');
  assert.equal(executeCount, 1);
});


test('direct availability wording keeps requested time and class group', async () => {
  let described = null;
  const router = loadRouter({
    async findAvailableSlots() {
      return {
        date:'2026-09-21',
        dateLabel:'월요일',
        division:'elementary',
        purpose:'unknown',
        slots:[
          { division:'elementary', timeSlot:4, classGroup:'A', remaining:2 },
          { division:'elementary', timeSlot:4, classGroup:'B', remaining:1 },
          { division:'elementary', timeSlot:5, classGroup:'A', remaining:3 }
        ]
      };
    },
    describeAvailableSlots(result) {
      described = result;
      return '조회 완료';
    }
  });

  const parsed = router.parseAvailableSlotsIntent('월요일 4시 A반 자리 확인해줘');
  assert.equal(parsed.timeSlot, 4);
  assert.equal(parsed.classGroup, 'A');

  const result = await router.route('월요일 4시 A반 자리 확인해줘', {
    source:'one_minute_feedback'
  });
  assert.equal(result.handled, true);
  assert.equal(result.intent, 'find_available_slots');
  assert.equal(described.slots.length, 1);
  assert.equal(described.slots[0].timeSlot, 4);
  assert.equal(described.slots[0].classGroup, 'A');
});


test('shared add-action vocabulary accepts common scheduling verbs and conversational variants', () => {
  const router = loadRouter();
  const actions = [
    '추가해줘', '넣어줘', '입력해줘', '등록해줘', '잡아줘',
    '예약해줘', '신청해줘', '배정해줘', '올려줘', '만들어줘',
    '생성해줘', '기록해줘', '적어줘', '반영해줘', '저장해줘',
    '기입해줘', '기재해줘',
    '추가해놔줘', '넣어놔줘', '입력해둘래', '등록해놔줘',
    '잡아둘래', '예약해놔줘', '추가 좀 해줘'
  ];

  actions.forEach((action) => {
    const parsed = router.parseMakeupMutationIntent(
      '김태리 다음주 수요일 5시 보강 ' + action
    );
    assert.ok(parsed, action);
    assert.equal(parsed.intent, 'add_makeup', action);
    assert.equal(parsed.studentName, '김태리', action);
    assert.equal(parsed.timeSlot, 5, action);
  });
});

test('expanded add-action vocabulary is shared by waitlist and trial commands', () => {
  const router = loadRouter();

  const waitCases = [
    '최민기 월요일 4시 대기 입력해줘',
    '유치부 박하늘 화요일 5시 대기명단에 저장해줘',
    '월요일 4시 최민기 웨이팅 추가해놔줘'
  ];
  waitCases.forEach((text) => {
    const parsed = router.parseWaitlistMutationIntent(text);
    assert.ok(parsed, text);
    assert.equal(parsed.intent, 'add_waitlist', text);
  });

  const trialCases = [
    '박하늘 유치부 내일 4시 체험수업 입력해줘',
    '내일 4시 박하늘 유치부 체험클래스 만들어줘',
    '박하늘 유치부 내일 4시 체험 반영해줘'
  ];
  trialCases.forEach((text) => {
    const parsed = router.parseTrialMutationIntent(text);
    assert.ok(parsed, text);
    assert.equal(parsed.intent, 'add_trial', text);
    assert.equal(parsed.guestName, '박하늘', text);
  });
});
