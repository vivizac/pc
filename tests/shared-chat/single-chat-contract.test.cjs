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
    assert.match(html,/olli-shared-team-chat\.js\?v=20261110-single-conversation-1/);
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
  assert.match(pc,/unifiedExtension\?\.\(\{messages:true\}\)/);
  assert.match(mobile,/unifiedExtension\?\.\(\{messages:true\}\)/);
  assert.match(pc,/if \(!olliRequested && global\.OlliSharedTeamChat\?\.sendUnified\)/);
  assert.match(mobile,/if\(!olliRequested && window\.OlliSharedTeamChat\?\.sendUnified\)/);
  assert.match(pc,/rpc\('olli_team_chat_send'/);
  assert.match(mobile,/callOlliTalkRpc\('olli_team_chat_send'/);
  assert.match(service,/p_mention_all:mentionAll/);
});
test('shared records never enter persistent academy message cache',()=>{
  assert.match(mobile,/writeOlliTalkMessageCache\(context,mergedPayload\)/);
  assert.match(mobile,/__academyLocal:mergedPayload/);
  assert.match(mobile,/olliTalkCurrentPayload=payload\?\.__academyLocal \|\| payload \|\| null/);
  assert.match(service,/function key\(ctx\)/);
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
