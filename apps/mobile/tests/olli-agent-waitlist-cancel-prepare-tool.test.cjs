const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  requestedTimeLabel,
  stableWaitlistCancelActionClientMessageId,
  weekdayFromDateKey,
  prepareWaitlistCancelAction,
} = require('../api/_lib/olli-agent/tools/waitlist-cancel-prepare-tools.cjs');
const {
  resolveWaitlistCancelPrepareScope,
} = require('../api/_lib/olli-agent/runtime.cjs');

function requestContext() {
  return {
    sessionToken:'server-session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}

function subjectAccess(division='elementary') {
  return {
    resolve(label) {
      if (label !== '학생A') return null;
      return {
        studentId:'33333333-3333-4333-8333-333333333333',
        division,
      };
    },
  };
}

function row(overrides={}) {
  return Object.assign({
    id:'44444444-4444-4444-8444-444444444444',
    student_id:'33333333-3333-4333-8333-333333333333',
    student_name:'실제학생',
    division:'elementary',
    is_guest:false,
    target_weekday:5,
    target_time_slot:10,
    target_class_group:'A',
    desired_effective_date:'2026-10-02',
    status:'waiting',
  }, overrides);
}

function baseRpc({ rows, sentAction } = {}) {
  const calls=[];
  const rpc=async (name, params) => {
    calls.push({name, params});
    if (name === 'olli_student_data_access') {
      return {
        ok:true,
        rows:[{
          id:'33333333-3333-4333-8333-333333333333',
          name:'실제학생',
          division:'elementary',
          status:'active',
          is_deleted:false,
        }],
      };
    }
    if (name === 'olli_schedule_week') {
      return {
        ok:true,
        timetable_mode:'half_hour',
        waitlist:rows || [row()],
      };
    }
    if (name === 'olli_team_chat_send_action') {
      return sentAction || {
        ok:true,
        message:{
          id:903,
          body:'대기를 취소할까요?',
          action:{ id:'action-3', action_type:'cancel_waitlist', status:'pending' },
        },
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('waitlist cancel resolves the active row server-side and stores only a pending cancel_waitlist action', async () => {
  const {rpc,calls}=baseRpc();
  const result=await prepareWaitlistCancelAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    classGroup:'AUTO',
    waitlistDate:'2026-10-02',
    classHour:4,
    classMinute:30,
    currentDate:'2026-10-01',
    requestId:'req-wait-cancel-1',
    sanitizePayload(payload){ return payload; },
    callRpc:rpc,
  });

  assert.equal(result.action_type,'cancel_waitlist');
  assert.equal(result.weekday_label,'금요일');
  assert.equal(result.time_label,'4시 30분');

  const actionCall=calls.find((call)=>call.name==='olli_team_chat_send_action');
  assert.ok(actionCall);
  assert.equal(actionCall.params.p_action_type,'cancel_waitlist');
  assert.equal(actionCall.params.p_action_payload.waitlistId,'44444444-4444-4444-8444-444444444444');
  assert.equal(actionCall.params.p_action_payload.targetTimeSlot,10);
  assert.equal(actionCall.params.p_action_payload.effectiveDate,'2026-10-01');
  assert.equal(actionCall.params.p_action_payload.isGuest,false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /33333333|44444444|실제학생|studentId|studentName|waitlistId|targetTimeSlot/
  );
  assert.ok(!calls.some((call)=>/resolve_waitlist|action_execute/.test(call.name)));
});

test('waitlist cancel never guesses when multiple active rows match', async () => {
  const {rpc}=baseRpc({
    rows:[
      row({id:'44444444-4444-4444-8444-444444444441',target_weekday:5,target_time_slot:10}),
      row({id:'44444444-4444-4444-8444-444444444442',target_weekday:6,target_time_slot:10}),
    ],
  });

  await assert.rejects(
    prepareWaitlistCancelAction({
      requestContext:requestContext(),
      subjectAccess:subjectAccess(),
      studentLabel:'학생A',
      division:'elementary',
      classGroup:'AUTO',
      waitlistDate:'',
      classHour:0,
      classMinute:0,
      currentDate:'2026-10-01',
      requestId:'req-wait-ambiguous',
      sanitizePayload(p){return p;},
      callRpc:rpc,
    }),
    (error)=>error?.code==='OLLI_AGENT_WAITLIST_CANCEL_AMBIGUOUS'
  );
});

test('waitlist cancel maps a visible half-hour time without exposing the stored slot', async () => {
  const {rpc,calls}=baseRpc();
  const result=await prepareWaitlistCancelAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    classGroup:'AUTO',
    waitlistDate:'',
    classHour:4,
    classMinute:30,
    currentDate:'2026-10-01',
    requestId:'req-wait-half',
    sanitizePayload(p){return p;},
    callRpc:rpc,
  });
  assert.equal(result.time_label,'4시 30분');
  assert.equal(calls.find(c=>c.name==='olli_team_chat_send_action').params.p_action_payload.targetTimeSlot,10);
  assert.doesNotMatch(JSON.stringify(result), /timeSlot|targetTimeSlot|\b10\b/);
});

test('waitlist cancel uses an explicit date only to select the matching weekday', async () => {
  const {rpc,calls}=baseRpc({
    rows:[
      row({id:'44444444-4444-4444-8444-444444444441',target_weekday:5}),
      row({id:'44444444-4444-4444-8444-444444444442',target_weekday:6}),
    ],
  });
  await prepareWaitlistCancelAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    classGroup:'AUTO',
    waitlistDate:'2026-10-03',
    classHour:0,
    classMinute:0,
    currentDate:'2026-10-01',
    requestId:'req-wait-date',
    sanitizePayload(p){return p;},
    callRpc:rpc,
  });
  const action=calls.find(c=>c.name==='olli_team_chat_send_action').params.p_action_payload;
  assert.equal(action.waitlistId,'44444444-4444-4444-8444-444444444442');
  assert.equal(action.targetWeekday,6);
});

test('waitlist cancel can use an explicit A/B group to disambiguate the row', async () => {
  const {rpc,calls}=baseRpc({
    rows:[
      row({id:'44444444-4444-4444-8444-444444444441',target_class_group:'A'}),
      row({id:'44444444-4444-4444-8444-444444444442',target_class_group:'B'}),
    ],
  });
  await prepareWaitlistCancelAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    classGroup:'B',
    waitlistDate:'2026-10-02',
    classHour:4,
    classMinute:30,
    currentDate:'2026-10-01',
    requestId:'req-wait-b',
    sanitizePayload(p){return p;},
    callRpc:rpc,
  });
  const action=calls.find(c=>c.name==='olli_team_chat_send_action').params.p_action_payload;
  assert.equal(action.waitlistId,'44444444-4444-4444-8444-444444444442');
  assert.equal(action.targetClassGroup,'B');
});

test('waitlist cancel retry key is stable and weekday conversion is deterministic', () => {
  const input={
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
    requestId:'team-chat-message:1234',
  };
  assert.equal(
    stableWaitlistCancelActionClientMessageId(input),
    stableWaitlistCancelActionClientMessageId(input)
  );
  assert.notEqual(
    stableWaitlistCancelActionClientMessageId(input),
    stableWaitlistCancelActionClientMessageId({...input,requestId:'team-chat-message:1235'})
  );
  assert.equal(weekdayFromDateKey('2026-10-02'),5);
  assert.equal(weekdayFromDateKey('2026-10-03'),6);
  assert.equal(requestedTimeLabel(4,30),'4시 30분');
});

test('waitlist cancel scope safely falls back for guest names and rejects add/update intents', () => {
  assert.throws(
    () => resolveWaitlistCancelPrepareScope({
      needsDisambiguation:false,
      subjectRefs:[],
      safeText:'비재원A 금요일 4시 대기 취소해줘',
    }),
    (error)=>error?.code==='OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED'
  );

  const prepared={
    needsDisambiguation:false,
    subjectRefs:[{label:'학생A'}],
    safeText:'학생A 금요일 4시 대기 취소해줘',
    subjectAccess:subjectAccess(),
  };
  assert.equal(resolveWaitlistCancelPrepareScope(prepared).subjectLabel,'학생A');

  assert.throws(
    () => resolveWaitlistCancelPrepareScope({...prepared,safeText:'학생A 금요일 4시 대기 등록해줘'}),
    (error)=>error?.code==='OLLI_AGENT_WAITLIST_CANCEL_INTENT_REQUIRED'
  );
  assert.throws(
    () => resolveWaitlistCancelPrepareScope({...prepared,safeText:'학생A 금요일 4시 대기를 토요일 5시로 변경해줘'}),
    (error)=>error?.code==='OLLI_AGENT_WAITLIST_CANCEL_INTENT_REQUIRED'
  );
});

test('waitlist cancel tool schema exposes no internal ids, real names, division or stored slots', () => {
  const toolText=fs.readFileSync(
    path.join(__dirname,'../api/_lib/olli-agent/tools/waitlist-cancel-prepare-tools.cjs'),
    'utf8'
  );
  const start=toolText.indexOf('parameters:z.object({');
  const end=toolText.indexOf('}),\n    async execute',start);
  const schema=toolText.slice(start,end);
  assert.match(schema,/waitlist_date/);
  assert.match(schema,/class_hour/);
  assert.match(schema,/class_minute/);
  assert.doesNotMatch(
    schema,
    /studentId|student_id|studentName|waitlistId|waitlist_id|timeSlot|time_slot|academyId|memberId|division/
  );
});

test('endpoint keeps probe mode and adds source-bound production waitlist cancel mode', () => {
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  assert.match(endpoint,/'waitlist_cancel_prepare_probe'/);
  assert.match(endpoint,/runWaitlistCancelPrepareProbe/);
  assert.match(
    endpoint,
    /waitlist_cancel_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다/
  );
  assert.match(endpoint,/mode === 'waitlist_cancel_prepare'/);
  assert.match(endpoint,/runWaitlistCancelPrepare\(/);
  assert.match(endpoint,/OLLI_AGENT_WAITLIST_SOURCE_MESSAGE_REQUIRED/);
});
