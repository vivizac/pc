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
