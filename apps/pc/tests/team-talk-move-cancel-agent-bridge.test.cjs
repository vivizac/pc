'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC move cancel uses structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const structured=ai.indexOf("clean(structuredCommand?.action)==='cancel_move'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/resolveStructuredMoveCancelTurn/);
});

test('PC dead move-cancel Agent candidate and bridge are removed',()=>{
  assert.doesNotMatch(talk,/function isMoveCancelAgentCandidate/);
  assert.doesNotMatch(talk,/async function resolveMoveCancelAgentTurn/);
  const dispatch=talk.slice(talk.indexOf('async function resolveSharedAgentRouteTurn'),talk.indexOf('async function resolveContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'move_cancel'/);
});

test('PC move cancel target choice remains deterministic without another Agent turn',()=>{
  const start=talk.indexOf('async function resolveStructuredMoveCancelTurn');
  const end=talk.indexOf('async function saveAssistantReply',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_move_cancel_prepare'/);
  assert.match(block,/structuredCommand/);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveStructuredTargetChoice/);
  assert.doesNotMatch(block,/mode:'move_cancel_prepare'/);
});

test('PC Bot path remains independent from move cancel structured routing',()=>{
  const block=talk.slice(talk.indexOf('async function resolveBotTurn'),talk.indexOf('function buildAiConversationMessages'));
  assert.doesNotMatch(block,/resolveStructuredMoveCancelTurn|move_cancel_prepare/);
});
