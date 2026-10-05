'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const {prepareMakeupCancelAction}=require(
  path.join(root,'apps/mobile/api/_lib/olli-agent/tools/makeup-cancel-prepare-tools.cjs')
);

const runtimeSource=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const apiSource=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
const pcSource=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobileSource=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261004130000_team_chat_structured_waitlist_update_choices.sql'),
  'utf8'
);

function row(id,date,timeSlot,group='A'){
  return {
    id,
    student_id:'student-1',
    session_type:'makeup',
    status:'scheduled',
    session_date:date,
    time_slot:timeSlot,
    class_group:group,
    division:'elementary'
  };
}

function options(callRpc,extra={}){
  return Object.assign({
    requestContext:{sessionToken:'session',academyId:'academy',memberId:'member'},
    subjectAccess:{resolve(label){
      return label==='학생A' ? {studentId:'student-1',division:'elementary'} : null;
    }},
    studentLabel:'학생A',
    division:'elementary',
    reason:'감기',
    currentDate:'2026-10-04',
    requestId:'makeup-cancel-choice-test',
    sanitizePayload(payload){return payload;},
    callRpc,
  },extra);
}

function rpcWithRows(rows,calls){
  return async(name,args)=>{
    calls.push({name,args});
    if(name==='olli_student_data_access'){
      return {
        ok:true,
        rows:[{
          id:'student-1',
          name:'민서',
          division:'elementary',
          status:'active',
          is_deleted:false
        }]
      };
    }
    if(name==='olli_schedule_week'){
      return {ok:true,timetable_mode:'hourly',one_time_sessions:rows};
    }
    if(name==='olli_team_chat_send_action'){
      return {
        ok:true,
        message:{
          id:901,
          body:'pending',
          action:{id:'action-1',action_type:'cancel_makeup',status:'pending'}
        }
      };
    }
    throw new Error('unexpected rpc '+name);
  };
}

test('structured makeup cancel ambiguity returns finite existing-session choices without mutation',async()=>{
  const calls=[];
  const result=await prepareMakeupCancelAction(options(
    rpcWithRows([
      row('session-1','2026-10-05',4,'A'),
      row('session-2','2026-10-06',5,'B')
    ],calls),
    {allowChoice:true}
  ));

  assert.equal(result.ok,false);
  assert.equal(result.code,'target_choice_required');
  assert.equal(result.field,'target_choice');
  assert.equal(result.choiceKey,'oneTimeSessionId');
  assert.deepEqual(result.choices.map(item=>item.id),['session-1','session-2']);
  assert.match(result.choices[0].label,/10월 5일/);
  assert.match(result.choices[1].label,/10월 6일/);
  assert.match(result.message,/선택해 주세요/);
  assert.equal(calls.some(item=>item.name==='olli_team_chat_send_action'),false);
});

test('selected makeup session id is re-read by the server SOT before pending confirmation',async()=>{
  const calls=[];
  const result=await prepareMakeupCancelAction(options(
    rpcWithRows([
      row('session-1','2026-10-05',4,'A'),
      row('session-2','2026-10-06',5,'B')
    ],calls),
    {
      oneTimeSessionId:'session-2',
      allowChoice:true,
      replyToMessageId:88
    }
  ));

  assert.equal(result.ok,true);
  assert.equal(result.action_type,'cancel_makeup');
  const send=calls.find(item=>item.name==='olli_team_chat_send_action');
  assert.ok(send);
  assert.equal(send.args.p_action_payload.oneTimeSessionId,'session-2');
  assert.equal(send.args.p_action_payload.reason,'감기');
  assert.equal(send.args.p_reply_to_message_id,88);
});

test('structured makeup cancel bridge resumes target choice with original source and stored reason binding',()=>{
  assert.match(runtimeSource,/oneTimeSessionId:[^\n]*command\.oneTimeSessionId/);
  assert.match(runtimeSource,/allowChoice:true/);
  assert.match(runtimeSource,/reasonMessageId:reasonId/);
  assert.match(apiSource,/choiceRequired:result\?\.choiceRequired \|\| null/);

  const pcResolver=pcSource.slice(
    pcSource.indexOf('async function resolveStructuredMakeupCancelTurn'),
    pcSource.indexOf('async function resolveMakeupCancelAgentTurn')
  );
  const mobileResolver=mobileSource.slice(
    mobileSource.indexOf('async function resolveOlliTalkStructuredMakeupCancelTurn'),
    mobileSource.indexOf('async function resolveOlliTalkMakeupCancelAgentTurn')
  );
  assert.match(pcResolver,/saveStructuredTargetChoice/);
  assert.match(mobileResolver,/saveOlliTalkStructuredTargetChoice/);

  const pcTarget=pcSource.slice(
    pcSource.indexOf('async function handleStructuredTargetChoice'),
    pcSource.indexOf('async function populateStructuredTargetChoiceCard')
  );
  const mobileTarget=mobileSource.slice(
    mobileSource.indexOf('async function handleOlliTalkStructuredTargetChoice'),
    mobileSource.indexOf('async function populateOlliTalkStructuredTargetChoiceCard')
  );
  for(const source of [pcTarget,mobileTarget]){
    assert.match(source,/cancel_makeup/);
    assert.match(source,/reason_message_id/);
    assert.match(source,/reason_message_text/);
    assert.match(source,/source_message_id/);
    assert.match(source,/source_message_text/);
  }
});

test('target-choice SQL stores only the selected makeup session id and rebinds source/reason messages',()=>{
  assert.match(migration,/'cancel_makeup'/);
  assert.match(migration,/'oneTimeSessionId'/);
  assert.match(migration,/reasonMessageId/);
  assert.match(migration,/reason_message_id/);
  assert.match(migration,/reason_message_text/);
  assert.match(migration,/sender_member_id=v_member_id/);

  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
  assert.doesNotMatch(migration,/update\s+public\.olli_schedule_one_time/i);
  assert.doesNotMatch(migration,/delete\s+from\s+public\.olli_schedule_one_time/i);
});
