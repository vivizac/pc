const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  visibleTime,
  weekdayFromDateKey,
  nextOccurrenceOnOrAfter,
  stableWaitlistUpdateActionClientMessageId,
  prepareWaitlistUpdateAction,
}=require('../api/_lib/olli-agent/tools/waitlist-update-prepare-tools.cjs');
const {
  resolveWaitlistUpdatePrepareScope,
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
function row(overrides={}){
  return Object.assign({
    id:'44444444-4444-4444-8444-444444444444',
    student_id:'33333333-3333-4333-8333-333333333333',
    student_name:'실제학생',
    division:'elementary',
    target_division:'elementary',
    is_guest:false,
    target_weekday:5,
    target_time_slot:10,
    target_class_group:'A',
    desired_effective_date:'2026-10-02',
    status:'waiting',
  },overrides);
}
function slot(overrides={}){
  return Object.assign({
    date:'2026-10-03',
    weekday:6,
    time_slot:2,
    class_group:'A',
    grouped:true,
    capacity:8,
    regular_count:7,
    absent_count:0,
    effective_regular_count:7,
    makeup_count:0,
    trial_count:0,
    one_time_count:0,
    occupancy:7,
    remaining:1,
    waitlist_count:0,
    waitlist_open:true,
    class_full:false,
    available:true,
  },overrides);
}
function baseRpc({rows,slots,targetRows}={}){
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_student_data_access'){
      return {ok:true,rows:[{id:'33333333-3333-4333-8333-333333333333',name:'실제학생',division:'elementary',status:'active',is_deleted:false}]};
    }
    if(name==='olli_schedule_week'){
      const isTarget=String(params?.p_week_start||'')!=='2026-09-28';
      return {ok:true,timetable_mode:'half_hour',waitlist:isTarget?(targetRows||rows||[row()]):(rows||[row()])};
    }
    if(name==='olli_schedule_availability_slots'){
      return {ok:true,timetable_mode:'half_hour',capacity:8,slots:slots||[slot()],closed_dates:[]};
    }
    if(name==='olli_team_chat_send_action'){
      return {ok:true,message:{id:901,body:'대기를 변경할까요?',action:{id:'action-1',action_type:'update_waitlist',status:'pending'}}};
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('waitlist update changes date time and group but only stores a pending action',async()=>{
  const {rpc,calls}=baseRpc({
    slots:[slot({date:'2026-10-03',weekday:6,time_slot:1,class_group:'A'}),slot({date:'2026-10-03',weekday:6,time_slot:1,class_group:'B'})],
    targetRows:[row()],
  });
  const result=await prepareWaitlistUpdateAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
    sourceDate:'',sourceWeekday:5,sourceHour:4,sourceMinute:30,sourceGroup:'A',
    targetDate:'2026-10-03',targetWeekday:0,targetHour:1,targetMinute:0,targetGroup:'B',
    currentDate:'2026-10-01',requestId:'req-update-1',sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.action_type,'update_waitlist');
  assert.equal(result.target_weekday,6);
  assert.equal(result.target_time_label,'1시');
  assert.equal(result.target_class_group,'B');
  assert.equal(result.desired_effective_date,'2026-10-03');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'update_waitlist');
  assert.equal(action.params.p_action_payload.waitlistId,'44444444-4444-4444-8444-444444444444');
  assert.equal(action.params.p_action_payload.targetWeekday,6);
  assert.equal(action.params.p_action_payload.targetTimeSlot,1);
  assert.equal(action.params.p_action_payload.targetClassGroup,'B');
  assert.equal(action.params.p_action_payload.desiredEffectiveDate,'2026-10-03');
  assert.ok(!calls.some(c=>/update_waitlist_target|action_execute/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/33333333|44444444|실제학생|waitlistId|targetTimeSlot|studentId/);
});

test('same visible time can switch A to B',async()=>{
  const {rpc,calls}=baseRpc({
    slots:[
      slot({date:'2026-10-02',weekday:5,time_slot:10,class_group:'A'}),
      slot({date:'2026-10-02',weekday:5,time_slot:10,class_group:'B'}),
    ],
    targetRows:[row()],
  });
  const result=await prepareWaitlistUpdateAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
    sourceWeekday:5,sourceHour:4,sourceMinute:30,sourceGroup:'A',
    targetDate:'2026-10-02',targetHour:4,targetMinute:30,targetGroup:'B',
    currentDate:'2026-10-01',requestId:'req-ab',sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.source_time_label,'4시 30분');
  assert.equal(result.target_time_label,'4시 30분');
  assert.equal(result.source_class_group,'A');
  assert.equal(result.target_class_group,'B');
  assert.equal(calls.find(c=>c.name==='olli_team_chat_send_action').params.p_action_payload.targetTimeSlot,10);
});

test('omitted target time and group preserve current visible values',async()=>{
  const {rpc}=baseRpc({
    slots:[slot({date:'2026-10-09',weekday:5,time_slot:10,class_group:'A',grouped:false})],
    targetRows:[row()],
  });
  const result=await prepareWaitlistUpdateAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
    sourceWeekday:0,sourceHour:0,sourceMinute:0,sourceGroup:'AUTO',
    targetDate:'2026-10-09',targetWeekday:0,targetHour:0,targetMinute:0,targetGroup:'AUTO',
    currentDate:'2026-10-01',requestId:'req-preserve',sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.target_weekday,5);
  assert.equal(result.target_time_label,'4시 30분');
  assert.equal(result.target_class_group,'A');
});

test('multiple source waitlists are never guessed',async()=>{
  const {rpc}=baseRpc({rows:[row(),row({id:'55555555-5555-4555-8555-555555555555',target_weekday:6,target_time_slot:2})]});
  await assert.rejects(
    prepareWaitlistUpdateAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      currentDate:'2026-10-01',requestId:'req-amb',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_WAITLIST_UPDATE_SOURCE_AMBIGUOUS'
  );
});

test('another active waitlist at the target blocks preparation',async()=>{
  const other=row({
    id:'66666666-6666-4666-8666-666666666666',
    student_id:'77777777-7777-4777-8777-777777777777',
    target_weekday:6,target_time_slot:1,target_class_group:'B',
  });
  const {rpc}=baseRpc({
    slots:[slot({date:'2026-10-03',weekday:6,time_slot:1,class_group:'B'})],
    rows:[row(),other],
  });
  await assert.rejects(
    prepareWaitlistUpdateAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sourceWeekday:5,targetDate:'2026-10-03',targetHour:1,targetMinute:0,targetGroup:'B',
      currentDate:'2026-10-01',requestId:'req-conflict',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_WAITLIST_UPDATE_TARGET_OCCUPIED'
  );
});

test('guest fallback happens before Agents SDK execution scope',()=>{
  assert.throws(
    ()=>resolveWaitlistUpdatePrepareScope({needsDisambiguation:false,subjectRefs:[],safeText:'비재원A 대기를 금요일 4시로 변경해줘'}),
    e=>e?.code==='OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED'
  );
  const prepared={needsDisambiguation:false,subjectRefs:[{label:'학생A'}],subjectAccess:subjectAccess(),safeText:'학생A 대기를 토요일 1시 B반으로 변경해줘'};
  assert.equal(resolveWaitlistUpdatePrepareScope(prepared).subjectLabel,'학생A');
  assert.throws(
    ()=>resolveWaitlistUpdatePrepareScope({...prepared,safeText:'학생A 대기 취소해줘'}),
    e=>e?.code==='OLLI_AGENT_WAITLIST_UPDATE_INTENT_REQUIRED'
  );
});

test('stable retry key and date helpers are deterministic',()=>{
  const input={academyId:'a',memberId:'m',requestId:'team-chat-message:99'};
  assert.equal(stableWaitlistUpdateActionClientMessageId(input),stableWaitlistUpdateActionClientMessageId(input));
  assert.notEqual(stableWaitlistUpdateActionClientMessageId(input),stableWaitlistUpdateActionClientMessageId({...input,requestId:'team-chat-message:100'}));
  assert.equal(weekdayFromDateKey('2026-10-03'),6);
  assert.equal(nextOccurrenceOnOrAfter('2026-10-01',6),'2026-10-03');
  assert.equal(visibleTime(4,30),'4시 30분');
});

test('tool schema exposes no internal ids or real names',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/waitlist-update-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/source_date/);
  assert.match(schema,/target_date/);
  assert.doesNotMatch(schema,/studentId|studentName|waitlistId|timeSlot|academyId|memberId|division/);
});

test('endpoint exposes only update waitlist probe mode at this checkpoint',()=>{
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  assert.match(endpoint,/'waitlist_update_prepare_probe'/);
  assert.match(endpoint,/runWaitlistUpdatePrepareProbe/);
  assert.match(endpoint,/waitlist_update_prepare_probe에는 재시도 중복 방지용 requestId가 필요합니다/);
  assert.doesNotMatch(endpoint,/mode === 'waitlist_update_prepare'/);
});
