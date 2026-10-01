const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  optionalTimeLabel,
  stableMakeupUpdateActionClientMessageId,
  prepareMakeupUpdateAction,
} = require('../api/_lib/olli-agent/tools/makeup-update-prepare-tools.cjs');
const {
  resolveMakeupUpdatePrepareScope,
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

function studentReadResult() {
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

function slot({
  date='2026-10-05',
  timeSlot=10,
  timeLabel='4시 30분',
  group='A',
  grouped=true,
  available=true,
  remaining=2,
}={}) {
  return {
    date,
    weekday:1,
    time_slot:timeSlot,
    time_label:timeLabel,
    class_group:group,
    grouped,
    capacity:5,
    regular_count:2,
    absent_count:0,
    effective_regular_count:2,
    makeup_count:0,
    trial_count:0,
    one_time_count:0,
    occupancy:2,
    remaining,
    waitlist_count:0,
    waitlist_open:false,
    class_full:!available,
    available,
  };
}

function sourceRow({
  id='44444444-4444-4444-8444-444444444444',
  date='2026-10-02',
  timeSlot=10,
  group='A',
}={}) {
  return {
    id,
    student_id:'33333333-3333-4333-8333-333333333333',
    session_type:'makeup',
    session_date:date,
    time_slot:timeSlot,
    class_group:group,
    status:'scheduled',
  };
}

function rpcFixture({
  sourceRows=[sourceRow()],
  targetRows=[],
  slots=[slot()],
  closedDates=[],
  timetableMode='half_hour',
}={}) {
  const calls=[];
  const rpc=async (name, params) => {
    calls.push({name,params});
    if (name === 'olli_student_data_access') return studentReadResult();
    if (name === 'olli_schedule_week') {
      const week=String(params.p_week_start || '');
      return {
        ok:true,
        timetable_mode:timetableMode,
        one_time_sessions:week === '2026-10-05' ? targetRows : sourceRows,
      };
    }
    if (name === 'olli_schedule_availability_slots') {
      return {
        ok:true,
        timetable_mode:timetableMode,
        capacity:5,
        slots,
        closed_dates:closedDates,
      };
    }
    if (name === 'olli_team_chat_send_action') {
      return {
        ok:true,
        message:{
          id:903,
          body:'보강 변경',
          action:{ id:'action-3', action_type:'update_makeup', status:'pending' },
        },
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

function baseArgs(overrides={}) {
  return {
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sourceDate:'2026-10-02',
    sourceHour:4,
    sourceMinute:30,
    sourceGroup:'A',
    targetDate:'2026-10-05',
    targetHour:4,
    targetMinute:30,
    targetGroup:'B',
    currentDate:'2026-10-01',
    requestId:'req-update-1',
    sanitizePayload(payload){ return payload; },
    ...overrides,
  };
}

test('makeup update resolves source and target server-side and stores only a pending update_makeup action', async () => {
  const {rpc,calls}=rpcFixture({
    slots:[
      slot({group:'A'}),
      slot({group:'B'}),
    ],
  });
  const result=await prepareMakeupUpdateAction(baseArgs({callRpc:rpc}));

  assert.equal(result.action_type,'update_makeup');
  assert.equal(result.source_time_label,'4시 30분');
  assert.equal(result.target_time_label,'4시 30분');
  assert.equal(result.source_class_group,'A');
  assert.equal(result.target_class_group,'B');

  const actionCall=calls.find((call)=>call.name==='olli_team_chat_send_action');
  assert.ok(actionCall);
  assert.equal(actionCall.params.p_action_type,'update_makeup');
  assert.equal(actionCall.params.p_action_payload.oneTimeSessionId,'44444444-4444-4444-8444-444444444444');
  assert.equal(actionCall.params.p_action_payload.sourceTimeSlot,10);
  assert.equal(actionCall.params.p_action_payload.targetTimeSlot,10);
  assert.equal(actionCall.params.p_action_payload.targetClassGroup,'B');
  assert.doesNotMatch(JSON.stringify(result), /33333333|44444444|실제학생|studentId|studentName|oneTimeSessionId|TimeSlot/);
  assert.ok(!calls.some((call)=>call.name==='olli_schedule_update_one_time_session'));
  assert.ok(!calls.some((call)=>call.name==='olli_team_chat_action_execute'));
});

test('makeup update never guesses when multiple source makeup rows match', async () => {
  const {rpc}=rpcFixture({
    sourceRows:[
      sourceRow({id:'44444444-4444-4444-8444-444444444441',timeSlot:10,group:'A'}),
      sourceRow({id:'44444444-4444-4444-8444-444444444442',timeSlot:11,group:'A'}),
    ],
  });

  await assert.rejects(
    prepareMakeupUpdateAction(baseArgs({
      sourceHour:0,sourceMinute:0,sourceGroup:'AUTO',callRpc:rpc,
    })),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_UPDATE_SOURCE_AMBIGUOUS'
  );
});

test('makeup update maps half-hour visible times to stored slots without exposing them', async () => {
  const {rpc,calls}=rpcFixture({
    slots:[
      slot({timeSlot:11,timeLabel:'5시 30분',group:'A'}),
    ],
  });

  const result=await prepareMakeupUpdateAction(baseArgs({
    targetHour:5,targetMinute:30,targetGroup:'A',callRpc:rpc,
  }));
  assert.equal(result.target_time_label,'5시 30분');
  const actionCall=calls.find((call)=>call.name==='olli_team_chat_send_action');
  assert.equal(actionCall.params.p_action_payload.targetTimeSlot,11);
  assert.doesNotMatch(JSON.stringify(result), /targetTimeSlot|time_slot/);
});

test('makeup update preserves the current B group when target group is omitted on another split slot', async () => {
  const {rpc,calls}=rpcFixture({
    sourceRows:[sourceRow({group:'B'})],
    slots:[slot({group:'A'}),slot({group:'B'})],
  });

  const result=await prepareMakeupUpdateAction(baseArgs({
    sourceGroup:'AUTO',
    targetGroup:'AUTO',
    callRpc:rpc,
  }));
  assert.equal(result.source_class_group,'B');
  assert.equal(result.target_class_group,'B');
  const actionCall=calls.find((call)=>call.name==='olli_team_chat_send_action');
  assert.equal(actionCall.params.p_action_payload.targetClassGroup,'B');
});

test('makeup update normalizes a preserved B group to A when target class is not split', async () => {
  const {rpc,calls}=rpcFixture({
    sourceRows:[sourceRow({group:'B'})],
    slots:[slot({group:'A',grouped:false})],
  });

  const result=await prepareMakeupUpdateAction(baseArgs({
    sourceGroup:'AUTO',
    targetGroup:'AUTO',
    callRpc:rpc,
  }));
  assert.equal(result.target_class_group,'A');
  const actionCall=calls.find((call)=>call.name==='olli_team_chat_send_action');
  assert.equal(actionCall.params.p_action_payload.targetClassGroup,'A');
});

test('makeup update rejects a no-op before checking target capacity', async () => {
  const {rpc}=rpcFixture({
    slots:[slot({
      date:'2026-10-02',
      group:'A',
      available:false,
      remaining:0,
    })],
  });

  await assert.rejects(
    prepareMakeupUpdateAction(baseArgs({
      targetDate:'',
      targetHour:0,
      targetMinute:0,
      targetGroup:'AUTO',
      callRpc:rpc,
    })),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_UPDATE_NO_CHANGE'
  );
});

test('makeup update rejects full and duplicate target schedules', async () => {
  const full=rpcFixture({
    slots:[slot({group:'B',available:false,remaining:0})],
  });
  await assert.rejects(
    prepareMakeupUpdateAction(baseArgs({callRpc:full.rpc})),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_UPDATE_TARGET_FULL'
  );

  const dup=rpcFixture({
    targetRows:[sourceRow({
      id:'55555555-5555-4555-8555-555555555555',
      date:'2026-10-05',
      timeSlot:10,
      group:'B',
    })],
    slots:[slot({group:'B'})],
  });
  await assert.rejects(
    prepareMakeupUpdateAction(baseArgs({callRpc:dup.rpc})),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_UPDATE_TARGET_DUPLICATE'
  );
});

test('makeup update rejects closed target dates', async () => {
  const {rpc}=rpcFixture({
    closedDates:[{date:'2026-10-05',reason:'휴원'}],
    slots:[],
  });
  await assert.rejects(
    prepareMakeupUpdateAction(baseArgs({callRpc:rpc})),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_UPDATE_CLOSED_DAY'
  );
});

test('makeup update retry key is stable and optional time uses zero only for omission', () => {
  assert.equal(optionalTimeLabel(4,30),'4시 30분');
  assert.equal(optionalTimeLabel(0,0),'');
  assert.throws(
    ()=>optionalTimeLabel(0,30),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_UPDATE_TIME_INVALID'
  );
  const args={academyId:'academy-a',memberId:'member-a',requestId:'team-chat-message:88'};
  assert.equal(
    stableMakeupUpdateActionClientMessageId(args),
    stableMakeupUpdateActionClientMessageId(args)
  );
  assert.notEqual(
    stableMakeupUpdateActionClientMessageId(args),
    stableMakeupUpdateActionClientMessageId({...args,requestId:'team-chat-message:89'})
  );
});

test('makeup update scope accepts change intent and rejects add or cancel intent', () => {
  const scope=resolveMakeupUpdatePrepareScope({
    safeText:'학생A 10월 2일 4시 30분 A반 보강을 10월 5일 4시 30분 B반으로 변경해줘',
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess('elementary'),
  });
  assert.deepEqual(scope,{subjectLabel:'학생A',division:'elementary'});

  assert.throws(
    ()=>resolveMakeupUpdatePrepareScope({
      safeText:'학생A 10월 5일 4시 보강 등록해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_UPDATE_INTENT_REQUIRED'
  );
  assert.throws(
    ()=>resolveMakeupUpdatePrepareScope({
      safeText:'학생A 10월 5일 4시 보강 취소해줘',
      subjectRefs:[{label:'학생A'}],
      subjectAccess:subjectAccess('elementary'),
    }),
    (error)=>error?.code==='OLLI_AGENT_MAKEUP_UPDATE_INTENT_REQUIRED'
  );
});

test('makeup update tool schema exposes no internal ids, real names, division or stored slots', () => {
  const source=fs.readFileSync(
    path.join(__dirname,'../api/_lib/olli-agent/tools/makeup-update-prepare-tools.cjs'),
    'utf8'
  );
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/source_date/);
  assert.match(schema,/source_hour/);
  assert.match(schema,/source_group/);
  assert.match(schema,/target_date/);
  assert.match(schema,/target_hour/);
  assert.match(schema,/target_group/);
  assert.doesNotMatch(
    schema,
    /studentId|student_id|studentName|oneTimeSessionId|timeSlot|time_slot|division|academyId|memberId|requestId/
  );
});

test('endpoint keeps makeup update probe mode separate from source-bound production mode', () => {
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  assert.match(endpoint,/'makeup_update_prepare_probe'/);
  assert.match(endpoint,/runMakeupUpdatePrepareProbe/);
  assert.match(endpoint,/makeup_update_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다/);
  assert.match(endpoint,/'makeup_update_prepare'/);
  assert.match(endpoint,/mode === 'makeup_update_prepare'/);
  assert.match(endpoint,/runMakeupUpdatePrepare\(/);
  assert.match(endpoint,/makeup_update_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
});
