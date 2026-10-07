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

test('PC and Mobile open dedicated inline reason inputs inside the Olli action card',()=>{
  assert.match(pc,/function openPendingReasonInput/);
  assert.match(pc,/className='olliPcTeamTalkPendingReasonForm'/);
  assert.match(pc,/className='olliPcTeamTalkPendingReasonField'/);
  assert.match(pc,/placeholder='취소 사유를 입력하세요'/);
  assert.match(mobile,/function openOlliTalkPendingReasonInput/);
  assert.match(mobile,/className='olliTalkBetaPendingReasonForm'/);
  assert.match(mobile,/className='olliTalkBetaPendingReasonField'/);
  assert.match(mobile,/placeholder='취소 사유를 입력하세요'/);
});

test('Mobile inline reason submit persists a reason choice without creating a user chat message or AI reparse',()=>{
  assert.match(mobile,/function resolveOlliTalkPendingReasonDirectTurn/);
  assert.match(mobile,/function submitOlliTalkPendingReasonText/);
  const start=mobile.indexOf('async function submitOlliTalkPendingReasonText');
  const end=mobile.indexOf('function openOlliTalkPendingReasonInput',start);
  const submit=mobile.slice(start,end);
  assert.match(submit,/olli_team_chat_action_select_reason/);
  assert.match(submit,/p_reason:reason/);
  assert.doesNotMatch(submit,/olli_team_chat_send['"]/);
  assert.doesNotMatch(submit,/resolveOlliTalkAiTurn/);
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
