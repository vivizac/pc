const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const pcHtml=read('apps/pc/index.html');
const mobileHtml=read('apps/mobile/index.html');
const pc=read('apps/pc/pc-team-talk.js');
const mobile=read('apps/mobile/olli-talk-beta.js');
const service=read('packages/common/olli-shared-team-chat.js');
const pcSettings=read('packages/common/olli-settings-team-talk-common.js');
const mobileSettings=read('apps/mobile/olli-settings-team-talk-phone.js');
test('one visible Team Chat: no second room entry or independent shared dialog',()=>{
  for(const html of [pcHtml,mobileHtml]){
    assert.doesNotMatch(html,/data-shared-chat-entry/);
    assert.match(html,/Team Chat/);
    assert.match(html,/olli-shared-team-chat\.js\?v=20261121-unified-indexeddb-1/);
  }
  assert.doesNotMatch(service,/createDialog\('공동 팀챗'\)/);
  assert.match(service,/async function open\(\)\{[\s\S]*OlliPcTeamTalk\?\.open/);
  assert.match(service,/async function unifiedExtension/);
});
test('settings management lives within both native settings pages',()=>{
  for(const src of [pcSettings,mobileSettings]){
    assert.match(src,/data-olli-shared-inline-settings/);
    assert.match(src,/mountTeamTalkInlineSettings/);
    assert.doesNotMatch(src,/onclick="OlliSharedTeamChat\.manage\(\)"/);
  }
  assert.match(service,/function mountSettings\(root\)/);
  assert.match(service,/p_expected_revision/);
});
test('shared normal messages join existing renderer, Olli AI stays on original academy RPC',()=>{
  assert.match(pc,/OlliSharedTeamChat\.unifiedExtension\(\{messages:true\}\)/);
  assert.match(mobile,/OlliSharedTeamChat\.unifiedExtension\(\{messages:true\}\)/);
  assert.match(pc,/if\(!olliRequested\)\{[\s\S]*throw new Error\('통합 팀챗 상태를 확인할 수 없어 메시지를 전송하지 않았습니다.'\)/);
  assert.match(mobile,/if\(!olliRequested && !pendingPrivateWorkflow\)\{[\s\S]*throw new Error\('통합 팀챗 상태를 확인할 수 없어 전송하지 않았습니다.'\)/);
  assert.match(mobile,/pendingPrivateWorkflow=hasOlliTalkPendingCommand\(\)/);
  assert.match(pc,/rpc\('olli_team_chat_send'/);
  assert.match(mobile,/callOlliTalkRpc\('olli_team_chat_send'/);
  assert.match(service,/p_mention_all:false/);
  assert.doesNotMatch(service,/p_mention_all:mentionAll/);
  assert.doesNotMatch(pc,/member_id:'all',display_name:'전체'/);
  assert.doesNotMatch(mobile,/member_id:'all',display_name:'전체'/);
});
test('coffee, material orders and Olli confirmations stay within originating academy',()=>{
  assert.match(pc,/privateMessages=.*payload\.messages/);
  assert.match(pc,/!item\?\.academy_id \|\| String\(item\.academy_id\)===String\(current\.academyId\)/);
  assert.match(mobile,/const privateOnly=messages=>/);
  assert.match(mobile,/!item\?\.academy_id \|\| String\(item\.academy_id\)===String\(context\.academyId\)/);
  assert.match(service,/!msg\?\.material_request_id\s*&&\s*!msg\?\.material_event_id\s*&&\s*!msg\?\.action/);
  const listSql=read('apps/mobile/supabase/migrations/20260920020408_add_team_chat_send_list_rpc.sql');
  assert.match(listSql,/where m\.academy_id\s*=\s*p_academy_id/);
});
test('shared records never enter persistent academy message cache',()=>{
  assert.match(mobile,/writeOlliTalkMessageCache\(context,mergedPayload\)/);
  assert.match(mobile,/__academyLocal:mergedPayload/);
  assert.match(mobile,/olliTalkCurrentPayload=payload\?\.__academyLocal \|\| payload \|\| null/);
  assert.match(service,/const key=ctx=>/);
  assert.match(service,/assertCurrent\(ctx\)/);
  assert.match(service,/p_room_id/);
});
test('shared attachments and branch labels use current membership',()=>{
  assert.match(pc,/attachment\.is_shared/);
  assert.match(mobile,/item\?\.attachment\?\.is_shared/);
  assert.match(pc,/olliPcTeamTalkBranchBadge/);
  assert.match(mobile,/olliTalkBetaBranchBadge/);
  assert.match(service,/function mountSettings\(root\)/);
  assert.match(service,/async function uploadUnified/);
  assert.match(service,/async function downloadUnified/);
});

test('verified unified room survives a temporary status failure on PC and phone',()=>{
  assert.match(pc,/const hasVerifiedView=state\.messageViewContextKey===contextKey/);
  assert.match(pc,/const \[payload,extension\]=await Promise\.all\(\[/);
  assert.match(pc,/if\(body&&!hasVerifiedView\)body\.replaceChildren/);
  assert.match(mobile,/const renderedLocal = !!olliTalkCurrentViewPayload/);
  assert.match(mobile,/const \[payload,extension\]=await Promise\.all\(\[/);
  assert.match(mobile,/if\(!renderedLocal&&chatArea\)/);
  assert.doesNotMatch(mobile,/renderOlliTalkServerMessages\(basePayload/);
  assert.match(pc,/const shared=await global\.OlliSharedTeamChat\.archiveUnified\(\{limit:1000\}\)/);
  assert.match(mobile,/const joined=await window\.OlliSharedTeamChat\.archiveUnified\(\{limit:1000\}\)/);
  assert.match(service,/const sharedStatusInflight=new Map\(\)/);
});
