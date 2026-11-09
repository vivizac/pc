const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
test('existing AI request context uses verified academy membership, not forged room/member/role',async()=>{
  const calls=[],module={exports:{}};
  const callSupabaseRpc=async(name,params)=>{
    calls.push({name,params});
    if(params.p_session_token!=='teacher-session'||params.p_academy_id!=='own-academy')throw new Error('membership denied');
    if(name==='olli_team_talk_settings_get')return {ok:true,ai_enabled:true};
    return {ok:true,current_member_id:'verified-member',members:[{is_current_member:true,display_name:'교사',role:'teacher'}]};
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/request-context.cjs'),'utf8'),{module,exports:module.exports,require:()=>({callSupabaseRpc})});
  const context=await module.exports.loadOlliAgentRequestContext({session_token:'teacher-session',academy_id:'own-academy',room_id:'shared-room',memberId:'forged-member',role:'owner'});
  assert.equal(context.memberId,'verified-member');assert.equal(context.memberRole,'teacher');assert.equal(context.academyId,'own-academy');assert.equal(context.roomId,undefined);
  await assert.rejects(module.exports.loadOlliAgentRequestContext({session_token:'teacher-session',academy_id:'other-academy',room_id:'shared-room'}),/membership denied/);
  assert.ok(calls.every(c=>!Object.keys(c.params).some(k=>/room|group/.test(k))));
});
test('shared RPC surface has no AI/action/payroll payload fields and never alters legacy visibility',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261109100845_team_chat_shared_rooms.sql'),'utf8');
  assert.doesNotMatch(sql,/create(?: or replace)? function (?:public|private)\.olli_team_chat_/i);
  assert.doesNotMatch(sql,/alter table public\.(?:students|olli_team_chat_messages|academy_members)/i);
  assert.match(sql,/message_type in \('text','system','file'\)/);
});
