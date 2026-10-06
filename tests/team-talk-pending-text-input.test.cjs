'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const pcCss=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.css'),'utf8');
const mobileCss=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');

test('reason prompts render no-reason and direct-input buttons on both PC and Mobile',()=>{
  assert.match(pc,/pendingTextInputMessageId/);
  assert.match(pc,/savePendingTextInputReply/);
  assert.match(pc,/makePendingTextInputButton/);
  assert.match(pc,/noReason\.textContent='사유 없음'/);
  assert.match(pc,/inputButton\.textContent='사유 입력'/);
  assert.match(mobile,/olliTalkPendingTextInputMessageId/);
  assert.match(mobile,/saveOlliTalkPendingTextInputReply/);
  assert.match(mobile,/createOlliTalkPendingTextInputButton/);
  assert.match(mobile,/noReason\.textContent='사유 없음'/);
  assert.match(mobile,/inputButton\.textContent='사유 입력'/);
});

test('input buttons focus the existing Team Chat composer instead of creating a second input surface',()=>{
  assert.match(pc,/byId\('olliPcTeamTalkInput'\)/);
  assert.match(mobile,/getOlliTalkBetaInput\(\)/);
  assert.match(pc,/input\.focus/);
  assert.match(mobile,/input\.focus/);
  assert.doesNotMatch(pc,/PendingInput[\s\S]{0,500}createElement\('textarea'\)/);
  assert.doesNotMatch(mobile,/PendingTextInput[\s\S]{0,700}createElement\('textarea'\)/);
});

test('reason-required paths use the shared pending text-input reply helper',()=>{
  assert.match(pc,/action_needs_reason[\s\S]{0,500}savePendingTextInputReply/);
  assert.match(mobile,/action_needs_reason[\s\S]{0,500}saveOlliTalkPendingTextInputReply/);
  assert.match(pcCss,/olliPcTeamTalkPendingInputButton/);
  assert.match(mobileCss,/olliTalkBetaPendingInputButton/);
});
