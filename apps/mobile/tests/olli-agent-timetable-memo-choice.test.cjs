const test=require('node:test');
const assert=require('node:assert/strict');

const {
  prepareTimetableMemoAction,
  memoTargetKey,
  parseMemoTargetKey,
}=require('../api/_lib/olli-agent/tools/timetable-memo-tools.cjs');

function requestContext(){
  return {
    sessionToken:'session',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}
function subjectAccess(){
  return {resolve(label){
    return label==='학생A'
      ? {studentId:'33333333-3333-4333-8333-333333333333',division:'elementary'}
      : null;
  }};
}
function enrollment(id,timeSlot,group='A'){
  return {
    id,
    student_id:'33333333-3333-4333-8333-333333333333',
    student_name:'민준',
    division:'elementary',
    weekday:1,
    time_slot:timeSlot,
    class_group:group,
    effective_from:'2026-01-01',
    effective_to:null,
  };
}
function baseRpc(){
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_academy_settings_get'){
      return {ok:true,academy:{kinder_timetable_mode:'hourly'}};
    }
    if(name==='olli_schedule_week'){
      return {
        ok:true,
        timetable_mode:'hourly',
        enrollments:[
          enrollment('enrollment-1',4,'A'),
          enrollment('enrollment-2',5,'A'),
        ],
        one_time_sessions:[],
      };
    }
    if(name==='olli_schedule_kinder_class_layouts'){
      return {ok:true,layouts:[]};
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'pending',
          action:{id:'action-1',action_type:'add_timetable_memo',status:'pending'}
        }
      };
    }
    throw new Error('unexpected rpc '+name);
  };
  return {rpc,calls};
}

test('memo target key is deterministic and rejects malformed values',()=>{
  assert.equal(memoTargetKey({division:'elementary',timeSlot:5,classGroup:'A'}),'elementary|5|A');
  assert.deepEqual(parseMemoTargetKey('elementary|5|A'),{
    division:'elementary',timeSlot:5,classGroup:'A',key:'elementary|5|A'
  });
  assert.equal(parseMemoTargetKey('bad|5|A'),null);
});

test('structured timetable memo returns class buttons instead of typed time re-entry',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareTimetableMemoAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    operation:'add',
    sessionDate:'2026-10-05',
    hour:0,
    minute:0,
    classGroup:'AUTO',
    allowChoice:true,
    memoNote:'준비물 확인',
    requestId:'memo-choice',
    sanitizePayload:p=>p,
    callRpc:rpc,
  });
  assert.equal(result.code,'target_choice_required');
  assert.equal(result.choiceKey,'memoTargetKey');
  assert.deepEqual(result.choices.map(item=>item.id),['elementary|4|A','elementary|5|A']);
  assert.match(result.message,/선택해 주세요/);
  assert.equal(calls.some(item=>item.name==='olli_team_chat_send_action'),false);
});

test('selected memo class key is re-read before pending confirmation',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareTimetableMemoAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    operation:'add',
    sessionDate:'2026-10-05',
    hour:0,
    minute:0,
    classGroup:'AUTO',
    memoTargetKey:'elementary|5|A',
    allowChoice:true,
    memoNote:'준비물 확인',
    requestId:'memo-choice-selected',
    replyToMessageId:88,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });
  assert.equal(result.action_type,'add_timetable_memo');
  const sent=calls.find(item=>item.name==='olli_team_chat_send_action');
  assert.ok(sent);
  assert.equal(sent.params.p_action_payload.timeSlot,5);
  assert.equal(sent.params.p_action_payload.classGroup,'A');
  assert.equal(sent.params.p_action_payload.memoNote,'준비물 확인');
  assert.equal(sent.params.p_reply_to_message_id,88);
});


test('studentless split timetable memo offers A/B buttons instead of typed group re-entry',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_academy_settings_get'){
      return {ok:true,academy:{kinder_timetable_mode:'hourly'}};
    }
    if(name==='olli_schedule_week'){
      return {
        ok:true,
        timetable_mode:'hourly',
        enrollments:[],
        one_time_sessions:[],
        class_split_periods:[{
          weekday:1,
          time_slot:5,
          effective_from:'2026-01-01',
          effective_to:null,
        }],
      };
    }
    if(name==='olli_schedule_kinder_class_layouts'){
      return {ok:true,layouts:[],merged_slots:[]};
    }
    if(name==='olli_team_chat_send_action'){
      throw new Error('A/B choice must not persist final action');
    }
    throw new Error('unexpected rpc '+name);
  };

  const result=await prepareTimetableMemoAction({
    requestContext:requestContext(),
    subjectAccess:{resolve(){return null;}},
    studentLabel:'',
    division:'elementary',
    operation:'add',
    sessionDate:'2026-10-05',
    hour:5,
    minute:0,
    classGroup:'AUTO',
    allowChoice:true,
    memoNote:'준비물 확인',
    requestId:'memo-group-choice',
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.code,'target_choice_required');
  assert.equal(result.choiceKey,'memoTargetKey');
  assert.deepEqual(result.choices,[
    {id:'elementary|5|A',label:'A반'},
    {id:'elementary|5|B',label:'B반'}
  ]);
  assert.equal(calls.some(item=>item.name==='olli_team_chat_send_action'),false);
});

test('selected studentless A/B memo target is re-read before pending confirmation',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_academy_settings_get'){
      return {ok:true,academy:{kinder_timetable_mode:'hourly'}};
    }
    if(name==='olli_schedule_week'){
      return {
        ok:true,
        timetable_mode:'hourly',
        enrollments:[],
        one_time_sessions:[],
        class_split_periods:[{
          weekday:1,
          time_slot:5,
          effective_from:'2026-01-01',
          effective_to:null,
        }],
      };
    }
    if(name==='olli_schedule_kinder_class_layouts'){
      return {ok:true,layouts:[],merged_slots:[]};
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:902,
          body:'pending',
          action:{id:'action-2',action_type:'add_timetable_memo',status:'pending'}
        }
      };
    }
    throw new Error('unexpected rpc '+name);
  };

  const result=await prepareTimetableMemoAction({
    requestContext:requestContext(),
    subjectAccess:{resolve(){return null;}},
    studentLabel:'',
    division:'elementary',
    operation:'add',
    sessionDate:'2026-10-05',
    hour:0,
    minute:0,
    classGroup:'AUTO',
    memoTargetKey:'elementary|5|B',
    allowChoice:true,
    memoNote:'준비물 확인',
    requestId:'memo-group-choice-selected',
    replyToMessageId:89,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'add_timetable_memo');
  const sent=calls.find(item=>item.name==='olli_team_chat_send_action');
  assert.ok(sent);
  assert.equal(sent.params.p_action_payload.timeSlot,5);
  assert.equal(sent.params.p_action_payload.classGroup,'B');
  assert.equal(sent.params.p_reply_to_message_id,89);
});
