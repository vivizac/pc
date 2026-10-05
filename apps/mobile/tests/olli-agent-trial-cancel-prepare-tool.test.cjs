const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  extractTrialGuestName,
  prepareTrialCancelPrivacyInput,
  sanitizeTrialToolPayload,
}=require('../api/_lib/olli-agent/trial-guest-privacy.cjs');
const {
  normalizeTrialCancelReason,
  stableTrialCancelActionClientMessageId,
  prepareTrialCancelAction,
}=require('../api/_lib/olli-agent/tools/trial-cancel-prepare-tools.cjs');
const {
  resolveTrialCancelPrepareScope,
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
    session_date:'2026-10-03',
    time_slot:1,
    class_group:'A',
    session_type:'trial',
    status:'scheduled',
  },overrides);
}
function baseRpc({rows}={}){
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week'){
      return {ok:true,timetable_mode:'half_hour',one_time_sessions:rows||[row()]};
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'체험수업을 취소할까요?',
          action:{id:'action-1',action_type:'cancel_trial',status:'pending'}
        }
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('trial cancel privacy removes inline reason before guest extraction and sends only anonymous label',()=>{
  const raw='@올리 박하늘 10월 3일 1시 체험수업 취소해줘, 사유: 가족여행';
  assert.equal(extractTrialGuestName('@올리 박하늘 10월 3일 1시 체험수업 취소해줘'),'박하늘');
  const prepared=prepareTrialCancelPrivacyInput(raw,'가족여행');
  assert.doesNotMatch(prepared.safeText,/박하늘|가족여행/);
  assert.match(prepared.safeText,/학생A/);
  assert.equal(prepared.trialAccess.resolve('학생A').guestName,'박하늘');
  const sanitized=sanitizeTrialToolPayload({guest:'박하늘',status:'pending'},prepared);
  assert.equal(sanitized.guest,'학생A');
});

test('trial cancel stores only a pending action and keeps reason server-side',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareTrialCancelAction({
    requestContext:requestContext(),
    trialAccess:trialAccess(),
    guestLabel:'학생A',
    sourceDate:'2026-10-03',
    sourceHour:1,
    sourceMinute:0,
    classGroup:'A',
    reason:'가족여행',
    currentDate:'2026-10-01',
    requestId:'trial-cancel-1',
    replyToMessageId:78,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'cancel_trial');
  assert.equal(result.session_date,'2026-10-03');
  assert.equal(result.time_label,'1시');
  assert.equal(result.class_group,'A');

  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'cancel_trial');
  assert.equal(action.params.p_reply_to_message_id,78);
  assert.equal(action.params.p_action_payload.guestName,'박하늘');
  assert.equal(action.params.p_action_payload.oneTimeSessionId,'44444444-4444-4444-8444-444444444444');
  assert.equal(action.params.p_action_payload.reason,'가족여행');
  assert.ok(!calls.some(c=>/cancel_one_time|action_execute/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/박하늘|가족여행|oneTimeSessionId|timeSlot|guestName/);
});

test('trial cancel never guesses when multiple current guest trials match',async()=>{
  const {rpc}=baseRpc({
    rows:[
      row(),
      row({id:'55555555-5555-4555-8555-555555555555',time_slot:2,class_group:'B'}),
    ]
  });
  await assert.rejects(
    prepareTrialCancelAction({
      requestContext:requestContext(),
      trialAccess:trialAccess(),
      guestLabel:'학생A',
      sourceDate:'2026-10-03',
      reason:'가족여행',
      currentDate:'2026-10-01',
      requestId:'trial-cancel-ambiguous',
      sanitizePayload:p=>p,
      callRpc:rpc,
    }),
    error=>error?.code==='OLLI_AGENT_TRIAL_CANCEL_AMBIGUOUS'
  );
});

test('structured trial cancel can return finite current-trial choices without mutation',async()=>{
  const {rpc,calls}=baseRpc({rows:[
    row(),
    row({id:'55555555-5555-4555-8555-555555555555',time_slot:2,class_group:'B'}),
  ]});
  const result=await prepareTrialCancelAction({
    requestContext:requestContext(),trialAccess:trialAccess(),guestLabel:'학생A',
    sourceDate:'2026-10-03',reason:'가족여행',currentDate:'2026-10-01',
    requestId:'trial-cancel-choice',allowChoice:true,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,'target_choice_required');
  assert.equal(result.choiceKey,'oneTimeSessionId');
  assert.deepEqual(result.choices.map(item=>item.id),[
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555'
  ]);
  assert.equal(calls.some(item=>item.name==='olli_team_chat_send_action'),false);
});

test('structured trial cancel re-reads a selected one-time session before pending confirmation',async()=>{
  const {rpc,calls}=baseRpc({rows:[
    row(),
    row({id:'55555555-5555-4555-8555-555555555555',time_slot:2,class_group:'B'}),
  ]});
  const result=await prepareTrialCancelAction({
    requestContext:requestContext(),trialAccess:trialAccess(),guestLabel:'학생A',
    sourceDate:'2026-10-03',oneTimeSessionId:'55555555-5555-4555-8555-555555555555',
    allowChoice:true,reason:'가족여행',currentDate:'2026-10-01',
    requestId:'trial-cancel-choice-selected',replyToMessageId:88,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.ok,true);
  const action=calls.find(item=>item.name==='olli_team_chat_send_action');
  assert.ok(action);
  assert.equal(action.params.p_action_payload.oneTimeSessionId,'55555555-5555-4555-8555-555555555555');
  assert.equal(action.params.p_reply_to_message_id,88);
});

test('trial cancel group filter resolves A/B without changing the stored trial',async()=>{
  const {rpc,calls}=baseRpc({
    rows:[
      row({class_group:'A'}),
      row({id:'55555555-5555-4555-8555-555555555555',class_group:'B'}),
    ]
  });
  const result=await prepareTrialCancelAction({
    requestContext:requestContext(),
    trialAccess:trialAccess(),
    guestLabel:'학생A',
    sourceDate:'2026-10-03',
    sourceHour:1,
    sourceMinute:0,
    classGroup:'B',
    reason:'일정변경',
    currentDate:'2026-10-01',
    requestId:'trial-cancel-b',
    sanitizePayload:p=>p,
    callRpc:rpc,
  });
  assert.equal(result.class_group,'B');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.oneTimeSessionId,'55555555-5555-4555-8555-555555555555');
});

test('trial cancel reason normalization rejects generic cancellation words',()=>{
  assert.equal(normalizeTrialCancelReason('사유: 가족여행'),'가족여행');
  assert.throws(
    ()=>normalizeTrialCancelReason('취소'),
    error=>error?.code==='OLLI_AGENT_TRIAL_CANCEL_REASON_REQUIRED'
  );
});

test('trial cancel scope accepts cancellation and rejects add/update intent',()=>{
  const prepared={
    subjectRefs:[{label:'학생A'}],
    trialAccess:trialAccess(),
    safeText:'학생A 10월 3일 1시 A반 체험수업 취소해줘',
    needsDisambiguation:false,
  };
  assert.equal(resolveTrialCancelPrepareScope(prepared).guestLabel,'학생A');
  assert.equal(resolveTrialCancelPrepareScope(prepared).classGroup,'A');
  assert.throws(
    ()=>resolveTrialCancelPrepareScope({...prepared,safeText:'학생A 체험수업 등록해줘'}),
    error=>error?.code==='OLLI_AGENT_TRIAL_CANCEL_INTENT_REQUIRED'
  );
});

test('trial cancel retry key is deterministic',()=>{
  const input={academyId:'a',memberId:'m',requestId:'team-chat-trial-cancel:10:11'};
  assert.equal(stableTrialCancelActionClientMessageId(input),stableTrialCancelActionClientMessageId(input));
  assert.notEqual(
    stableTrialCancelActionClientMessageId(input),
    stableTrialCancelActionClientMessageId({...input,requestId:'team-chat-trial-cancel:10:12'})
  );
});

test('trial cancel tool schema never exposes reason, real guest name, or internal ids to the model',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/trial-cancel-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/source_date/);
  assert.match(schema,/source_hour/);
  assert.match(schema,/source_minute/);
  assert.doesNotMatch(schema,/reason|guestName|studentName|oneTimeSessionId|timeSlot|academyId|memberId|division/);
});
