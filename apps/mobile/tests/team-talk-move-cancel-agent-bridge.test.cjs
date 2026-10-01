const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile move cancel gate uses only shared cancellation parser',()=>{
  const start=talk.indexOf('function isOlliTalkMoveCancelAgentCandidate');
  const end=talk.indexOf('async function resolveOlliTalkTrialAddAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseMoveCancelMutationIntent\(commandText\)/);
  assert.match(block,/==='cancel_move'/);
  assert.doesNotMatch(block,/parseScheduleMoveMutationIntent|prepareAction|move_class/);
});

test('mobile move cancel routes before student info and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const move=block.indexOf('if(isOlliTalkMoveCancelAgentCandidate(commandText,router))');
  const studentInfo=block.indexOf('const studentInfo=resolveOlliTalkStudentInfoCommand(commandText)');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(move>=0);
  assert.ok(studentInfo>move);
  assert.ok(legacy>studentInfo);
  assert.match(block,/return resolveOlliTalkMoveCancelAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile move cancel bridge uses source-bound production without second action save',()=>{
  const start=talk.indexOf('async function resolveOlliTalkMoveCancelAgentTurn');
  const end=talk.indexOf('function isOlliTalkPendingReasonCancel',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'move_cancel_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='cancel_move'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from move cancel Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkMoveCancelAgentTurn|isOlliTalkMoveCancelAgentCandidate|move_cancel_prepare/);
});
