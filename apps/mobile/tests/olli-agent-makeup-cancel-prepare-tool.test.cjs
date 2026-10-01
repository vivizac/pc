const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  requestedTimeLabel,
  validateReasonFromSource,
  stableMakeupCancelActionClientMessageId,
  prepareMakeupCancelAction,
} = require('../api/_lib/olli-agent/tools/makeup-cancel-prepare-tools.cjs');
const {
  resolveMakeupCancelPrepareScope,
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
        one_time_sessions:rows || [{
          id:'44444444-4444-4444-8444-444444444444',
          student_id:'33333333-3333-4333-8333-333333333333',
          session_type:'makeup',
          session_date:'2026-10-02',
          time_slot:10,
          class_group:'A',
          status:'scheduled',
        }],
      };
    }
    if (name === 'olli_team_chat_send_action') {
      return sentAction || {
        ok:true,
        message:{
          id:902,
          body:'보강을 취소할까요?',
          action:{ id:'action-2', action_type:'cancel_makeup', status:'pending' },
        },
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('makeup cancel resolves the current half-hour row server-side and stores only a pending cancel_makeup action', async () => {
  const {rpc,calls}=baseRpc();
  const result=await prepareMakeupCancelAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    classGroup:'AUTO',
    sessionDate:'2026-10-02',
    classHour:4,
    classMinute:30,
    reason:'가족 일정 때문에',
    sourceText:'학생A 10월 2일 4시 30분 보강 가족 일정 때문에 취소해줘',
    currentDate:'2026-10-01',
    requestId:'req-cancel-1',
    sanitizePayload(payload){ return payload; },
    callRpc:rpc,
  });

  assert.equal(result.action_type,'cancel_makeup');
  assert.equal(result.time_label,'4시 30분');
  const actionCall=calls.find((call)=>call.name==='olli_team_chat_send_action');
  assert.ok(actionCall);
  assert.equal(actionCall.params.p_action_type,'cancel_makeup');
  assert.equal(actionCall.params.p_action_payload.oneTimeSessionId,'44444444-4444-4444-8444-444444444444');
  assert.equal(actionCall.params.p_action_payload.timeSlot,10);
  assert.equal(actionCall.params.p_action_payload.reason,'가족 일정 때문에');
  assert.doesNotMatch(JSON.stringify(result), /33333333|44444444|실제학생|studentId|studentName|oneTimeSessionId|timeSlot/);
  assert.ok(!calls.some((call)=>/olli_schedule_execute|cancel_one_time/.test(call.name)));
});

test('makeup cancel never guesses when more than one current row matches', async () => {
  const {rpc}=baseRpc({
    rows:[
      {
        id:'44444444-4444-4444-8444-444444444441',
        student_id:'33333333-3333-4333-8333-333333333333',
        session_type:'makeup',session_date:'2026-10-02',time_slot:10,class_group:'A',status:'scheduled',
      },
      {
        id:'44444444-4444-4444-8444-444444444442',
        student_id:'33333333-3333-4333-8333-333333333333',
        session_type:'makeup',session_date:'2026-10-03',time_slot:10,class_group:'A',status:'scheduled',
      },
    ],
  });

  await assert.rejects(
    prepareMakeupCancelAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',
      division:'elementary',classGroup:'AUTO',sessionDate:'',classHour:4,classMinute:30,
      reason:'가족 일정 때문에',sourceText:'학생A 4시 30분 보강 가족 일정 때문에 취소해줘',
      currentDate:'2026-10-01',requestId:'req-ambiguous',sanitizePayload(p){return p;},callRpc:rpc,
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_CANCEL_AMBIGUOUS'
  );
});

test('makeup cancel fixes an explicitly requested A/B group before choosing the row', async () => {
  const {rpc,calls}=baseRpc({
    rows:[
      {
        id:'44444444-4444-4444-8444-444444444441',
        student_id:'33333333-3333-4333-8333-333333333333',
        session_type:'makeup',session_date:'2026-10-02',time_slot:10,class_group:'A',status:'scheduled',
      },
      {
        id:'44444444-4444-4444-8444-444444444442',
        student_id:'33333333-3333-4333-8333-333333333333',
        session_type:'makeup',session_date:'2026-10-02',time_slot:10,class_group:'B',status:'scheduled',
      },
    ],
  });

  await prepareMakeupCancelAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',
    division:'elementary',classGroup:'B',sessionDate:'2026-10-02',classHour:4,classMinute:30,
    reason:'가족 일정 때문에',sourceText:'학생A 10월 2일 4시 30분 B반 보강 가족 일정 때문에 취소해줘',
    currentDate:'2026-10-01',requestId:'req-b',sanitizePayload(p){return p;},callRpc:rpc,
  });

  const actionCall=calls.find((call)=>call.name==='olli_team_chat_send_action');
  assert.equal(actionCall.params.p_action_payload.oneTimeSessionId,'44444444-4444-4444-8444-444444444442');
  assert.equal(actionCall.params.p_action_payload.classGroup,'B');
});

test('makeup cancel reason must be non-generic and copied from the privacy-safe source text', () => {
  assert.equal(
    validateReasonFromSource('가족 일정 때문에','학생A 보강 가족 일정 때문에 취소해줘'),
    '가족 일정 때문에'
  );
  assert.throws(
    ()=>validateReasonFromSource('취소','학생A 보강 취소해줘'),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_CANCEL_REASON_REQUIRED'
  );
  assert.throws(
    ()=>validateReasonFromSource('병원 방문','학생A 보강 가족 일정 때문에 취소해줘'),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_CANCEL_REASON_NOT_FROM_SOURCE'
  );
});

test('makeup cancel retry key is stable and visible time labeling preserves 30 minutes', () => {
  assert.equal(requestedTimeLabel(4,30),'4시 30분');
  assert.equal(requestedTimeLabel(0,0),'');
  const args={academyId:'academy-a',memberId:'member-a',requestId:'team-chat-message:77'};
  assert.equal(
    stableMakeupCancelActionClientMessageId(args),
    stableMakeupCancelActionClientMessageId(args)
  );
  assert.notEqual(
    stableMakeupCancelActionClientMessageId(args),
    stableMakeupCancelActionClientMessageId({...args,requestId:'team-chat-message:78'})
  );
});

test('makeup cancel scope fixes student division and A/B group but rejects add or change intent', () => {
  const scope=resolveMakeupCancelPrepareScope({
    safeText:'학생A 10월 2일 4시 30분 B반 보강 가족 일정 때문에 취소해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess('elementary'),
  });
  assert.deepEqual(scope,{subjectLabel:'학생A',division:'elementary',classGroup:'B'});

  assert.throws(
    ()=>resolveMakeupCancelPrepareScope({
      safeText:'학생A 10월 2일 4시 보강 등록해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_CANCEL_INTENT_REQUIRED'
  );
  assert.throws(
    ()=>resolveMakeupCancelPrepareScope({
      safeText:'학생A 10월 2일 4시 보강 변경해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_CANCEL_INTENT_REQUIRED'
  );
});

test('makeup cancel tool schema exposes no internal ids, division, group or stored time slot to the model', () => {
  const source=fs.readFileSync(
    path.join(__dirname,'../api/_lib/olli-agent/tools/makeup-cancel-prepare-tools.cjs'),
    'utf8'
  );
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/session_date/);
  assert.match(schema,/class_hour/);
  assert.match(schema,/class_minute/);
  assert.match(schema,/reason/);
  assert.doesNotMatch(schema,/studentId|student_id|division|classGroup|class_group|timeSlot|time_slot|oneTimeSessionId|requestId|action_type/);
});

test('endpoint adds only the makeup cancel probe mode at this checkpoint', () => {
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  assert.match(endpoint,/'makeup_cancel_prepare_probe'/);
  assert.match(endpoint,/runMakeupCancelPrepareProbe/);
  assert.match(endpoint,/makeup_cancel_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다/);
  assert.doesNotMatch(endpoint,/mode === 'makeup_cancel_prepare'/);
});
