const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile move gate uses only shared move parser',()=>{
  const start=talk.indexOf('function isOlliTalkMoveAgentCandidate');
  const end=talk.indexOf('function isOlliTalkMoveCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseScheduleMoveMutationIntent\(commandText\)/);
  assert.match(block,/==='move_class'/);
  assert.doesNotMatch(block,/parseMoveCancelMutationIntent|prepareAction|cancel_move/);
});

test('mobile move routes before move cancel and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const move=block.indexOf('if(isOlliTalkMoveAgentCandidate(commandText,router))');
  const cancel=block.indexOf('if(isOlliTalkMoveCancelAgentCandidate(commandText,router))');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(move>=0);
  assert.ok(cancel>move);
  assert.ok(legacy>cancel);
  assert.match(block,/return resolveOlliTalkMoveAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile move bridge uses source-bound production without client-side second action save',()=>{
  const start=talk.indexOf('async function resolveOlliTalkMoveAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkMoveCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'move_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='move_class'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from move Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkMoveAgentTurn|isOlliTalkMoveAgentCandidate|move_prepare/);
});
