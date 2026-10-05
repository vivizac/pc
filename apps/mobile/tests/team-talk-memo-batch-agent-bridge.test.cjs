'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile timetable memo uses structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  const structured=ai.indexOf("['add_timetable_memo','delete_timetable_memo'].includes(String(structuredCommand?.action || '').trim())");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/resolveOlliTalkStructuredTimetableMemoTurn/);
});

test('Mobile dead memo Agent bridge is removed while structured server bridge remains',()=>{
  assert.doesNotMatch(talk,/async function resolveOlliTalkTimetableMemoAgentTurn/);
  assert.doesNotMatch(talk,/function parseOlliTalkTimetableMemoAgentCandidate/);
  const dispatch=talk.slice(talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),talk.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'timetable_memo'/);

  const start=talk.indexOf('async function resolveOlliTalkStructuredTimetableMemoTurn');
  const end=talk.indexOf('function mergeOlliTalkStructuredTrialCancelCommand',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_memo_prepare'/);
  assert.match(block,/memoNote/);
  assert.match(block,/structuredCommand/);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveOlliTalkStructuredTargetChoice/);
});

test('Mobile batch remains rule-routed and uses batch_prepare',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  const batch=ai.indexOf("interpreterRoute==='rule' && interpreterIntent==='batch_write'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(batch>=0 && classifier>batch);
  assert.match(talk,/mode:'batch_prepare'/);
  assert.match(talk,/assistantMessages:messages/);
  assert.match(talk,/function olliTalkBatchCommandNeedsClarification/);
  assert.match(talk,/function applyOlliTalkBatchClarification/);
  const dispatch=talk.slice(talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),talk.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'batch_write'/);
});

test('Mobile structured memo resume supports repeated deterministic choices without another model call',()=>{
  const start=talk.indexOf('async function resolveOlliTalkStructuredTimetableMemoTurn');
  const end=talk.indexOf('function mergeOlliTalkStructuredTrialCancelCommand',start);
  const block=talk.slice(start,end);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveOlliTalkStructuredTargetChoice/);
  assert.doesNotMatch(block,/resolveOlliTalkTimetableMemoAgentTurn/);
});
