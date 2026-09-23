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
