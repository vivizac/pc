const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  extractTrialGuestName,
  prepareTrialGuestPrivacyInput,
  sanitizeTrialToolPayload,
}=require('../api/_lib/olli-agent/trial-guest-privacy.cjs');
const {
  stableTrialAddActionClientMessageId,
  prepareTrialAddAction,
}=require('../api/_lib/olli-agent/tools/trial-add-prepare-tools.cjs');
const {
  resolveTrialAddPrepareScope,
}=require('../api/_lib/olli-agent/runtime.cjs');

function requestContext(){
  return {
    sessionToken:'server-session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}
function trialAccess(name='박하늘',division='elementary'){
  return {resolve(label){return label==='학생A'?{guestName:name,division}:null;}};
}
function slot(overrides={}){
  return Object.assign({
    date:'2026-10-03',
    weekday:6,
    time_slot:1,
    class_group:'A',
    grouped:false,
    capacity:8,
    regular_count:6,
    absent_count:0,
    effective_regular_count:6,
    makeup_count:0,
    trial_count:0,
    one_time_count:0,
    occupancy:6,
    remaining:2,
    waitlist_count:0,
    waitlist_open:true,
    class_full:false,
    available:true,
    time_label:'1시',
  },overrides);
}
function trialRow(overrides={}){
  return Object.assign({
    id:'44444444-4444-4444-8444-444444444444',
    student_id:null,
    student_name:'박하늘',
    division:'elementary',
    is_guest:true,
    session_date:'2026-10-03',
    time_slot:1,
    class_group:'A',
    session_type:'trial',
    status:'scheduled',
  },overrides);
}
function baseRpc({slots,rows,closedDates}={}){
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_availability_slots'){
      return {
        ok:true,
        timetable_mode:'half_hour',
        capacity:8,
        slots:slots||[slot()],
        closed_dates:closedDates||[],
      };
    }
    if(name==='olli_schedule_week'){
      return {ok:true,timetable_mode:'half_hour',one_time_sessions:rows||[]};
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'체험수업으로 등록할까요?',
          action:{id:'action-1',action_type:'add_trial',status:'pending'}
        }
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('trial add privacy extracts guest while model sees only anonymous label',()=>{
  const raw='@올리 초등부 박하늘 10월 3일 1시 A반 체험수업 등록해줘';
  assert.equal(extractTrialGuestName(raw),'박하늘');
  const prepared=prepareTrialGuestPrivacyInput(raw,requestContext());
  assert.doesNotMatch(prepared.safeText,/박하늘/);
  assert.match(prepared.safeText,/학생A/);
  assert.equal(prepared.subjectRefs[0].label,'학생A');
  assert.equal(prepared.subjectRefs[0].division,'elementary');
  assert.equal(prepared.trialAccess.resolve('학생A').guestName,'박하늘');
  const sanitized=sanitizeTrialToolPayload({guest:'박하늘',status:'pending'},prepared);
  assert.equal(sanitized.guest,'학생A');
});

test('trial add stores only pending action after current availability check',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareTrialAddAction({
    requestContext:requestContext(),
    trialAccess:trialAccess(),
    guestLabel:'학생A',
    division:'elementary',
    sessionDate:'2026-10-03',
    classHour:1,
    classMinute:0,
    classGroup:'A',
    currentDate:'2026-10-01',
    requestId:'req-trial-add-1',
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'add_trial');
  assert.equal(result.session_date,'2026-10-03');
  assert.equal(result.time_label,'1시');
  assert.equal(result.class_group,'A');

  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'add_trial');
  assert.equal(action.params.p_action_payload.guestName,'박하늘');
  assert.equal(action.params.p_action_payload.division,'elementary');
  assert.equal(action.params.p_action_payload.sessionDate,'2026-10-03');
  assert.equal(action.params.p_action_payload.timeSlot,1);
  assert.equal(action.params.p_action_payload.classGroup,'A');
  assert.ok(!calls.some(c=>/add_guest_entry|action_execute/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/박하늘|guestName|studentName|timeSlot|academyId|memberId/);
});

test('trial add never guesses A or B when visible time is split',async()=>{
  const {rpc}=baseRpc({
    slots:[
      slot({class_group:'A',grouped:true}),
      slot({class_group:'B',grouped:true}),
    ],
  });
  await assert.rejects(
    prepareTrialAddAction({
      requestContext:requestContext(),
      trialAccess:trialAccess(),
      guestLabel:'학생A',
      division:'elementary',
      sessionDate:'2026-10-03',
      classHour:1,
      classMinute:0,
      classGroup:'AUTO',
      currentDate:'2026-10-01',
      requestId:'req-trial-add-split',
      sanitizePayload:p=>p,
      callRpc:rpc,
    }),
    error=>error?.code==='OLLI_AGENT_TRIAL_ADD_GROUP_REQUIRED'
  );
});

test('trial add duplicate same-name guest is blocked before confirmation',async()=>{
  const {rpc,calls}=baseRpc({rows:[trialRow()]});
  await assert.rejects(
    prepareTrialAddAction({
      requestContext:requestContext(),
      trialAccess:trialAccess(),
      guestLabel:'학생A',
      division:'elementary',
      sessionDate:'2026-10-03',
      classHour:1,
      classMinute:0,
      classGroup:'A',
      currentDate:'2026-10-01',
      requestId:'req-trial-add-dup',
      sanitizePayload:p=>p,
      callRpc:rpc,
    }),
    error=>error?.code==='OLLI_AGENT_TRIAL_ADD_ALREADY_EXISTS'
  );
  assert.ok(!calls.some(c=>c.name==='olli_team_chat_send_action'));
});

test('trial add rejects a full slot before creating confirmation',async()=>{
  const {rpc,calls}=baseRpc({
    slots:[slot({available:false,remaining:0,class_full:true})],
  });
  await assert.rejects(
    prepareTrialAddAction({
      requestContext:requestContext(),
      trialAccess:trialAccess(),
      guestLabel:'학생A',
      division:'elementary',
      sessionDate:'2026-10-03',
      classHour:1,
      classMinute:0,
      classGroup:'A',
      currentDate:'2026-10-01',
      requestId:'req-trial-add-full',
      sanitizePayload:p=>p,
      callRpc:rpc,
    }),
    error=>error?.code==='OLLI_AGENT_TRIAL_ADD_FULL'
  );
  assert.ok(!calls.some(c=>c.name==='olli_team_chat_send_action'));
});

test('trial add scope requires explicit division date and time',()=>{
  const prepared={
    subjectRefs:[{label:'학생A',division:'elementary'}],
    trialAccess:trialAccess(),
    safeText:'초등부 학생A 10월 3일 1시 체험수업 등록해줘',
    needsDisambiguation:false,
  };
  const scope=resolveTrialAddPrepareScope(prepared);
  assert.equal(scope.guestLabel,'학생A');
  assert.equal(scope.division,'elementary');

  assert.throws(
    ()=>resolveTrialAddPrepareScope({
      ...prepared,
      subjectRefs:[{label:'학생A',division:''}],
      trialAccess:trialAccess('박하늘',''),
      safeText:'학생A 10월 3일 1시 체험수업 등록해줘',
    }),
    error=>error?.code==='OLLI_AGENT_TRIAL_ADD_DIVISION_REQUIRED'
  );
  assert.throws(
    ()=>resolveTrialAddPrepareScope({...prepared,safeText:'초등부 학생A 체험수업 등록해줘'}),
    error=>error?.code==='OLLI_AGENT_TRIAL_ADD_DATE_TIME_REQUIRED'
  );
});

test('trial add retry key is deterministic',()=>{
  const input={academyId:'a',memberId:'m',requestId:'team-chat-message:101'};
  assert.equal(stableTrialAddActionClientMessageId(input),stableTrialAddActionClientMessageId(input));
  assert.notEqual(
    stableTrialAddActionClientMessageId(input),
    stableTrialAddActionClientMessageId({...input,requestId:'team-chat-message:102'})
  );
});

test('trial add tool schema exposes no real guest name or internal ids',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/trial-add-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/session_date/);
  assert.match(schema,/class_hour/);
  assert.match(schema,/class_minute/);
  assert.doesNotMatch(schema,/guestName|studentName|timeSlot|academyId|memberId|division|sourceMessageId/);
});

test('endpoint exposes trial add probe and source-bound production modes',()=>{
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  assert.match(endpoint,/'trial_add_prepare_probe'/);
  assert.match(endpoint,/'trial_add_prepare'/);
  assert.match(endpoint,/prepareTrialGuestPrivacyInput\(message, requestContext\)/);
  assert.match(endpoint,/runTrialAddPrepareProbe/);
  assert.match(endpoint,/runTrialAddPrepare\(/);
  assert.match(endpoint,/trial_add_prepare에는 저장된 원문 Team Chat message id가 필요합니다/);
});
