const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC timetable memo add/delete routes through memo_prepare before legacy prepareAction',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  assert.match(talk,/function parseTimetableMemoAgentCandidate/);
  assert.match(talk,/parseTimetableMemoDeleteMutationIntent/);
  assert.match(talk,/parseTimetableMemoAddMutationIntent/);
  assert.match(talk,/mode:'memo_prepare'/);
  const memo=ai.indexOf('const timetableMemoCandidate = parseTimetableMemoAgentCandidate');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(memo>=0 && legacy>memo);
});

test('PC memo bridge sends server-side memo note and consumes persisted action',()=>{
  const start=talk.indexOf('async function resolveTimetableMemoAgentTurn');
  const end=talk.indexOf('async function resolveMakeupAddAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/sourceMessageId/);
  assert.match(block,/memoNote:clean\(parsed\?\.memoNote\)/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC batch is detected before individual writes and missing reasons are collected',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  assert.match(talk,/function parseBatchAgentCandidate/);
  assert.match(talk,/function buildBatchAgentCommands/);
  assert.match(talk,/function batchCommandNeedsReason/);
  assert.match(ai,/const pendingBatch = state\.pendingActionReason\.__batchAgent/);
  assert.match(ai,/const batchCandidate = parseBatchAgentCandidate/);
  assert.ok(ai.indexOf('const batchCandidate = parseBatchAgentCandidate')<ai.indexOf('const timetableMemoCandidate = parseTimetableMemoAgentCandidate'));
});

test('PC batch uses batch_prepare and renders multiple persisted cards',()=>{
  assert.match(talk,/mode:'batch_prepare'/);
  assert.match(talk,/assistantMessages:messages/);
  assert.match(talk,/assistantMessages\.slice\(1\)\.forEach/);
  assert.match(talk,/appendPersistedMessage\(message,current\.memberId\)/);
});
