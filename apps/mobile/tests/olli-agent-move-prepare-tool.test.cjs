const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  prepareMoveAction,
  stableMoveActionClientMessageId,
}=require('../api/_lib/olli-agent/tools/move-prepare-tools.cjs');
const {resolveMovePrepareScope}=require('../api/_lib/olli-agent/runtime.cjs');

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
function enrollment(overrides={}){
  return Object.assign({
    id:'44444444-4444-4444-8444-444444444444',
    student_id:'33333333-3333-4333-8333-333333333333',
    student_name:'실제학생',
    division:'elementary',
    weekday:5,
    time_slot:10,
    class_group:'A',
    effective_from:'2026-09-01',
    effective_to:null,
    status:'active',
  },overrides);
}
function slot(overrides={}){
  return Object.assign({
    date:'2026-10-06',
    weekday:2,
    time_slot:5,
    class_group:'A',
    grouped:true,
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
function baseRpc({enrollments,slots,closedDates}={}){
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
    if(name==='olli_schedule_week'){
      return {
        ok:true,
        week_start:'2026-09-28',
        timetable_mode:'half_hour',
        enrollments:enrollments||[enrollment()],
      };
    }
    if(name==='olli_schedule_availability_slots'){
      return {
        ok:true,
        timetable_mode:'half_hour',
        capacity:8,
        slots:slots||[slot(),slot({class_group:'B'})],
        closed_dates:closedDates||[],
      };
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'정규수업 시간을 변경할까요?',
          action:{id:'action-1',action_type:'move_class',status:'pending'}
        }
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('move prepare maps visible half-hour times and stores only a pending move card',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareMoveAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sourceWeekday:5,
    sourceHour:4,
    sourceMinute:30,
    targetWeekday:2,
    targetHour:5,
    targetMinute:0,
    targetClassGroup:'AUTO',
    currentDate:'2026-10-01',
    requestId:'move-1',
    replyToMessageId:77,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'move_class');
  assert.equal(result.source_time_label,'4시 30분');
  assert.equal(result.target_time_label,'5시');
  assert.equal(result.target_class_group,'A');
  assert.equal(result.effective_date,'2026-10-01');
  assert.equal(result.target_check_date,'2026-10-06');

  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'move_class');
  assert.equal(action.params.p_reply_to_message_id,77);
  assert.equal(action.params.p_action_payload.sourceEnrollmentId,'44444444-4444-4444-8444-444444444444');
  assert.equal(action.params.p_action_payload.sourceTimeSlot,10);
  assert.equal(action.params.p_action_payload.targetTimeSlot,5);
  assert.equal(action.params.p_action_payload.targetClassGroup,'A');
  assert.equal(action.params.p_action_payload.effectiveDate,'2026-10-01');
  assert.ok(!calls.some(c=>/action_execute|olli_schedule_execute|olli_schedule_change/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/33333333|44444444|실제학생|sourceEnrollmentId|sourceTimeSlot|targetTimeSlot/);
});

test('AUTO preserves source A group when A and B are both open',async()=>{
  const {rpc,calls}=baseRpc();
  await prepareMoveAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
    sourceWeekday:5,sourceHour:4,sourceMinute:30,targetWeekday:2,targetHour:5,targetMinute:0,
    targetClassGroup:'AUTO',currentDate:'2026-10-01',requestId:'move-auto',sanitizePayload:p=>p,callRpc:rpc,
  });
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.targetClassGroup,'A');
});

test('AUTO uses the only open group when the source group is full',async()=>{
  const {rpc,calls}=baseRpc({
    slots:[
      slot({class_group:'A',remaining:0,class_full:true,available:false,occupancy:8}),
      slot({class_group:'B',remaining:2,available:true}),
    ]
  });
  await prepareMoveAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
    sourceWeekday:5,sourceHour:4,sourceMinute:30,targetWeekday:2,targetHour:5,targetMinute:0,
    targetClassGroup:'AUTO',currentDate:'2026-10-01',requestId:'move-only-b',sanitizePayload:p=>p,callRpc:rpc,
  });
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.targetClassGroup,'B');
});

test('explicit full target group is rejected before card creation',async()=>{
  const {rpc,calls}=baseRpc({
    slots:[
      slot({class_group:'A',remaining:3,available:true}),
      slot({class_group:'B',remaining:0,class_full:true,available:false,occupancy:8}),
    ]
  });
  await assert.rejects(
    prepareMoveAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sourceWeekday:5,sourceHour:4,sourceMinute:30,targetWeekday:2,targetHour:5,targetMinute:0,
      targetClassGroup:'B',currentDate:'2026-10-01',requestId:'move-full-b',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_MOVE_TARGET_FULL'
  );
  assert.ok(!calls.some(c=>c.name==='olli_team_chat_send_action'));
});

test('existing regular enrollment at the target time is rejected',async()=>{
  const {rpc,calls}=baseRpc({
    enrollments:[
      enrollment(),
      enrollment({
        id:'55555555-5555-4555-8555-555555555555',
        weekday:2,
        time_slot:5,
        class_group:'A',
      })
    ]
  });
  await assert.rejects(
    prepareMoveAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      sourceWeekday:5,sourceHour:4,sourceMinute:30,targetWeekday:2,targetHour:5,targetMinute:0,
      targetClassGroup:'AUTO',currentDate:'2026-10-01',requestId:'move-duplicate',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_MOVE_TARGET_ALREADY_ENROLLED'
  );
  assert.ok(!calls.some(c=>c.name==='olli_team_chat_send_action'));
});

test('move scope requires one student, two weekday/time pairs, and non-cancel move intent',()=>{
  const prepared={
    needsDisambiguation:false,
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
    safeText:'학생A 금요일 4시 30분에서 화요일 5시로 수업 이동해줘',
  };
  const scope=resolveMovePrepareScope(prepared);
  assert.equal(scope.subjectLabel,'학생A');
  assert.equal(scope.division,'elementary');

  assert.throws(
    ()=>resolveMovePrepareScope({...prepared,safeText:'학생A 금요일 4시 30분 수업 이동 취소해줘'}),
    e=>e?.code==='OLLI_AGENT_MOVE_INTENT_REQUIRED'
  );
});

test('move retry key is deterministic',()=>{
  const input={academyId:'a',memberId:'m',requestId:'team-chat-message:77'};
  assert.equal(stableMoveActionClientMessageId(input),stableMoveActionClientMessageId(input));
  assert.notEqual(
    stableMoveActionClientMessageId(input),
    stableMoveActionClientMessageId({...input,requestId:'team-chat-message:78'})
  );
});

test('move tool schema contains only visible schedule fields and no internal identifiers',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/move-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/source_weekday/);
  assert.match(schema,/source_hour/);
  assert.match(schema,/source_minute/);
  assert.match(schema,/target_weekday/);
  assert.match(schema,/target_hour/);
  assert.match(schema,/target_minute/);
  assert.match(schema,/target_class_group/);
  assert.doesNotMatch(schema,/studentId|studentName|sourceEnrollmentId|timeSlot|academyId|memberId|division|effectiveDate/);
});
