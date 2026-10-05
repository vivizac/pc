'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC timetable memo uses structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const structured=ai.indexOf("['add_timetable_memo','delete_timetable_memo'].includes(clean(structuredCommand?.action))");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/resolveStructuredTimetableMemoTurn/);
});

test('PC dead memo Agent bridge is removed while structured server bridge remains',()=>{
  assert.doesNotMatch(talk,/async function resolveTimetableMemoAgentTurn/);
  assert.doesNotMatch(talk,/function parseTimetableMemoAgentCandidate/);
  const dispatch=talk.slice(talk.indexOf('async function resolveSharedAgentRouteTurn'),talk.indexOf('async function resolveContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'timetable_memo'/);

  const start=talk.indexOf('async function resolveStructuredTimetableMemoTurn');
  const end=talk.indexOf('function isSafeMakeupClarification',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_memo_prepare'/);
  assert.match(block,/memoNote/);
  assert.match(block,/structuredCommand/);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveStructuredTargetChoice/);
});

test('PC batch remains rule-routed and uses batch_prepare',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const batch=ai.indexOf("interpreterRoute==='rule' && interpreterIntent==='batch_write'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(batch>=0 && classifier>batch);
  assert.match(talk,/mode:'batch_prepare'/);
  assert.match(talk,/assistantMessages:messages/);
  assert.match(talk,/function batchCommandNeedsClarification/);
  assert.match(talk,/function applyBatchClarification/);
});

test('PC structured memo resume supports class and memoId choice without another model call',()=>{
  const start=talk.indexOf('async function resolveStructuredTimetableMemoTurn');
  const end=talk.indexOf('function isSafeMakeupClarification',start);
  const block=talk.slice(start,end);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveStructuredTargetChoice/);
  assert.doesNotMatch(block,/resolveTimetableMemoAgentTurn/);
});
