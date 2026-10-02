'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  normalizeGroup,
  optionalTimeLabel,
  stableMakeupUpdateActionClientMessageId,
  prepareMakeupUpdateAction,
}=require('../api/_lib/olli-agent/tools/makeup-update-prepare-tools.cjs');

function requestContext(){
  return {
    sessionToken:'server-session-secret',
    academyId:'11111111-1111-4111-8111-111111111111',
    memberId:'22222222-2222-4222-8222-222222222222',
  };
}

function subjectAccess(){
  return {
    resolve(label){
      return label==='학생A'
        ? {studentId:'33333333-3333-4333-8333-333333333333',division:'elementary'}
        : null;
    },
  };
}

function sourceRow(){
  return {
    id:'44444444-4444-4444-8444-444444444444',
    student_id:'33333333-3333-4333-8333-333333333333',
    session_date:'2026-10-02',
    time_slot:10,
    class_group:'A',
    session_type:'makeup',
    status:'active',
  };
}

test('makeup update helper validation stays deterministic',()=>{
  assert.equal(normalizeGroup('b'),'B');
  assert.equal(optionalTimeLabel(4,30),'4시 30분');
  assert.equal(optionalTimeLabel(0,0),'');
  assert.throws(()=>normalizeGroup('C'),e=>e?.code==='OLLI_AGENT_MAKEUP_UPDATE_GROUP_INVALID');

  const input={academyId:'a',memberId:'m',requestId:'team-chat-message:77'};
  assert.equal(
    stableMakeupUpdateActionClientMessageId(input),
    stableMakeupUpdateActionClientMessageId(input)
  );
  assert.notEqual(
    stableMakeupUpdateActionClientMessageId(input),
    stableMakeupUpdateActionClientMessageId({...input,requestId:'team-chat-message:78'})
  );
});

test('makeup update stores only a pending confirmation action',async()=>{
  const calls=[];
  const rpc=async(name,params)=>{
    calls.push({name,params});

    if(name==='olli_student_data_access'){
      return {
        ok:true,
        rows:[{
          id:'33333333-3333-4333-8333-333333333333',
          name:'실제학생',
          division:'elementary',
          status:'active',
          is_deleted:false,
        }],
      };
    }

    if(name==='olli_schedule_week'){
      return {
        ok:true,
        timetable_mode:'half_hour',
        one_time_sessions:[sourceRow()],
      };
    }

    if(name==='olli_schedule_availability_slots'){
      return {
        ok:true,
        timetable_mode:'half_hour',
        slots:[{
          date:'2026-10-02',
          weekday:5,
          time_slot:10,
          time_label:'4시 30분',
          class_group:'B',
          grouped:true,
          available:true,
          remaining:1,
        }],
        closed_dates:[],
      };
    }

    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'보강을 변경할까요?',
          action:{id:'action-1',action_type:'update_makeup',status:'pending'},
        },
      };
    }

    throw new Error('unexpected RPC: '+name);
  };

  const result=await prepareMakeupUpdateAction({
    requestContext:requestContext(),
    subjectAccess:subjectAccess(),
    studentLabel:'학생A',
    division:'elementary',
    sourceDate:'2026-10-02',
    sourceHour:4,
    sourceMinute:30,
    sourceGroup:'A',
    targetDate:'',
    targetHour:4,
    targetMinute:30,
    targetGroup:'B',
    currentDate:'2026-10-01',
    requestId:'team-chat-message:77',
    sanitizePayload:value=>value,
    callRpc:rpc,
  });

  assert.equal(result.ok,true);
  assert.equal(result.status,'pending');
  assert.equal(result.requires_confirmation,true);
  assert.equal(result.action_type,'update_makeup');
  assert.equal(result.source_class_group,'A');
  assert.equal(result.target_class_group,'B');

  const action=calls.find(call=>call.name==='olli_team_chat_send_action');
  assert.ok(action);
  assert.equal(action.params.p_action_type,'update_makeup');
  assert.equal(action.params.p_action_payload.oneTimeSessionId,'44444444-4444-4444-8444-444444444444');
  assert.equal(action.params.p_action_payload.targetClassGroup,'B');

  assert.equal(calls.some(call=>call.name==='olli_schedule_update_one_time_session'),false);
  assert.equal(calls.some(call=>call.name==='olli_team_chat_action_execute'),false);
  assert.doesNotMatch(JSON.stringify(result),/33333333|44444444|실제학생|oneTimeSessionId|studentId/);
});

test('makeup update tool source never calls mutation executor directly',()=>{
  const source=fs.readFileSync(
    path.join(__dirname,'../api/_lib/olli-agent/tools/makeup-update-prepare-tools.cjs'),
    'utf8'
  );
  assert.match(source,/olli_team_chat_send_action/);
  assert.match(source,/p_action_type:'update_makeup'/);
  assert.doesNotMatch(source,/callRpc\('olli_schedule_update_one_time_session'/);
  assert.doesNotMatch(source,/callRpc\('olli_team_chat_action_execute'/);
});
