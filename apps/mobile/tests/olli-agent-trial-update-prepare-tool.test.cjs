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
  stableTrialUpdateActionClientMessageId,
  prepareTrialUpdateAction,
}=require('../api/_lib/olli-agent/tools/trial-update-prepare-tools.cjs');
const {
  resolveTrialUpdatePrepareScope,
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
function row(overrides={}){
  return Object.assign({
    id:'44444444-4444-4444-8444-444444444444',
    student_id:null,
    student_name:'박하늘',
    division:'elementary',
    is_guest:true,
    session_date:'2026-10-02',
    time_slot:10,
    class_group:'A',
    session_type:'trial',
    status:'scheduled',
  },overrides);
}
function slot(overrides={}){
  return Object.assign({
    date:'2026-10-03',
    weekday:6,
    time_slot:1,
    class_group:'A',
    grouped:true,
    capacity:8,
    regular_count:6,
    absent_count:0,
    effective_regular_count:6,
    makeup_count:0,
    trial_count:1,
    one_time_count:1,
    occupancy:7,
    remaining:1,
    waitlist_count:0,
    waitlist_open:true,
    class_full:false,
    available:true,
    time_label:'1시',
  },overrides);
}
function baseRpc({rows,slots,targetRows}={}){
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week'){
      const sourceWeek=String(params?.p_week_start||'')==='2026-09-28';
      return {
        ok:true,
        timetable_mode:'half_hour',
        one_time_sessions:sourceWeek?(rows||[row()]):(targetRows||rows||[row()]),
      };
    }
    if(name==='olli_schedule_availability_slots'){
      return {ok:true,timetable_mode:'half_hour',capacity:8,slots:slots||[slot()],closed_dates:[]};
    }
    if(name==='olli_team_chat_send_action'){
      return {ok:true,message:{id:901,body:'체험수업을 변경할까요?',action:{id:'action-1',action_type:'update_trial',status:'pending'}}};
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('trial guest privacy extracts the guest and sends only anonymous label to the model',()=>{
  const raw='@올리 유치부 박하늘 10월 2일 4시 30분 A반 체험수업을 10월 3일 1시 B반으로 변경해줘';
  assert.equal(extractTrialGuestName(raw),'박하늘');
  const prepared=prepareTrialGuestPrivacyInput(raw,requestContext());
  assert.doesNotMatch(prepared.safeText,/박하늘/);
  assert.match(prepared.safeText,/학생A/);
  assert.equal(prepared.subjectRefs[0].label,'학생A');
  assert.equal(prepared.trialAccess.resolve('학생A').guestName,'박하늘');
  const sanitized=sanitizeTrialToolPayload({guest:'박하늘',status:'pending'},prepared);
  assert.equal(sanitized.guest,'학생A');
});

test('trial update changes date time and group but stores only a pending action',async()=>{
  const {rpc,calls}=baseRpc({
    slots:[slot({class_group:'A'}),slot({class_group:'B'})],
    targetRows:[row()],
  });
  const result=await prepareTrialUpdateAction({
    requestContext:requestContext(),trialAccess:trialAccess(),guestLabel:'학생A',
    sourceDate:'2026-10-02',sourceHour:4,sourceMinute:30,sourceGroup:'A',
    targetDate:'2026-10-03',targetHour:1,targetMinute:0,targetGroup:'B',
    currentDate:'2026-10-01',requestId:'req-trial-1',sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.action_type,'update_trial');
  assert.equal(result.target_date,'2026-10-03');
  assert.equal(result.target_time_label,'1시');
  assert.equal(result.target_class_group,'B');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'update_trial');
  assert.equal(action.params.p_action_payload.oneTimeSessionId,'44444444-4444-4444-8444-444444444444');
  assert.equal(action.params.p_action_payload.targetSessionDate,'2026-10-03');
  assert.equal(action.params.p_action_payload.targetTimeSlot,1);
  assert.equal(action.params.p_action_payload.targetClassGroup,'B');
  assert.equal(action.params.p_action_payload.guestName,'박하늘');
  assert.ok(!calls.some(c=>/update_one_time_session|action_execute/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/박하늘|44444444|oneTimeSessionId|targetTimeSlot|guestName/);
});

test('same visible trial time can switch A to B',async()=>{
  const {rpc}=baseRpc({
    slots:[
      slot({date:'2026-10-02',weekday:5,time_slot:10,class_group:'A',time_label:'4시 30분'}),
      slot({date:'2026-10-02',weekday:5,time_slot:10,class_group:'B',time_label:'4시 30분'}),
    ],
  });
  const result=await prepareTrialUpdateAction({
    requestContext:requestContext(),trialAccess:trialAccess(),guestLabel:'학생A',
    sourceDate:'2026-10-02',sourceHour:4,sourceMinute:30,sourceGroup:'A',
    targetDate:'',targetHour:4,targetMinute:30,targetGroup:'B',
    currentDate:'2026-10-01',requestId:'req-trial-ab',sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.source_time_label,'4시 30분');
  assert.equal(result.target_time_label,'4시 30분');
  assert.equal(result.source_class_group,'A');
  assert.equal(result.target_class_group,'B');
});

test('omitted trial target time and group preserve current values',async()=>{
  const {rpc}=baseRpc({
    slots:[slot({date:'2026-10-09',weekday:5,time_slot:10,class_group:'A',time_label:'4시 30분',grouped:false})],
  });
  const result=await prepareTrialUpdateAction({
    requestContext:requestContext(),trialAccess:trialAccess(),guestLabel:'학생A',
    sourceDate:'2026-10-02',sourceHour:0,sourceMinute:0,sourceGroup:'AUTO',
    targetDate:'2026-10-09',targetHour:0,targetMinute:0,targetGroup:'AUTO',
    currentDate:'2026-10-01',requestId:'req-trial-preserve',sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.target_date,'2026-10-09');
  assert.equal(result.target_time_label,'4시 30분');
  assert.equal(result.target_class_group,'A');
});

test('multiple same-name trial rows are never guessed',async()=>{
  const {rpc}=baseRpc({
    rows:[row(),row({id:'55555555-5555-4555-8555-555555555555',time_slot:11,class_group:'B'})],
  });
  await assert.rejects(
    prepareTrialUpdateAction({
      requestContext:requestContext(),trialAccess:trialAccess(),guestLabel:'학생A',
      sourceDate:'2026-10-02',
      currentDate:'2026-10-01',requestId:'req-trial-amb',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_TRIAL_UPDATE_SOURCE_AMBIGUOUS'
  );
});

test('duplicate same-name guest trial at target is blocked before confirmation',async()=>{
  const other=row({
    id:'66666666-6666-4666-8666-666666666666',
    session_date:'2026-10-03',time_slot:1,class_group:'B',
  });
  const {rpc}=baseRpc({
    rows:[row(),other],
    slots:[slot({class_group:'B'})],
  });
  await assert.rejects(
    prepareTrialUpdateAction({
      requestContext:requestContext(),trialAccess:trialAccess(),guestLabel:'학생A',
      sourceDate:'2026-10-02',targetDate:'2026-10-03',targetHour:1,targetMinute:0,targetGroup:'B',
      currentDate:'2026-10-01',requestId:'req-trial-dup',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_TRIAL_UPDATE_TARGET_DUPLICATE'
  );
});

test('trial update scope uses anonymous guest label and rejects non-update intent',()=>{
  const prepared={
    subjectRefs:[{label:'학생A'}],
    trialAccess:trialAccess(),
    safeText:'학생A 10월 2일 체험수업을 10월 3일로 변경해줘',
    needsDisambiguation:false,
  };
  assert.equal(resolveTrialUpdatePrepareScope(prepared).guestLabel,'학생A');
  assert.throws(
    ()=>resolveTrialUpdatePrepareScope({...prepared,safeText:'학생A 체험수업 취소해줘'}),
    e=>e?.code==='OLLI_AGENT_TRIAL_UPDATE_INTENT_REQUIRED'
  );
});

test('trial update retry key is deterministic',()=>{
  const input={academyId:'a',memberId:'m',requestId:'team-chat-message:101'};
  assert.equal(stableTrialUpdateActionClientMessageId(input),stableTrialUpdateActionClientMessageId(input));
  assert.notEqual(stableTrialUpdateActionClientMessageId(input),stableTrialUpdateActionClientMessageId({...input,requestId:'team-chat-message:102'}));
});

test('trial tool schema exposes no real guest name or internal ids',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/trial-update-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/source_date/);
  assert.match(schema,/target_date/);
  assert.doesNotMatch(schema,/guestName|studentName|oneTimeSessionId|timeSlot|academyId|memberId|division/);
});

test('endpoint keeps trial probe and adds privacy-safe production mode',()=>{
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  assert.match(endpoint,/'trial_update_prepare_probe'/);
  assert.match(endpoint,/prepareTrialGuestPrivacyInput\(message, requestContext\)/);
  assert.match(endpoint,/runTrialUpdatePrepareProbe/);
  assert.match(endpoint,/trial_update_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다/);
  assert.match(endpoint,/mode === 'trial_update_prepare'/);
  assert.match(endpoint,/runTrialUpdatePrepare\(/);
  assert.match(endpoint,/OLLI_AGENT_TRIAL_SOURCE_MESSAGE_REQUIRED/);
});
