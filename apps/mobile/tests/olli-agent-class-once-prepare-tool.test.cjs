const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  prepareClassOnceAction,
  stableClassOnceActionClientMessageId,
}=require('../api/_lib/olli-agent/tools/class-once-prepare-tools.cjs');
const {resolveClassOncePrepareScope}=require('../api/_lib/olli-agent/runtime.cjs');

function requestContext(){
  return {
    sessionToken:'server-session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}
function subjectAccess(division='elementary'){
  return {resolve(label){return label==='학생A'?{studentId:'33333333-3333-4333-8333-333333333333',division}:null;}};
}
function slot(overrides={}){
  return Object.assign({
    date:'2026-10-03',
    weekday:6,
    time_slot:1,
    time_label:'1시',
    class_group:'A',
    grouped:false,
    capacity:8,
    regular_count:4,
    absent_count:0,
    effective_regular_count:4,
    makeup_count:0,
    trial_count:0,
    one_time_count:0,
    occupancy:4,
    remaining:4,
    waitlist_count:0,
    waitlist_open:true,
    class_full:false,
    available:true,
  },overrides);
}
function baseRpc({slots,oneTime,division='elementary'}={}){
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_student_data_access'){
      return {ok:true,rows:[{
        id:'33333333-3333-4333-8333-333333333333',
        name:'실제학생',
        division,
        status:'active',
        is_deleted:false,
      }]};
    }
    if(name==='olli_schedule_availability_slots'){
      return {ok:true,timetable_mode:'half_hour',capacity:8,slots:slots||[slot()],closed_dates:[]};
    }
    if(name==='olli_schedule_week'){
      return {ok:true,timetable_mode:'half_hour',one_time_sessions:oneTime||[]};
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'이 수업에 1회 등록할까요?',
          action:{id:'action-1',action_type:'add_class_once',status:'pending'}
        }
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('one-time class stores only a pending action and resolves visible time to internal slot',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareClassOnceAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    requestedDivision:'',
    sessionDate:'2026-10-03',
    classHour:1,
    classMinute:0,
    classGroup:'AUTO',
    currentDate:'2026-10-01',
    requestId:'class-once-1',
    replyToMessageId:77,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'add_class_once');
  assert.equal(result.session_date,'2026-10-03');
  assert.equal(result.time_label,'1시');
  assert.equal(result.class_group,'A');

  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'add_class_once');
  assert.equal(action.params.p_reply_to_message_id,77);
  assert.equal(action.params.p_action_payload.studentId,'33333333-3333-4333-8333-333333333333');
  assert.equal(action.params.p_action_payload.studentName,'실제학생');
  assert.equal(action.params.p_action_payload.sessionDate,'2026-10-03');
  assert.equal(action.params.p_action_payload.timeSlot,1);
  assert.equal(action.params.p_action_payload.classGroup,'A');
  assert.ok(!calls.some(c=>/action_execute|add_one_time/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/33333333|실제학생|studentId|timeSlot/);
});

test('one-time class rejects explicit division mismatch before card creation',async()=>{
  const {rpc,calls}=baseRpc();
  await assert.rejects(
    prepareClassOnceAction({
      requestContext:requestContext(),
      subjectAccess:subjectAccess(),
      studentLabel:'학생A',
      division:'elementary',
      requestedDivision:'kinder',
      sessionDate:'2026-10-03',
      classHour:1,
      classMinute:0,
      currentDate:'2026-10-01',
      requestId:'class-once-division',
      sanitizePayload:p=>p,
      callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_CLASS_ONCE_REQUESTED_DIVISION_MISMATCH'
  );
  assert.ok(!calls.some(c=>c.name==='olli_team_chat_send_action'));
});

test('one-time class never guesses A/B when both groups operate',async()=>{
  const {rpc}=baseRpc({
    slots:[
      slot({class_group:'A',grouped:true}),
      slot({class_group:'B',grouped:true}),
    ]
  });
  await assert.rejects(
    prepareClassOnceAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sessionDate:'2026-10-03',classHour:1,classMinute:0,classGroup:'AUTO',
      currentDate:'2026-10-01',requestId:'class-once-ab',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_CLASS_ONCE_GROUP_REQUIRED'
  );
});

test('one-time class blocks full target and duplicate existing one-time session',async()=>{
  const full=baseRpc({slots:[slot({remaining:0,available:false,class_full:true,occupancy:8})]});
  await assert.rejects(
    prepareClassOnceAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sessionDate:'2026-10-03',classHour:1,classMinute:0,classGroup:'A',
      currentDate:'2026-10-01',requestId:'class-once-full',sanitizePayload:p=>p,callRpc:full.rpc,
    }),
    e=>e?.code==='OLLI_AGENT_CLASS_ONCE_FULL'
  );

  const dup=baseRpc({
    oneTime:[{
      student_id:'33333333-3333-4333-8333-333333333333',
      session_date:'2026-10-03',
      time_slot:1,
      status:'scheduled'
    }]
  });
  await assert.rejects(
    prepareClassOnceAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sessionDate:'2026-10-03',classHour:1,classMinute:0,classGroup:'A',
      currentDate:'2026-10-01',requestId:'class-once-dup',sanitizePayload:p=>p,callRpc:dup.rpc,
    }),
    e=>e?.code==='OLLI_AGENT_CLASS_ONCE_ALREADY_EXISTS'
  );
});

test('class-once scope accepts only generic one-time class add and preserves requested division/group',()=>{
  const prepared={
    needsDisambiguation:false,
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
    safeText:'학생A 초등부 토요일 1시 A반 수업 추가해줘',
  };
  const scope=resolveClassOncePrepareScope(prepared);
  assert.equal(scope.subjectLabel,'학생A');
  assert.equal(scope.division,'elementary');
  assert.equal(scope.requestedDivision,'elementary');
  assert.equal(scope.classGroup,'A');

  for(const text of [
    '학생A 토요일 1시 보강 추가해줘',
    '학생A 토요일 1시 체험수업 등록해줘',
    '학생A 토요일 1시 대기 등록해줘',
    '학생A 금요일 4시에서 토요일 1시로 수업 이동해줘',
    '학생A 토요일 1시 결석 처리해줘'
  ]){
    assert.throws(
      ()=>resolveClassOncePrepareScope({...prepared,safeText:text}),
      e=>e?.code==='OLLI_AGENT_CLASS_ONCE_INTENT_REQUIRED'
    );
  }
});

test('one-time class retry key is deterministic',()=>{
  const input={academyId:'a',memberId:'m',requestId:'team-chat-message:77'};
  assert.equal(stableClassOnceActionClientMessageId(input),stableClassOnceActionClientMessageId(input));
  assert.notEqual(
    stableClassOnceActionClientMessageId(input),
    stableClassOnceActionClientMessageId({...input,requestId:'team-chat-message:78'})
  );
});

test('one-time class model tool schema exposes no real name or internal identifiers',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/class-once-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/session_date/);
  assert.match(schema,/class_hour/);
  assert.match(schema,/class_minute/);
  assert.doesNotMatch(schema,/studentId|studentName|timeSlot|academyId|memberId|division|classGroup|requestedDivision/);
});
