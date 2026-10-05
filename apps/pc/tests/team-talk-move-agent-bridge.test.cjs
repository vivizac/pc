'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC move registration uses structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const classifier=ai.indexOf('const routeClassifier=');
  const move=ai.indexOf("'move_class'");
  assert.ok(move>=0 && classifier>move);
  assert.match(ai,/prepareStructuredAction/);
});

test('PC dead move Agent candidate and bridge are removed',()=>{
  assert.doesNotMatch(talk,/function isMoveAgentCandidate/);
  assert.doesNotMatch(talk,/async function resolveMoveAgentTurn/);
  const dispatch=talk.slice(talk.indexOf('async function resolveSharedAgentRouteTurn'),talk.indexOf('async function resolveContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'move'/);
});

test('PC Bot path remains independent from structured move routing',()=>{
  const block=talk.slice(talk.indexOf('async function resolveBotTurn'),talk.indexOf('function buildAiConversationMessages'));
  assert.doesNotMatch(block,/prepareStructuredAction|move_prepare/);
});
