const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  stableWaitlistAddActionClientMessageId,
  prepareWaitlistAddAction,
}=require('../api/_lib/olli-agent/tools/waitlist-add-prepare-tools.cjs');
const {
  resolveWaitlistAddPrepareScope,
}=require('../api/_lib/olli-agent/runtime.cjs');

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
function guestAccess(division='elementary',guestName='비재원민지'){
  return {resolve(label){return label==='학생A'?{guestName,division,isGuest:true}:null;}};
}
function slot(overrides={}){
  return Object.assign({
    date:'2026-10-03',
    weekday:6,
    time_slot:1,
    class_group:'A',
    grouped:false,
    capacity:8,
    regular_count:8,
    absent_count:0,
    effective_regular_count:8,
    makeup_count:0,
    trial_count:0,
    one_time_count:0,
    occupancy:8,
    remaining:0,
    waitlist_count:0,
    waitlist_open:true,
    class_full:true,
    available:true,
  },overrides);
}
function baseRpc({slots,waitlist,enrollments}={}){
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_student_data_access'){
      return {ok:true,rows:[{
        id:'33333333-3333-4333-8333-333333333333',
        name:'실제학생',
        division:'elementary',
        status:'active',
        is_deleted:false,
      }]};
    }
    if(name==='olli_schedule_availability_slots'){
      return {ok:true,timetable_mode:'half_hour',capacity:8,slots:slots||[slot()],closed_dates:[]};
    }
    if(name==='olli_schedule_week'){
      return {ok:true,timetable_mode:'half_hour',waitlist:waitlist||[],enrollments:enrollments||[]};
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'대기로 등록할까요?',
          action:{id:'action-1',action_type:'add_waitlist',status:'pending'}
        }
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('registered waitlist add stores only a pending action for a full class',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareWaitlistAddAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sessionDate:'2026-10-03',
    classHour:1,
    classMinute:0,
    classGroup:'AUTO',
    currentDate:'2026-10-01',
    requestId:'wait-add-1',
    replyToMessageId:77,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'add_waitlist');
  assert.equal(result.session_date,'2026-10-03');
  assert.equal(result.target_weekday,6);
  assert.equal(result.target_time_label,'1시');
  assert.equal(result.target_class_group,'A');

  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'add_waitlist');
  assert.equal(action.params.p_reply_to_message_id,77);
  assert.equal(action.params.p_action_payload.studentId,'33333333-3333-4333-8333-333333333333');
  assert.equal(action.params.p_action_payload.studentName,'실제학생');
  assert.equal(action.params.p_action_payload.isGuest,false);
  assert.equal(action.params.p_action_payload.targetWeekday,6);
  assert.equal(action.params.p_action_payload.targetTimeSlot,1);
  assert.equal(action.params.p_action_payload.targetClassGroup,'A');
  assert.ok(!calls.some(c=>/action_execute|add_waitlist$/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/33333333|실제학생|studentId|targetTimeSlot/);
});

test('waitlist add allows a full class but blocks an occupied waitlist position',async()=>{
  const {rpc}=baseRpc({
    slots:[slot({waitlist_count:1,waitlist_open:false,available:false})]
  });
  await assert.rejects(
    prepareWaitlistAddAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sessionDate:'2026-10-03',classHour:1,classMinute:0,classGroup:'A',
      currentDate:'2026-10-01',requestId:'wait-add-full',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_WAITLIST_ADD_SLOT_OCCUPIED'
  );
});

test('waitlist add never guesses A/B when both groups operate',async()=>{
  const {rpc}=baseRpc({
    slots:[
      slot({class_group:'A',grouped:true}),
      slot({class_group:'B',grouped:true}),
    ]
  });
  await assert.rejects(
    prepareWaitlistAddAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sessionDate:'2026-10-03',classHour:1,classMinute:0,classGroup:'AUTO',
      currentDate:'2026-10-01',requestId:'wait-add-ab',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_WAITLIST_ADD_GROUP_REQUIRED'
  );
});

test('waitlist add blocks an existing regular enrollment for the same time',async()=>{
  const {rpc}=baseRpc({
    enrollments:[{
      student_id:'33333333-3333-4333-8333-333333333333',
      weekday:6,
      time_slot:1,
      class_group:'A',
      status:'active',
    }]
  });
  await assert.rejects(
    prepareWaitlistAddAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sessionDate:'2026-10-03',classHour:1,classMinute:0,classGroup:'A',
      currentDate:'2026-10-01',requestId:'wait-add-enrolled',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_WAITLIST_ADD_ALREADY_ENROLLED'
  );
});

test('waitlist add scope supports registered and non-enrolled guest subjects',()=>{
  const prepared={
    needsDisambiguation:false,
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
    safeText:'학생A 토요일 1시 A반 대기 등록해줘',
  };
  const scope=resolveWaitlistAddPrepareScope(prepared);
  assert.equal(scope.subjectLabel,'학생A');
  assert.equal(scope.division,'elementary');
  assert.equal(scope.isGuest,false);
  assert.equal(scope.classGroup,'A');

  const guestPrepared={
    needsDisambiguation:false,
    subjectRefs:[{label:'학생A'}],
    waitlistGuestAccess:guestAccess('elementary'),
    safeText:'학생A 토요일 1시 초등부 대기 등록해줘',
  };
  const guestScope=resolveWaitlistAddPrepareScope(guestPrepared);
  assert.equal(guestScope.isGuest,true);
  assert.equal(guestScope.division,'elementary');

  assert.throws(
    ()=>resolveWaitlistAddPrepareScope({...prepared,safeText:'학생A 대기 취소해줘'}),
    e=>e?.code==='OLLI_AGENT_WAITLIST_ADD_INTENT_REQUIRED'
  );
});

test('non-enrolled guest waitlist add creates the same pending action without student lookup',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareWaitlistAddAction({
    requestContext:requestContext(),
    subjectAccess:{resolve(){return null;}},
    guestAccess:guestAccess('elementary','비재원민지'),
    studentLabel:'학생A',
    division:'elementary',
    sessionDate:'2026-10-03',
    classHour:1,
    classMinute:0,
    classGroup:'A',
    currentDate:'2026-10-01',
    requestId:'guest-wait-add',
    sanitizePayload:p=>p,
    callRpc:rpc,
  });
  assert.equal(result.action_type,'add_waitlist');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.studentId,'');
  assert.equal(action.params.p_action_payload.guestName,'비재원민지');
  assert.equal(action.params.p_action_payload.isGuest,true);
  assert.equal(action.params.p_action_payload.division,'elementary');
  assert.ok(!calls.some(c=>c.name==='olli_student_data_access'));
  assert.doesNotMatch(JSON.stringify(result),/비재원민지/);
});

test('waitlist add retry key is deterministic',()=>{
  const input={academyId:'a',memberId:'m',requestId:'team-chat-message:77'};
  assert.equal(stableWaitlistAddActionClientMessageId(input),stableWaitlistAddActionClientMessageId(input));
  assert.notEqual(
    stableWaitlistAddActionClientMessageId(input),
    stableWaitlistAddActionClientMessageId({...input,requestId:'team-chat-message:78'})
  );
});

test('waitlist add model tool schema exposes no real name or internal ids',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/waitlist-add-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/target_date/);
  assert.match(schema,/class_hour/);
  assert.match(schema,/class_minute/);
  assert.doesNotMatch(schema,/studentId|studentName|waitlistId|timeSlot|academyId|memberId|division|classGroup/);
});

test('endpoint exposes registered waitlist add probe and production modes',()=>{
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  assert.match(endpoint,/'waitlist_add_prepare_probe'/);
  assert.match(endpoint,/'waitlist_add_prepare'/);
  assert.match(endpoint,/runWaitlistAddPrepareProbe/);
  assert.match(endpoint,/runWaitlistAddPrepare\(/);
  assert.match(endpoint,/waitlist_add_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
});
