'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile move registration uses structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  const classifier=ai.indexOf('const routeClassifier=');
  const move=ai.indexOf("'move_class'");
  assert.ok(move>=0 && classifier>move);
  assert.match(ai,/prepareStructuredAction/);
});

test('Mobile dead move Agent candidate and bridge are removed',()=>{
  assert.doesNotMatch(talk,/function isOlliTalkMoveAgentCandidate/);
  assert.doesNotMatch(talk,/async function resolveOlliTalkMoveAgentTurn/);
  const dispatch=talk.slice(talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),talk.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'move'/);
});

test('Mobile Bot path remains independent from structured move routing',()=>{
  const block=talk.slice(talk.indexOf('async function resolveOlliTalkBotTurn'),talk.indexOf('function handleOlliTalkAiModeChanged'));
  assert.doesNotMatch(block,/prepareStructuredAction|move_prepare/);
});
