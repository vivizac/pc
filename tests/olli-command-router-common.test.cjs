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

test('one-minute submit checks command router before legacy name parsing', () => {
  const submitStart = registration.indexOf('window.submitKinderChatFeedback = async function');
  const submitEnd = registration.indexOf('window.openKinderChatFeedbackSaveStudentPicker', submitStart);
  const submit = registration.slice(submitStart, submitEnd);
  const routeIndex = submit.indexOf('OlliCommandRouter.route');
  const legacyParserIndex = submit.indexOf('parseKcfTypedStudentInput(text)');

  assert.ok(routeIndex >= 0);
  assert.ok(legacyParserIndex > routeIndex);
  assert.match(submit, /commandRoute\.handled === true/);
  assert.match(submit, /addKinderChatMessage\('user'/);
  assert.match(submit, /기존 피드백 흐름을 계속합니다/);
});

test('PC loads command schedule and router before shared feedback registration', () => {
  const scheduleIndex = html.indexOf('olli-command-schedule-common.js');
  const routerIndex = html.indexOf('olli-command-router-common.js');
  const registrationIndex = html.indexOf('olli-feedback-registration-runtime.js');
  assert.ok(scheduleIndex >= 0);
  assert.ok(routerIndex > scheduleIndex);
  assert.ok(registrationIndex > routerIndex);
});
