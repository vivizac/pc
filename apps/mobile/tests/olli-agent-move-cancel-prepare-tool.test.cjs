const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  requestedTimeLabel,
  stableMoveCancelActionClientMessageId,
  previousDateKey,
  prepareMoveCancelAction,
}=require('../api/_lib/olli-agent/tools/move-cancel-prepare-tools.cjs');
const {resolveMoveCancelPrepareScope}=require('../api/_lib/olli-agent/runtime.cjs');

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
function move(overrides={}){
  return Object.assign({
    id:'44444444-4444-4444-8444-444444444444',
    student_id:'33333333-3333-4333-8333-333333333333',
    student_name:'실제학생',
    division:'elementary',
    change_type:'move',
    source_enrollment_id:'55555555-5555-4555-8555-555555555555',
    target_enrollment_id:'66666666-6666-4666-8666-666666666666',
    target_class_group:'B',
    effective_date:'2026-10-12',
    status:'scheduled',
  },overrides);
}
function sourceEnrollment(overrides={}){
  return Object.assign({
    id:'55555555-5555-4555-8555-555555555555',
    student_id:'33333333-3333-4333-8333-333333333333',
    weekday:5,
    time_slot:10,
    class_group:'A',
  },overrides);
}
function targetEnrollment(overrides={}){
  return Object.assign({
    id:'66666666-6666-4666-8666-666666666666',
    student_id:'33333333-3333-4333-8333-333333333333',
    weekday:2,
    time_slot:5,
    class_group:'B',
  },overrides);
}
function baseRpc({changes,currentEnrollments,sourceEnrollments,targetEnrollments}={}){
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
      const monday=String(params?.p_week_start||'');
      if(monday==='2026-09-28'){
        return {
          ok:true,
          week_start:monday,
          timetable_mode:'half_hour',
          changes:changes||[move()],
          enrollments:currentEnrollments||[],
        };
      }
      if(monday==='2026-10-05'){
        return {
          ok:true,
          week_start:monday,
          timetable_mode:'half_hour',
          changes:changes||[move()],
          enrollments:sourceEnrollments||[sourceEnrollment()],
        };
      }
      if(monday==='2026-10-12'){
        return {
          ok:true,
          week_start:monday,
          timetable_mode:'half_hour',
          changes:changes||[move()],
          enrollments:targetEnrollments||[targetEnrollment()],
        };
      }
      throw new Error('unexpected week '+monday);
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'예약된 수업 이동을 취소할까요?',
          action:{id:'action-1',action_type:'cancel_move',status:'pending'}
        }
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('move cancel re-resolves scheduled move and stores only a pending action',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareMoveCancelAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sourceWeekday:5,
    sourceHour:4,
    sourceMinute:30,
    currentDate:'2026-10-01',
    requestId:'move-cancel-1',
    replyToMessageId:77,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'cancel_move');
  assert.equal(result.effective_date,'2026-10-12');
  assert.equal(result.source_weekday,5);
  assert.equal(result.source_time_label,'4시 30분');
  assert.equal(result.target_weekday,2);
  assert.equal(result.target_time_label,'5시');

  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'cancel_move');
  assert.equal(action.params.p_reply_to_message_id,77);
  assert.equal(action.params.p_action_payload.changeId,'44444444-4444-4444-8444-444444444444');
  assert.equal(action.params.p_action_payload.sourceWeekday,5);
  assert.equal(action.params.p_action_payload.sourceTimeSlot,10);
  assert.equal(action.params.p_action_payload.targetWeekday,2);
  assert.equal(action.params.p_action_payload.targetTimeSlot,5);
  assert.ok(!calls.some(c=>/action_execute|cancel_change/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/33333333|44444444|55555555|66666666|실제학생|changeId|sourceTimeSlot|targetTimeSlot/);
});

test('move cancel never guesses when multiple future moves remain',async()=>{
  const second=move({
    id:'77777777-7777-4777-8777-777777777777',
    source_enrollment_id:'88888888-8888-4888-8888-888888888888',
    target_enrollment_id:'99999999-9999-4999-8999-999999999999',
    effective_date:'2026-10-19',
  });
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_student_data_access'){
      return {ok:true,rows:[{id:'33333333-3333-4333-8333-333333333333',name:'실제학생',division:'elementary',status:'active',is_deleted:false}]};
    }
    if(name==='olli_schedule_week'){
      const monday=String(params?.p_week_start||'');
      if(monday==='2026-09-28') return {ok:true,week_start:monday,timetable_mode:'hourly',changes:[move(),second],enrollments:[]};
      if(monday==='2026-10-05') return {ok:true,week_start:monday,timetable_mode:'hourly',changes:[move(),second],enrollments:[sourceEnrollment({time_slot:4})]};
      if(monday==='2026-10-12') return {ok:true,week_start:monday,timetable_mode:'hourly',changes:[move(),second],enrollments:[
        targetEnrollment({time_slot:5}),
        {id:'88888888-8888-4888-8888-888888888888',student_id:'33333333-3333-4333-8333-333333333333',weekday:3,time_slot:4,class_group:'A'}
      ]};
      if(monday==='2026-10-19') return {ok:true,week_start:monday,timetable_mode:'hourly',changes:[move(),second],enrollments:[
        {id:'99999999-9999-4999-8999-999999999999',student_id:'33333333-3333-4333-8333-333333333333',weekday:4,time_slot:5,class_group:'A'}
      ]};
      throw new Error('unexpected week '+monday);
    }
    throw new Error('unexpected RPC: '+name);
  };

  await assert.rejects(
    prepareMoveCancelAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      currentDate:'2026-10-01',requestId:'move-cancel-many',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_MOVE_CANCEL_AMBIGUOUS'
  );
  assert.ok(!calls.some(c=>c.name==='olli_team_chat_send_action'));
});

test('structured move cancel returns finite reservation choices without mutation',async()=>{
  const second=move({
    id:'77777777-7777-4777-8777-777777777777',
    source_enrollment_id:'88888888-8888-4888-8888-888888888888',
    target_enrollment_id:'99999999-9999-4999-8999-999999999999',
    effective_date:'2026-10-19',
  });
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_student_data_access') return {ok:true,rows:[{id:'33333333-3333-4333-8333-333333333333',name:'실제학생',division:'elementary',status:'active',is_deleted:false}]};
    if(name==='olli_schedule_week'){
      const monday=String(params?.p_week_start||'');
      if(monday==='2026-09-28') return {ok:true,week_start:monday,timetable_mode:'hourly',changes:[move(),second],enrollments:[]};
      if(monday==='2026-10-05') return {ok:true,week_start:monday,timetable_mode:'hourly',changes:[move(),second],enrollments:[sourceEnrollment({time_slot:4})]};
      if(monday==='2026-10-12') return {ok:true,week_start:monday,timetable_mode:'hourly',changes:[move(),second],enrollments:[
        targetEnrollment({time_slot:5}),
        {id:'88888888-8888-4888-8888-888888888888',student_id:'33333333-3333-4333-8333-333333333333',weekday:3,time_slot:4,class_group:'A'}
      ]};
      if(monday==='2026-10-19') return {ok:true,week_start:monday,timetable_mode:'hourly',changes:[move(),second],enrollments:[
        {id:'99999999-9999-4999-8999-999999999999',student_id:'33333333-3333-4333-8333-333333333333',weekday:4,time_slot:5,class_group:'A'}
      ]};
      throw new Error('unexpected week '+monday);
    }
    if(name==='olli_team_chat_send_action') throw new Error('choice must not persist final action');
    throw new Error('unexpected RPC: '+name);
  };
  const result=await prepareMoveCancelAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
    currentDate:'2026-10-01',requestId:'move-cancel-choice',allowChoice:true,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.code,'target_choice_required');
  assert.equal(result.choiceKey,'changeId');
  assert.equal(result.studentName,'실제학생');
  assert.deepEqual(result.choices.map(item=>item.id),[
    '44444444-4444-4444-8444-444444444444',
    '77777777-7777-4777-8777-777777777777'
  ]);
  assert.ok(!calls.some(item=>item.name==='olli_team_chat_send_action'));
});

test('structured move cancel re-reads selected change id before pending confirmation',async()=>{
  const {rpc,calls}=baseRpc();
  await prepareMoveCancelAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
    changeId:'44444444-4444-4444-8444-444444444444',allowChoice:true,
    currentDate:'2026-10-01',requestId:'move-cancel-selected',replyToMessageId:91,
    sanitizePayload:p=>p,callRpc:rpc,
  });
  const action=calls.find(item=>item.name==='olli_team_chat_send_action');
  assert.ok(action);
  assert.equal(action.params.p_action_payload.changeId,'44444444-4444-4444-8444-444444444444');
  assert.equal(action.params.p_reply_to_message_id,91);
});

test('source weekday and visible half-hour select only the matching reservation',async()=>{
  const other=move({
    id:'77777777-7777-4777-8777-777777777777',
    source_enrollment_id:'88888888-8888-4888-8888-888888888888',
    target_enrollment_id:'99999999-9999-4999-8999-999999999999',
  });
  const {rpc,calls}=baseRpc({
    changes:[move(),other],
    sourceEnrollments:[
      sourceEnrollment(),
      {id:'88888888-8888-4888-8888-888888888888',student_id:'33333333-3333-4333-8333-333333333333',weekday:4,time_slot:4,class_group:'A'},
    ],
    targetEnrollments:[
      targetEnrollment(),
      {id:'99999999-9999-4999-8999-999999999999',student_id:'33333333-3333-4333-8333-333333333333',weekday:3,time_slot:6,class_group:'A'},
    ],
  });

  await prepareMoveCancelAction({
    requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
    sourceWeekday:5,sourceHour:4,sourceMinute:30,currentDate:'2026-10-01',
    requestId:'move-cancel-filter',sanitizePayload:p=>p,callRpc:rpc,
  });
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.changeId,'44444444-4444-4444-8444-444444444444');
});

test('applied or non-future moves cannot produce a cancellation card',async()=>{
  const {rpc,calls}=baseRpc({
    changes:[move({status:'applied',effective_date:'2026-10-12'}),move({id:'77777777-7777-4777-8777-777777777777',effective_date:'2026-09-30'})]
  });
  await assert.rejects(
    prepareMoveCancelAction({
      requestContext:requestContext(),subjectAccess:subjectAccess(),studentLabel:'학생A',division:'elementary',
      currentDate:'2026-10-01',requestId:'move-cancel-past',sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_MOVE_CANCEL_NOT_FOUND'
  );
  assert.ok(!calls.some(c=>c.name==='olli_team_chat_send_action'));
});

test('scope requires exactly one registered student and cancellation intent',()=>{
  assert.throws(
    ()=>resolveMoveCancelPrepareScope({needsDisambiguation:false,subjectRefs:[],safeText:'수업 이동 예약 취소해줘'}),
    e=>e?.code==='OLLI_AGENT_MOVE_CANCEL_SINGLE_STUDENT_REQUIRED'
  );
  const prepared={
    needsDisambiguation:false,
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
    safeText:'학생A 월요일 4시 수업 이동 예약 취소해줘',
  };
  const scope=resolveMoveCancelPrepareScope(prepared);
  assert.equal(scope.subjectLabel,'학생A');
  assert.equal(scope.division,'elementary');
  assert.throws(
    ()=>resolveMoveCancelPrepareScope({...prepared,safeText:'학생A 월요일 4시에서 화요일 5시로 수업 이동해줘'}),
    e=>e?.code==='OLLI_AGENT_MOVE_CANCEL_INTENT_REQUIRED'
  );
});

test('helpers and retry id are deterministic',()=>{
  assert.equal(requestedTimeLabel(4,30),'4시 30분');
  assert.equal(previousDateKey('2026-10-12'),'2026-10-11');
  const input={academyId:'a',memberId:'m',requestId:'team-chat-message:77'};
  assert.equal(stableMoveCancelActionClientMessageId(input),stableMoveCancelActionClientMessageId(input));
  assert.notEqual(
    stableMoveCancelActionClientMessageId(input),
    stableMoveCancelActionClientMessageId({...input,requestId:'team-chat-message:78'})
  );
});

test('move cancel model schema exposes no ids or real names',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/move-cancel-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/source_weekday/);
  assert.match(schema,/source_hour/);
  assert.match(schema,/source_minute/);
  assert.doesNotMatch(schema,/studentId|studentName|changeId|enrollmentId|timeSlot|academyId|memberId|division/);
});
