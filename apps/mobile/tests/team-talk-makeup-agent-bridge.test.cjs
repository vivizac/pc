'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile makeup add/update use structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  const classifier=ai.indexOf('const routeClassifier=');
  const structured=ai.indexOf("['add_makeup','update_makeup'");
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/prepareStructuredAction/);
});

test('Mobile dead makeup add/update Agent candidates and helpers are removed',()=>{
  for(const token of [
    'isOlliTalkMakeupAddAgentCandidate','isOlliTalkMakeupUpdateAgentCandidate',
    'resolveOlliTalkMakeupAddAgentTurn','resolveOlliTalkMakeupUpdateAgentTurn'
  ]) assert.doesNotMatch(talk,new RegExp(token));
  const dispatch=talk.slice(talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),talk.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'makeup_add'|case 'makeup_update'/);
});

test('Mobile makeup cancel legacy reason compatibility remains intact',()=>{
  assert.match(talk,/function parseOlliTalkMakeupCancelAgentCandidate/);
  assert.match(talk,/async function resolveOlliTalkMakeupCancelAgentTurn/);
  assert.match(talk,/__makeupCancelAgent/);
  assert.match(talk,/mode:'makeup_cancel_prepare'/);
  const dispatch=talk.slice(talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),talk.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  assert.match(dispatch,/case 'makeup_cancel'/);
});

test('Mobile incomplete makeup draft and contextual compatibility remain',()=>{
  assert.match(talk,/parseOlliTalkMakeupAddDraftCandidate/);
  assert.match(talk,/보강 날짜가 빠져 있어요/);
  assert.match(talk,/mode:'context_makeup_prepare'/);
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  assert.doesNotMatch(ai,/resolveOlliTalkContextualMakeupTurn\(/);
});

test('Mobile structured makeup cancel remains preferred before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  const structured=ai.indexOf("String(structuredCommand?.action || '').trim()==='cancel_makeup'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/resolveOlliTalkStructuredMakeupCancelTurn/);
});
