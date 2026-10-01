const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  requestedTimeLabel,
  stableMakeupActionClientMessageId,
  prepareMakeupAction,
} = require('../api/_lib/olli-agent/tools/makeup-prepare-tools.cjs');
const {
  resolveMakeupPrepareScope,
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

function baseRpc({
  division='elementary',
  slots,
  closedDates=[],
  oneTimeSessions=[],
  sentAction,
} = {}) {
  const calls=[];
  const rpc=async (name, params) => {
    calls.push({name, params});
    if (name === 'olli_student_data_access') {
      return {
        ok:true,
        rows:[{
          id:'33333333-3333-4333-8333-333333333333',
          name:'실제학생',
          division,
          status:'active',
          is_deleted:false,
        }],
      };
    }
    if (name === 'olli_schedule_availability_slots') {
      return {
        ok:true,
        timetable_mode:'half_hour',
        capacity:5,
        slots:slots || [{
          date:'2026-10-02',
          weekday:5,
          time_slot:10,
          class_group:'A',
          grouped:false,
          remaining:1,
          available:true,
        }],
        closed_dates:closedDates,
      };
    }
    if (name === 'olli_schedule_week') {
      return { ok:true, one_time_sessions:oneTimeSessions };
    }
    if (name === 'olli_team_chat_send_action') {
      return sentAction || {
        ok:true,
        message:{
          id:901,
          body:'보강을 등록할까요?',
          action:{ id:'action-1', action_type:'add_makeup', status:'pending' },
        },
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('makeup prepare resolves visible half-hour time through server availability and stores existing add_makeup payload', async () => {
  const {rpc,calls}=baseRpc({
    slots:[{
      date:'2026-10-02',
      weekday:5,
      time_slot:10,
      class_group:'A',
      grouped:false,
      remaining:1,
      available:true,
    }],
  });

  const result=await prepareMakeupAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sessionDate:'2026-10-02',
    classHour:4,
    classMinute:30,
    classGroup:'AUTO',
    currentDate:'2026-10-01',
    requestId:'req-1',
    sanitizePayload(payload){ return payload; },
    callRpc:rpc,
  });

  assert.equal(result.action_type,'add_makeup');
  assert.equal(result.time_label,'4시 30분');
  const actionCall=calls.find((call)=>call.name==='olli_team_chat_send_action');
  assert.ok(actionCall);
  assert.equal(actionCall.params.p_action_type,'add_makeup');
  assert.equal(actionCall.params.p_action_payload.timeSlot,10);
  assert.equal(actionCall.params.p_action_payload.classGroup,'A');
  assert.equal(actionCall.params.p_action_payload.sessionDate,'2026-10-02');
  assert.doesNotMatch(JSON.stringify(result), /33333333|실제학생|studentId|studentName|timeSlot/);
  assert.ok(!calls.some((call)=>/olli_schedule_execute|olli_schedule_add_one_time/.test(call.name)));
});

test('makeup prepare never guesses between split A and B classes', async () => {
  const {rpc}=baseRpc({
    slots:[
      {date:'2026-10-02',weekday:5,time_slot:4,class_group:'A',grouped:true,remaining:1,available:true},
      {date:'2026-10-02',weekday:5,time_slot:4,class_group:'B',grouped:true,remaining:1,available:true},
    ],
  });
  await assert.rejects(
    prepareMakeupAction({
      requestContext:requestContext(),
      subjectAccess:subjectAccess(),
      studentLabel:'학생A',
      division:'elementary',
      sessionDate:'2026-10-02',
      classHour:4,
      classMinute:0,
      classGroup:'AUTO',
      currentDate:'2026-10-01',
      requestId:'req-split',
      sanitizePayload(payload){ return payload; },
      callRpc:rpc,
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_GROUP_REQUIRED'
  );
});

test('makeup prepare honors explicit group but still rejects full, closed and duplicate targets', async () => {
  const split=baseRpc({
    slots:[
      {date:'2026-10-02',weekday:5,time_slot:4,class_group:'A',grouped:true,remaining:0,available:false},
      {date:'2026-10-02',weekday:5,time_slot:4,class_group:'B',grouped:true,remaining:1,available:true},
    ],
  });
  const result=await prepareMakeupAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sessionDate:'2026-10-02',
    classHour:4,
    classMinute:0,
    classGroup:'B',
    currentDate:'2026-10-01',
    requestId:'req-b',
    sanitizePayload(payload){ return payload; },
    callRpc:split.rpc,
  });
  assert.equal(result.class_group,'B');

  const full=baseRpc({
    slots:[{date:'2026-10-02',weekday:5,time_slot:4,class_group:'A',grouped:false,remaining:0,available:false}],
  });
  await assert.rejects(
    prepareMakeupAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',
      division:'elementary',sessionDate:'2026-10-02',classHour:4,classMinute:0,classGroup:'AUTO',
      currentDate:'2026-10-01',requestId:'req-full',sanitizePayload(p){return p;},callRpc:full.rpc,
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_FULL'
  );

  const closed=baseRpc({
    slots:[],
    closedDates:[{date:'2026-10-02',reason:'휴원일'}],
  });
  await assert.rejects(
    prepareMakeupAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',
      division:'elementary',sessionDate:'2026-10-02',classHour:4,classMinute:0,classGroup:'AUTO',
      currentDate:'2026-10-01',requestId:'req-closed',sanitizePayload(p){return p;},callRpc:closed.rpc,
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_CLOSED_DAY'
  );

  const duplicate=baseRpc({
    slots:[{date:'2026-10-02',weekday:5,time_slot:4,class_group:'A',grouped:false,remaining:1,available:true}],
    oneTimeSessions:[{
      student_id:'33333333-3333-4333-8333-333333333333',
      session_date:'2026-10-02',
      time_slot:4,
      class_group:'A',
      status:'scheduled',
    }],
  });
  await assert.rejects(
    prepareMakeupAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',
      division:'elementary',sessionDate:'2026-10-02',classHour:4,classMinute:0,classGroup:'AUTO',
      currentDate:'2026-10-01',requestId:'req-dup',sanitizePayload(p){return p;},callRpc:duplicate.rpc,
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_ALREADY_EXISTS'
  );
});

test('makeup retry key is stable and visible time labeling preserves 30 minutes', () => {
  assert.equal(requestedTimeLabel(4,30),'4시 30분');
  const args={
    academyId:'academy-a',
    memberId:'member-a',
    requestId:'team-chat-message:77',
  };
  assert.equal(stableMakeupActionClientMessageId(args),stableMakeupActionClientMessageId(args));
  assert.notEqual(
    stableMakeupActionClientMessageId(args),
    stableMakeupActionClientMessageId({...args,requestId:'team-chat-message:78'})
  );
});

test('makeup scope fixes student division and A/B group server-side and requires explicit date and time', () => {
  const scope=resolveMakeupPrepareScope({
    safeText:'학생A 다음 주 금요일 4시 30분 B반 보강 등록해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess('elementary'),
  });
  assert.deepEqual(scope,{subjectLabel:'학생A',division:'elementary',classGroup:'B'});

  assert.throws(
    ()=>resolveMakeupPrepareScope({
      safeText:'학생A 보강 등록해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_DATE_TIME_REQUIRED'
  );
  assert.throws(
    ()=>resolveMakeupPrepareScope({
      safeText:'학생A 다음 주 금요일 4시 보강 변경해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_ADD_INTENT_REQUIRED'
  );
});

test('makeup tool schema does not expose internal ids, division, group or stored time slot to the model', () => {
  const source=fs.readFileSync(
    path.join(__dirname,'../api/_lib/olli-agent/tools/makeup-prepare-tools.cjs'),
    'utf8'
  );
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/session_date/);
  assert.match(schema,/class_hour/);
  assert.match(schema,/class_minute/);
  assert.doesNotMatch(schema,/studentId|student_id|division|classGroup|class_group|timeSlot|time_slot|requestId|action_type/);
});

test('endpoint keeps makeup probe request-id flow separate from production source-message flow', () => {
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  assert.match(endpoint,/'makeup_prepare_probe'/);
  assert.match(endpoint,/runMakeupPrepareProbe/);
  assert.match(endpoint,/makeup_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다/);
  assert.match(endpoint,/mode === 'makeup_prepare'/);
  assert.match(endpoint,/runMakeupPrepare\(/);
  assert.match(endpoint,/makeup_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
});
