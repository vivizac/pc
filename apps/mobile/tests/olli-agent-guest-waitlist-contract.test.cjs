const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  prepareWaitlistGuestPrivacyInput,
}=require('../api/_lib/olli-agent/waitlist-guest-privacy.cjs');
const {
  prepareWaitlistCancelAction,
}=require('../api/_lib/olli-agent/tools/waitlist-cancel-prepare-tools.cjs');

function requestContext(){
  return {
    sessionToken:'server-session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}
function guestAccess(division='',guestName='비재원민지'){
  return {resolve(label){return label==='학생A'?{guestName,division,isGuest:true}:null;}};
}

test('guest waitlist privacy replaces the real guest name before model egress',()=>{
  const prepared=prepareWaitlistGuestPrivacyInput('비재원민지 초등부 토요일 1시 대기 등록해줘');
  assert.equal(prepared.subjectRefs.length,1);
  assert.equal(prepared.subjectRefs[0].label,'학생A');
  assert.doesNotMatch(prepared.safeText,/비재원민지/);
  assert.match(prepared.safeText,/학생A/);
  assert.equal(prepared.waitlistGuestAccess.resolve('학생A').guestName,'비재원민지');
});

test('guest waitlist cancel resolves current row and stores only a pending cancel card',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});
    if(name==='olli_schedule_week'){
      return {
        ok:true,
        timetable_mode:'half_hour',
        waitlist:[{
          id:'44444444-4444-4444-8444-444444444444',
          student_id:null,
          student_name:'비재원민지',
          guest_name:'비재원민지',
          guest_division:'elementary',
          target_division:'elementary',
          is_guest:true,
          target_weekday:6,
          target_time_slot:1,
          target_class_group:'A',
          desired_effective_date:'2026-10-03',
          status:'waiting',
        }]
      };
    }
    if(name==='olli_team_chat_send_action'){
      return {ok:true,message:{id:901,body:'대기를 취소할까요?',action:{id:'action-1',action_type:'cancel_waitlist',status:'pending'}}};
    }
    throw new Error('unexpected RPC: '+name);
  };

  const result=await prepareWaitlistCancelAction({
    requestContext:requestContext(),
    subjectAccess:{resolve(){return null;}},
    guestAccess:guestAccess('', '비재원민지'),
    studentLabel:'학생A',
    division:'',
    waitlistDate:'2026-10-03',
    classHour:1,
    classMinute:0,
    classGroup:'A',
    currentDate:'2026-10-01',
    requestId:'guest-cancel',
    sanitizePayload:p=>p,
    callRpc:rpc,
  });

  assert.equal(result.action_type,'cancel_waitlist');
  const action=calls.find(c=>c.name==='olli_team_chat_send_action');
  assert.equal(action.params.p_action_payload.studentId,'');
  assert.equal(action.params.p_action_payload.guestName,'비재원민지');
  assert.equal(action.params.p_action_payload.isGuest,true);
  assert.equal(action.params.p_action_payload.division,'elementary');
  assert.ok(!calls.some(c=>c.name==='olli_student_data_access'));
  assert.ok(!calls.some(c=>/resolve_waitlist|action_execute/.test(c.name)));
  assert.doesNotMatch(JSON.stringify(result),/비재원민지|44444444/);
});

test('waitlist endpoint falls back to guest privacy, not legacy routing',()=>{
  const endpoint=fs.readFileSync(path.join(__dirname,'../api/olli-agent.js'),'utf8');
  const pc=fs.readFileSync(path.join(__dirname,'../../pc/pc-team-talk.js'),'utf8');
  const mobile=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');
  assert.match(endpoint,/prepareWaitlistGuestPrivacyInput/);
  assert.match(endpoint,/waitlistGuestAccess/);
  assert.doesNotMatch(pc,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED/);
  assert.doesNotMatch(mobile,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED/);
});

test('guest waitlist add update cancel tools all accept guestAccess',()=>{
  for(const file of [
    'waitlist-add-prepare-tools.cjs',
    'waitlist-update-prepare-tools.cjs',
    'waitlist-cancel-prepare-tools.cjs',
  ]){
    const source=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools',file),'utf8');
    assert.match(source,/guestAccess/);
    assert.match(source,/isGuest/);
    assert.match(source,/guestName/);
  }
});
