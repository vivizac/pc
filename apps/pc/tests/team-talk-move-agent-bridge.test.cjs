const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC move gate uses only shared move parser',()=>{
  const start=talk.indexOf('function isMoveAgentCandidate');
  const end=talk.indexOf('function isMoveCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseScheduleMoveMutationIntent\(commandText\)/);
  assert.match(block,/=== 'move_class'/);
  assert.doesNotMatch(block,/parseMoveCancelMutationIntent|prepareAction|cancel_move/);
});

test('PC move is routed before move cancel and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const move=block.indexOf('if (isMoveAgentCandidate(commandText, router))');
  const cancel=block.indexOf('if (isMoveCancelAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(move>=0);
  assert.ok(cancel>move);
  assert.ok(legacy>cancel);
  assert.match(block,/return resolveMoveAgentTurn\(commandText, current, replyToMessageId\)/);
});

test('PC move bridge uses source-bound production without client-side second action save',()=>{
  const start=talk.indexOf('async function resolveMoveAgentTurn');
  const end=talk.indexOf('async function resolveMoveCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'move_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'move_class'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from move Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveMoveAgentTurn|isMoveAgentCandidate|move_prepare/);
});
