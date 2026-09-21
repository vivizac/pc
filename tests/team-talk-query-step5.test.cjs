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
