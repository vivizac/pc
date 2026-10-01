const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile timetable memo add/delete routes through memo_prepare before legacy prepareAction',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  assert.match(talk,/function parseOlliTalkTimetableMemoAgentCandidate/);
  assert.match(talk,/parseTimetableMemoDeleteMutationIntent/);
  assert.match(talk,/parseTimetableMemoAddMutationIntent/);
  assert.match(talk,/mode:'memo_prepare'/);
  const memo=ai.indexOf('const timetableMemoCandidate=parseOlliTalkTimetableMemoAgentCandidate');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(memo>=0 && legacy>memo);
});

test('Mobile batch is detected before individual writes and collects reason turns',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  assert.match(talk,/function parseOlliTalkBatchAgentCandidate/);
  assert.match(talk,/function buildOlliTalkBatchAgentCommands/);
  assert.match(ai,/const pendingBatch=olliTalkPendingActionReason\.__batchAgent/);
  assert.match(ai,/const batchCandidate=parseOlliTalkBatchAgentCandidate/);
  assert.ok(ai.indexOf('const batchCandidate=parseOlliTalkBatchAgentCandidate')<ai.indexOf('const timetableMemoCandidate=parseOlliTalkTimetableMemoAgentCandidate'));
});

test('Mobile batch uses batch_prepare and renders all persisted cards',()=>{
  assert.match(talk,/mode:'batch_prepare'/);
  assert.match(talk,/assistantMessages:messages/);
  assert.match(talk,/assistantMessages\.slice\(1\)\.forEach\(message=>appendOlliTalkPersistedMessage/);
});

test('Mobile batch collects missing makeup date/time after reason turns',()=>{
  assert.match(talk,/function olliTalkBatchCommandNeedsClarification/);
  assert.match(talk,/function olliTalkBatchClarificationPrompt/);
  assert.match(talk,/function applyOlliTalkBatchClarification/);
  assert.match(talk,/보강 날짜와 시간을 함께 알려주세요/);
  assert.match(talk,/clarificationMessageId/);
});
