const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  resolveAttendanceDateSpec,
  prepareAttendanceStatusAction,
}=require('../api/_lib/olli-agent/tools/attendance-status-prepare-tools.cjs');

function requestContext(){
  return {
    sessionToken:'session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}
const studentId='33333333-3333-4333-8333-333333333333';
function subjectAccess(){
  return {resolve(label){return label==='학생A'?{studentId,division:'elementary'}:null;}};
}
function sendResult(){
  return {ok:true,message:{id:901,body:'확인할까요?',action:{id:'a1',action_type:'set_attendance_status',status:'pending'}}};
}

test('regular attendance change only stores a pending action after reading current schedule and register',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week') return {
      ok:true,timetable_mode:'hourly',
      enrollments:[{student_id:studentId,student_name:'민수',weekday:5,time_slot:5,class_group:'A',status:'active',effective_from:'2026-01-01'}],
      one_time_sessions:[]
    };
    if(name==='olli_schedule_attendance_month') return {ok:true,attendance:[]};
    if(name==='olli_team_chat_send_action') return sendResult();
    throw new Error('unexpected RPC '+name);
  };
  const result=await prepareAttendanceStatusAction({
    requestContext:requestContext(),
    intent:{intent:'set_attendance_status',status:'present',sessionKind:'regular',dateSpec:{mode:'today'},classHour:5,classMinute:0,classGroup:'A'},
    subjectAccess:subjectAccess(),studentLabel:'학생A',currentDate:'2026-10-02',
    requestId:'attendance-1',replyToMessageId:77,sanitizePayload:p=>p,callRpc:rpc,
  });
  assert.equal(result.action_type,'set_attendance_status');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.studentId,studentId);
  assert.equal(action.params.p_action_payload.sessionDate,'2026-10-02');
  assert.equal(action.params.p_action_payload.sessionKind,'regular');
  assert.equal(action.params.p_action_payload.timeSlot,5);
  assert.equal(action.params.p_action_payload.classGroup,'A');
  assert.equal(action.params.p_action_payload.status,'present');
  assert.equal(calls.some(c=>c.name==='olli_schedule_set_attendance_session_status_v2'),false);
  assert.equal(calls.some(c=>c.name==='olli_schedule_execute'),false);
  assert.doesNotMatch(JSON.stringify(result),/민수|33333333/);
});

test('blank state refuses to guess when regular and makeup sessions both exist',async()=>{
  const rpc=async(name)=>{
    if(name==='olli_schedule_week') return {
      ok:true,timetable_mode:'hourly',
      enrollments:[{student_id:studentId,student_name:'민수',weekday:5,time_slot:5,class_group:'A',status:'active',effective_from:'2026-01-01'}],
      one_time_sessions:[{student_id:studentId,student_name:'민수',session_date:'2026-10-02',time_slot:4,class_group:'A',status:'active'}]
    };
    throw new Error('unexpected RPC '+name);
  };
  await assert.rejects(
    prepareAttendanceStatusAction({
      requestContext:requestContext(),
      intent:{intent:'set_attendance_status',status:'blank',sessionKind:'AUTO',dateSpec:{mode:'today'},classHour:0,classMinute:0,classGroup:''},
      subjectAccess:subjectAccess(),studentLabel:'학생A',currentDate:'2026-10-02',
      requestId:'attendance-2',replyToMessageId:78,sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_ATTENDANCE_STATUS_SESSION_AMBIGUOUS'
  );
});

test('half-hour visible time resolves through existing timetable slot mapping',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week') return {
      ok:true,timetable_mode:'half_hour',
      enrollments:[{student_id:studentId,student_name:'민수',weekday:5,time_slot:10,class_group:'A',status:'active',effective_from:'2026-01-01'}],
      one_time_sessions:[]
    };
    if(name==='olli_schedule_attendance_month') return {ok:true,attendance:[]};
    if(name==='olli_team_chat_send_action') return sendResult();
    throw new Error('unexpected RPC '+name);
  };
  await prepareAttendanceStatusAction({
    requestContext:requestContext(),
    intent:{intent:'set_attendance_status',status:'absent',sessionKind:'regular',dateSpec:{mode:'today'},classHour:4,classMinute:30,classGroup:''},
    subjectAccess:subjectAccess(),studentLabel:'학생A',currentDate:'2026-10-02',
    requestId:'attendance-3',replyToMessageId:79,sanitizePayload:p=>p,callRpc:rpc,
  });
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.timeSlot,10);
  assert.equal(action.params.p_action_payload.status,'absent');
});

test('makeup status targets only an existing makeup session',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week') return {
      ok:true,timetable_mode:'hourly',enrollments:[],
      one_time_sessions:[{student_id:studentId,student_name:'민수',session_date:'2026-10-02',time_slot:4,class_group:'B',status:'active'}]
    };
    if(name==='olli_schedule_attendance_month') return {ok:true,attendance:[]};
    if(name==='olli_team_chat_send_action') return sendResult();
    throw new Error('unexpected RPC '+name);
  };
  await prepareAttendanceStatusAction({
    requestContext:requestContext(),
    intent:{intent:'set_attendance_status',status:'makeup',sessionKind:'makeup',dateSpec:{mode:'today'},classHour:4,classMinute:0,classGroup:'B'},
    subjectAccess:subjectAccess(),studentLabel:'학생A',currentDate:'2026-10-02',
    requestId:'attendance-4',replyToMessageId:80,sanitizePayload:p=>p,callRpc:rpc,
  });
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.sessionKind,'makeup');
  assert.equal(action.params.p_action_payload.classGroup,'B');
  assert.equal(action.params.p_action_payload.status,'makeup');
});

test('unchanged status is rejected before a confirmation card is saved',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week') return {
      ok:true,timetable_mode:'hourly',
      enrollments:[{student_id:studentId,student_name:'민수',weekday:5,time_slot:5,class_group:'A',status:'active',effective_from:'2026-01-01'}],
      one_time_sessions:[]
    };
    if(name==='olli_schedule_attendance_month') return {ok:true,attendance:[{
      student_id:studentId,session_date:'2026-10-02',session_kind:'register_override',
      register_session_kind:'regular',register_status:'present',time_slot:5,class_group:'A',marked_at:'2026-10-02T01:00:00Z'
    }]};
    throw new Error('unexpected RPC '+name);
  };
  await assert.rejects(
    prepareAttendanceStatusAction({
      requestContext:requestContext(),
      intent:{intent:'set_attendance_status',status:'present',sessionKind:'regular',dateSpec:{mode:'today'},classHour:5,classMinute:0,classGroup:'A'},
      subjectAccess:subjectAccess(),studentLabel:'학생A',currentDate:'2026-10-02',
      requestId:'attendance-5',replyToMessageId:81,sanitizePayload:p=>p,callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_ATTENDANCE_STATUS_UNCHANGED'
  );
  assert.equal(calls.some(c=>c.name==='olli_team_chat_send_action'),false);
});

test('Agent tool schema is zero-argument and prepare source contains no direct attendance mutation call',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/attendance-status-prepare-tools.cjs'),'utf8');
  const start=source.indexOf("name:'prepare_attendance_status'");
  const end=source.indexOf('async execute()',start);
  const schema=source.slice(start,end);
  assert.match(schema,/parameters:z\.object\(\{\}\)/);
  assert.doesNotMatch(schema,/studentId|timeSlot|academyId|memberId/);
  assert.equal(source.includes("callRpc('olli_schedule_set_attendance_session_status_v2'"),false);
  assert.equal(source.includes("callRpc('olli_schedule_execute'"),false);
});

test('explicit past month/day stays in the current year for historical attendance edits',()=>{
  assert.equal(
    resolveAttendanceDateSpec({mode:'month_day',month:9,day:20},'2026-10-02'),
    '2026-09-20'
  );
  assert.equal(
    resolveAttendanceDateSpec({mode:'day_of_month',day:20},'2026-10-02'),
    '2026-10-20'
  );
});
