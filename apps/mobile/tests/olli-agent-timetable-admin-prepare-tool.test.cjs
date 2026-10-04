const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  encodeVisibleSlot,
  prepareTimetableAdminAction,
}=require('../api/_lib/olli-agent/tools/timetable-admin-prepare-tools.cjs');

function requestContext(){
  return {
    sessionToken:'session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}
function sendActionResult(type){
  return {
    ok:true,
    message:{
      id:901,
      body:'확인할까요?',
      action:{id:'action-1',action_type:type,status:'pending'}
    }
  };
}
function noMutationCalls(calls){
  const forbidden=[
    'olli_schedule_execute',
    'olli_schedule_set_kinder_class_split',
    'olli_schedule_set_class_teacher',
    'olli_schedule_set_teacher_override',
    'olli_schedule_set_session_order',
    'olli_schedule_set_normal_class_day',
  ];
  for(const name of forbidden) assert.equal(calls.some(c=>c.name===name),false,name+' must not run during prepare');
}

test('visible time encoding follows hourly and half-hour timetable source of truth',()=>{
  assert.equal(encodeVisibleSlot('elementary',3,'hourly',5,0),5);
  assert.equal(encodeVisibleSlot('elementary',3,'half_hour',4,30),10);
  assert.equal(encodeVisibleSlot('kinder',3,'half_hour',3,30),7);
  assert.equal(encodeVisibleSlot('elementary',6,'hourly',1,0),10);
});

test('elementary split stores only a pending set_class_layout card',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week'){
      return {ok:true,timetable_mode:'hourly',class_split_periods:[]};
    }
    if(name==='olli_team_chat_send_action') return sendActionResult('set_class_layout');
    throw new Error('unexpected RPC '+name);
  };
  const result=await prepareTimetableAdminAction({
    requestContext:requestContext(),
    intent:{
      intent:'set_class_layout',division:'elementary',split:true,
      dateSpec:{mode:'next_weekday',weekday:3},timeSlot:5,timeMinute:0
    },
    currentDate:'2026-10-02',
    requestId:'layout-1',
    replyToMessageId:77,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });
  assert.equal(result.action_type,'set_class_layout');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.division,'elementary');
  assert.equal(action.params.p_action_payload.split,true);
  assert.equal(action.params.p_action_payload.weekday,3);
  assert.equal(action.params.p_action_payload.timeSlot,5);
  assert.equal(action.params.p_action_payload.effectiveDate,'2026-10-07');
  noMutationCalls(calls);
});

test('recurring class teacher resolves active member server-side and stores pending card',async()=>{
  const calls=[];
  const teacherId='33333333-3333-4333-8333-333333333333';
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week'){
      return {ok:true,timetable_mode:'hourly',class_split_periods:[]};
    }
    if(name==='olli_schedule_class_teacher_context'){
      return {ok:true,teachers:[{id:teacherId,display_name:'김민지',role:'teacher'}],assignments:[]};
    }
    if(name==='olli_team_chat_send_action') return sendActionResult('set_class_teacher');
    throw new Error('unexpected RPC '+name);
  };
  const result=await prepareTimetableAdminAction({
    requestContext:requestContext(),
    intent:{
      intent:'set_class_teacher',teacherName:'김민지',division:'elementary',
      weekday:3,timeSlot:5,timeMinute:0,classGroup:''
    },
    currentDate:'2026-10-02',
    requestId:'teacher-1',
    replyToMessageId:78,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });
  assert.equal(result.action_type,'set_class_teacher');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.teacherMemberId,teacherId);
  assert.equal(action.params.p_action_payload.teacherName,'김민지');
  assert.equal(action.params.p_action_payload.classGroup,'A');
  noMutationCalls(calls);
  assert.doesNotMatch(JSON.stringify(result),/김민지|33333333/);
});

test('split class teacher assignment never guesses A or B',async()=>{
  const rpc=async(name)=>{
    if(name==='olli_schedule_week'){
      return {
        ok:true,timetable_mode:'hourly',
        class_split_periods:[{weekday:3,time_slot:5,effective_from:'2026-10-01',effective_to:null}]
      };
    }
    if(name==='olli_schedule_class_teacher_context'){
      return {ok:true,teachers:[{id:'33333333-3333-4333-8333-333333333333',display_name:'김민지'}],assignments:[]};
    }
    throw new Error('unexpected RPC '+name);
  };
  await assert.rejects(
    prepareTimetableAdminAction({
      requestContext:requestContext(),
      intent:{intent:'set_class_teacher',teacherName:'김민지',division:'elementary',weekday:3,timeSlot:5,timeMinute:0,classGroup:''},
      currentDate:'2026-10-02',requestId:'teacher-ab',replyToMessageId:80,sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_TIMETABLE_ADMIN_GROUP_REQUIRED'
  );
});

test('date-specific teacher change reads override state and stores pending override card',async()=>{
  const calls=[];
  const teacherId='33333333-3333-4333-8333-333333333333';
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week') return {ok:true,timetable_mode:'hourly',class_split_periods:[]};
    if(name==='olli_schedule_kinder_class_layouts') return {ok:true,merged_slots:[{weekday:5,time_slot:4}]};
    if(name==='olli_schedule_class_teacher_context') return {ok:true,teachers:[{id:teacherId,display_name:'김민지'}],assignments:[]};
    if(name==='olli_schedule_teacher_overrides_range') return {ok:true,overrides:[]};
    if(name==='olli_team_chat_send_action') return sendActionResult('set_teacher_override');
    throw new Error('unexpected RPC '+name);
  };
  const result=await prepareTimetableAdminAction({
    requestContext:requestContext(),
    intent:{
      intent:'set_teacher_override',teacherName:'김민지',division:'kinder',
      weekday:5,dateSpec:{mode:'this_weekday',weekday:5},timeSlot:4,timeMinute:0,classGroup:''
    },
    currentDate:'2026-10-02',requestId:'teacher-date',replyToMessageId:81,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.action_type,'set_teacher_override');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.sessionDate,'2026-10-02');
  assert.equal(action.params.p_action_payload.teacherMemberId,teacherId);
  noMutationCalls(calls);
});

test('session order resolves selected enrollment server-side and stores no student id in tool result',async()=>{
  const calls=[];
  const studentId='44444444-4444-4444-8444-444444444444';
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week'){
      return {
        ok:true,timetable_mode:'hourly',
        enrollments:[
          {id:'e1',student_id:studentId,student_name:'민지',division:'elementary',weekday:2,time_slot:4,class_group:'A',session_order:2,effective_from:'2026-01-01'},
          {id:'e2',student_id:studentId,student_name:'민지',division:'elementary',weekday:5,time_slot:5,class_group:'A',session_order:1,effective_from:'2026-01-01'},
        ]
      };
    }
    if(name==='olli_team_chat_send_action') return sendActionResult('set_session_order');
    throw new Error('unexpected RPC '+name);
  };
  const result=await prepareTimetableAdminAction({
    requestContext:requestContext(),
    intent:{intent:'set_session_order',sessionOrder:1,weekday:2,timeSlot:4,timeMinute:0,classGroup:''},
    subjectAccess:{resolve(label){return label==='학생A'?{studentId,division:'elementary'}:null;}},
    studentLabel:'학생A',
    currentDate:'2026-10-02',requestId:'order-1',replyToMessageId:82,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.action_type,'set_session_order');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.studentId,studentId);
  assert.equal(action.params.p_action_payload.enrollmentId,'e1');
  assert.equal(action.params.p_action_payload.sessionOrder,1);
  noMutationCalls(calls);
  assert.doesNotMatch(JSON.stringify(result),/민지|44444444|e1/);
});

test('holiday override stores pending normal-class action only for a registered holiday',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_calendar_range'){
      return {ok:true,days:[{
        session_date:'2026-10-09',name:'한글날',default_holiday:true,
        has_override:false,normal_class_override:false,is_holiday:true
      }]};
    }
    if(name==='olli_team_chat_send_action') return sendActionResult('set_normal_class_day');
    throw new Error('unexpected RPC '+name);
  };
  const result=await prepareTimetableAdminAction({
    requestContext:requestContext(),
    intent:{intent:'set_normal_class_day',normalClass:true,dateSpec:{mode:'month_day',month:10,day:9}},
    currentDate:'2026-10-02',requestId:'holiday-1',replyToMessageId:83,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.action_type,'set_normal_class_day');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.sessionDate,'2026-10-09');
  assert.equal(action.params.p_action_payload.normalClass,true);
  noMutationCalls(calls);
});

test('Agent tool schema is zero-argument and cannot accept ids or schedule values from the model',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/timetable-admin-prepare-tools.cjs'),'utf8');
  const start=source.indexOf("name:'prepare_timetable_admin'");
  const end=source.indexOf('async execute()',start);
  const schema=source.slice(start,end);
  assert.match(schema,/parameters:z\.object\(\{\}\)/);
  assert.doesNotMatch(schema,/teacherMemberId|studentId|enrollmentId|timeSlot|academyId|memberId/);
});


test('session order ambiguity returns current enrollment buttons instead of asking for time text',async()=>{
  const calls=[];
  const studentId='44444444-4444-4444-8444-444444444444';
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week'){
      return {
        ok:true,timetable_mode:'hourly',
        enrollments:[
          {id:'e1',student_id:studentId,student_name:'민지',division:'elementary',weekday:2,time_slot:4,class_group:'A',session_order:2,effective_from:'2026-01-01'},
          {id:'e2',student_id:studentId,student_name:'민지',division:'elementary',weekday:2,time_slot:5,class_group:'B',session_order:2,effective_from:'2026-01-01'},
        ]
      };
    }
    if(name==='olli_team_chat_send_action') throw new Error('choice must not persist final action');
    throw new Error('unexpected RPC '+name);
  };
  const result=await prepareTimetableAdminAction({
    requestContext:requestContext(),
    intent:{intent:'set_session_order',sessionOrder:1,weekday:2,timeSlot:0,timeMinute:0,classGroup:''},
    subjectAccess:{resolve(label){return label==='학생A'?{studentId,division:'elementary'}:null;}},
    studentLabel:'학생A',
    currentDate:'2026-10-02',requestId:'order-choice',replyToMessageId:84,
    allowChoice:true,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.code,'target_choice_required');
  assert.equal(result.choiceKey,'enrollmentId');
  assert.deepEqual(result.choices,[
    {id:'e1',label:'화요일 4시 A반'},
    {id:'e2',label:'화요일 5시 B반'}
  ]);
  assert.match(result.message,/선택해 주세요/);
  assert.equal(calls.some(item=>item.name==='olli_team_chat_send_action'),false);
});

test('selected session-order enrollment id is re-read before pending confirmation',async()=>{
  const calls=[];
  const studentId='44444444-4444-4444-8444-444444444444';
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week'){
      return {
        ok:true,timetable_mode:'hourly',
        enrollments:[
          {id:'e1',student_id:studentId,student_name:'민지',division:'elementary',weekday:2,time_slot:4,class_group:'A',session_order:2,effective_from:'2026-01-01'},
          {id:'e2',student_id:studentId,student_name:'민지',division:'elementary',weekday:2,time_slot:5,class_group:'B',session_order:2,effective_from:'2026-01-01'},
        ]
      };
    }
    if(name==='olli_team_chat_send_action') return sendActionResult('set_session_order');
    throw new Error('unexpected RPC '+name);
  };
  const result=await prepareTimetableAdminAction({
    requestContext:requestContext(),
    intent:{intent:'set_session_order',sessionOrder:1,weekday:2,timeSlot:0,timeMinute:0,classGroup:''},
    subjectAccess:{resolve(label){return label==='학생A'?{studentId,division:'elementary'}:null;}},
    studentLabel:'학생A',
    currentDate:'2026-10-02',requestId:'order-choice-selected',replyToMessageId:85,
    selectedEnrollmentId:'e2',allowChoice:true,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.action_type,'set_session_order');
  const action=calls.find(item=>item.name==='olli_team_chat_send_action');
  assert.ok(action);
  assert.equal(action.params.p_action_payload.enrollmentId,'e2');
  assert.equal(action.params.p_action_payload.timeSlot,5);
  assert.equal(action.params.p_action_payload.classGroup,'B');
  noMutationCalls(calls);
});
