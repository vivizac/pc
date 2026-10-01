const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  normalizeAbsenceReason,
  stableAbsenceActionClientMessageId,
  prepareAbsenceAction,
}=require('../api/_lib/olli-agent/tools/absence-prepare-tools.cjs');
const {
  resolveAbsencePrepareScope,
}=require('../api/_lib/olli-agent/runtime.cjs');
const {
  prepareAbsencePrivacyInput,
}=require('../api/_lib/olli-agent/privacy.cjs');

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
    status:'active',
    effective_from:'2026-09-01',
    effective_to:null,
  },overrides);
}
function baseRpc({enrollments,timetableMode='half_hour'}={}){
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
        week_start:params.p_week_start,
        timetable_mode:timetableMode,
        enrollments:enrollments||[enrollment()],
      };
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'결석 처리할까요?',
          action:{id:'action-1',action_type:'mark_absent',status:'pending'}
        }
      };
    }
    throw new Error('unexpected RPC: '+name);
  };
  return {rpc,calls};
}

test('absence privacy removes inline reason before model-safe input',async()=>{
  const prepared=await prepareAbsencePrivacyInput(
    '박하늘 오늘 결석 처리해줘, 사유: 감기',
    '감기',
    requestContext(),
    {
      resolveStudentReferences:undefined
    }
  ).catch(()=>null);
  assert.equal(prepared,null);
});

test('absence reason normalization keeps content but rejects generic commands',()=>{
  assert.equal(normalizeAbsenceReason('사유: 감기'),'감기');
  assert.equal(normalizeAbsenceReason('가족여행.'),'가족여행');
  assert.throws(
    ()=>normalizeAbsenceReason('결석'),
    e=>e?.code==='OLLI_AGENT_ABSENCE_REASON_REQUIRED'
  );
});

test('absence prepare defaults omitted date to today, resolves half-hour class, and stores only pending action',async()=>{
  const {rpc,calls}=baseRpc();
  const result=await prepareAbsenceAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sessionDate:'',
    classHour:4,
    classMinute:30,
    classGroup:'AUTO',
    reason:'감기',
    currentDate:'2026-10-02',
    requestId:'absence-1',
    replyToMessageId:88,
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'mark_absent');
  assert.equal(result.session_date,'2026-10-02');
  assert.equal(result.time_label,'4시 30분');
  assert.equal(result.class_group,'A');

  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_type,'mark_absent');
  assert.equal(action.params.p_reply_to_message_id,88);
  assert.equal(action.params.p_action_payload.studentId,'33333333-3333-4333-8333-333333333333');
  assert.equal(action.params.p_action_payload.studentName,'실제학생');
  assert.equal(action.params.p_action_payload.sessionDate,'2026-10-02');
  assert.equal(action.params.p_action_payload.timeSlot,10);
  assert.equal(action.params.p_action_payload.classGroup,'A');
  assert.equal(action.params.p_action_payload.reason,'감기');
  assert.ok(!calls.some(c=>/attendance|save_cell_memo|action_execute/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/실제학생|33333333|감기|studentId|timeSlot/);
});

test('absence prepare refuses to guess when more than one regular class remains',async()=>{
  const {rpc,calls}=baseRpc({
    enrollments:[
      enrollment({time_slot:4}),
      enrollment({id:'55555555-5555-4555-8555-555555555555',time_slot:5}),
    ],
    timetableMode:'hourly',
  });
  await assert.rejects(
    prepareAbsenceAction({
      requestContext:requestContext(),
      subjectAccess:subjectAccess(),
      studentLabel:'학생A',
      division:'elementary',
      sessionDate:'2026-10-02',
      classHour:0,
      classMinute:0,
      classGroup:'AUTO',
      reason:'가족행사',
      currentDate:'2026-10-01',
      requestId:'absence-many',
      sanitizePayload:p=>p,
      callRpc:rpc,
    }),
    e=>e?.code==='OLLI_AGENT_ABSENCE_SESSION_AMBIGUOUS'
  );
  assert.ok(!calls.some(c=>c.name==='olli_team_chat_send_action'));
});

test('absence prepare resolves explicit time and class group only against active enrollment',async()=>{
  const {rpc,calls}=baseRpc({
    enrollments:[
      enrollment({time_slot:4,class_group:'A'}),
      enrollment({id:'55555555-5555-4555-8555-555555555555',time_slot:4,class_group:'B'}),
    ],
    timetableMode:'hourly',
  });
  await prepareAbsenceAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sessionDate:'2026-10-02',
    classHour:4,
    classMinute:0,
    classGroup:'B',
    reason:'병원',
    currentDate:'2026-10-01',
    requestId:'absence-b',
    sanitizePayload:p=>p,
    callRpc:rpc,
  });
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.classGroup,'B');
});

test('absence scope accepts only a single registered-student absence command',()=>{
  const prepared={
    needsDisambiguation:false,
    subjectRefs:[{label:'학생A'}],
    subjectAccess:subjectAccess(),
    safeText:'학생A 오늘 4시 30분 결석 처리해줘',
  };
  const scope=resolveAbsencePrepareScope(prepared);
  assert.equal(scope.subjectLabel,'학생A');
  assert.equal(scope.division,'elementary');
  assert.equal(scope.classGroup,'AUTO');

  assert.throws(
    ()=>resolveAbsencePrepareScope({...prepared,safeText:'학생A 보강 취소해줘'}),
    e=>e?.code==='OLLI_AGENT_ABSENCE_INTENT_REQUIRED'
  );
});

test('absence retry key is deterministic across duplicate requests',()=>{
  const input={academyId:'a',memberId:'m',requestId:'team-chat-absence:10:11'};
  assert.equal(stableAbsenceActionClientMessageId(input),stableAbsenceActionClientMessageId(input));
  assert.notEqual(
    stableAbsenceActionClientMessageId(input),
    stableAbsenceActionClientMessageId({...input,requestId:'team-chat-absence:10:12'})
  );
});

test('absence model tool schema contains no reason, real name, or internal ids',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/absence-prepare-tools.cjs'),'utf8');
  const start=source.indexOf('parameters:z.object({');
  const end=source.indexOf('}),\n    async execute',start);
  const schema=source.slice(start,end);
  assert.match(schema,/session_date/);
  assert.match(schema,/class_hour/);
  assert.match(schema,/class_minute/);
  assert.doesNotMatch(schema,/reason|studentId|studentName|timeSlot|academyId|memberId|division|classGroup/);
});
