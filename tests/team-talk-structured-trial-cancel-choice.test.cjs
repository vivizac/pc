'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const api=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261004130000_team_chat_structured_waitlist_update_choices.sql'),'utf8');
test('structured trial cancel target selection remains source and reason bound',()=>{
 const rr=runtime.slice(runtime.indexOf('async function runStructuredTrialCancelPrepare'),runtime.indexOf('function structuredTrialUpdateDateKey'));
 assert.match(rr,/allowChoice:true/); assert.match(rr,/reasonMessageId:reasonId/); assert.match(rr,/targetIntent:'cancel_trial'/);
 const ar=api.slice(api.indexOf("if (mode === 'structured_trial_cancel_prepare')"),api.indexOf("if (mode === 'structured_trial_update_prepare')"));
 assert.match(ar,/choiceRequired:result\?\.choiceRequired \|\| null/);
 for(const [src,resume] of [[pc,'resolveStructuredTrialCancelTurn'],[mobile,'resolveOlliTalkStructuredTrialCancelTurn']]){
  const target=src.slice(src.indexOf('async function handle'+(src===mobile?'OlliTalk':'')+'StructuredTargetChoice'),src.indexOf('async function populate'+(src===mobile?'OlliTalk':'')+'StructuredTargetChoiceCard'));
  assert.match(target,/cancel_trial/); assert.match(target,/source_message_id/); assert.match(target,/reason_message_id/); assert.match(target,new RegExp(resume));
 }
});
test('target-choice SQL supports trial cancel without schedule mutation',()=>{
 assert.match(sql,/'cancel_trial'/); assert.match(sql,/'oneTimeSessionId'/); assert.match(sql,/reasonMessageId/); assert.match(sql,/sender_member_id=v_member_id/);
 assert.doesNotMatch(sql,/olli_team_chat_action_execute\s*\(/);
 assert.doesNotMatch(sql,/update\s+public\.olli_schedule_one_time/i);
});
