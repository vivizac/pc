'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile move cancel uses structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  const structured=ai.indexOf("String(structuredCommand?.action || '').trim()==='cancel_move'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/resolveOlliTalkStructuredMoveCancelTurn/);
});

test('Mobile dead move-cancel Agent candidate and bridge are removed',()=>{
  assert.doesNotMatch(talk,/function isOlliTalkMoveCancelAgentCandidate/);
  assert.doesNotMatch(talk,/async function resolveOlliTalkMoveCancelAgentTurn/);
  const dispatch=talk.slice(talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),talk.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'move_cancel'/);
});

test('Mobile move cancel target choice remains deterministic without another Agent turn',()=>{
  const start=talk.indexOf('async function resolveOlliTalkStructuredMoveCancelTurn');
  const end=talk.indexOf('function isOlliTalkPendingReasonCancel',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_move_cancel_prepare'/);
  assert.match(block,/structuredCommand/);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveOlliTalkStructuredTargetChoice/);
  assert.doesNotMatch(block,/mode:'move_cancel_prepare'/);
});

test('Mobile Bot path remains independent from move cancel structured routing',()=>{
  const block=talk.slice(talk.indexOf('async function resolveOlliTalkBotTurn'),talk.indexOf('function handleOlliTalkAiModeChanged'));
  assert.doesNotMatch(block,/resolveOlliTalkStructuredMoveCancelTurn|move_cancel_prepare/);
});
