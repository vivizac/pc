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

test('PC keeps its existing composer flow while Mobile opens a dedicated inline reason input',()=>{
  assert.match(pc,/byId\('olliPcTeamTalkInput'\)/);
  assert.match(pc,/input\.focus/);
  assert.match(mobile,/function openOlliTalkPendingReasonInput/);
  assert.match(mobile,/className='olliTalkBetaPendingReasonForm'/);
  assert.match(mobile,/className='olliTalkBetaPendingReasonField'/);
  assert.match(mobile,/placeholder='취소 사유를 입력하세요'/);
  assert.doesNotMatch(mobile,/function focusOlliTalkPendingTextInput/);
});

test('Mobile inline reason submit saves the reason message and routes directly through pending rule state',()=>{
  assert.match(mobile,/function resolveOlliTalkPendingReasonDirectTurn/);
  assert.match(mobile,/function submitOlliTalkPendingReasonText/);
  assert.match(mobile,/p_body:reason/);
  assert.match(mobile,/resolveOlliTalkPendingReasonDirectTurn\([\s\S]{0,180}Number\(payload\.message\.id/);
  assert.match(mobile,/__structuredMakeupCancel/);
  assert.match(mobile,/__structuredTrialCancel/);
  assert.match(mobile,/saveOlliTalkActionReply\(context,confirmation,command,replyToMessageId\)/);
  assert.doesNotMatch(mobile,/input\.value='사유 없음'/);
});

test('reason-required paths use the shared pending text-input reply helper',()=>{
  assert.match(pc,/action_needs_reason[\s\S]{0,500}savePendingTextInputReply/);
  assert.match(mobile,/action_needs_reason[\s\S]{0,500}saveOlliTalkPendingTextInputReply/);
  assert.match(pcCss,/olliPcTeamTalkPendingInputButton/);
  assert.match(mobileCss,/olliTalkBetaPendingInputButton/);
  assert.match(mobileCss,/olliTalkBetaPendingReasonForm/);
  assert.match(mobileCss,/olliTalkBetaPendingReasonField/);
  assert.match(mobileCss,/olliTalkBetaPendingReasonSubmit/);
});
