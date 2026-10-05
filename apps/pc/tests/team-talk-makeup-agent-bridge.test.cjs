'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC makeup add/update use structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const classifier=ai.indexOf('const routeClassifier=');
  const structured=ai.indexOf("['add_makeup','update_makeup'");
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/prepareStructuredAction/);
});

test('PC dead makeup add/update Agent candidates and helpers are removed',()=>{
  for(const token of [
    'isMakeupAddAgentCandidate','isMakeupUpdateAgentCandidate',
    'resolveMakeupAddAgentTurn','resolveMakeupUpdateAgentTurn'
  ]) assert.doesNotMatch(talk,new RegExp(token));
  const dispatch=talk.slice(talk.indexOf('async function resolveSharedAgentRouteTurn'),talk.indexOf('async function resolveContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'makeup_add'|case 'makeup_update'/);
});

test('PC makeup cancel legacy reason compatibility remains intact',()=>{
  assert.match(talk,/function parseMakeupCancelAgentCandidate/);
  assert.match(talk,/async function resolveMakeupCancelAgentTurn/);
  assert.match(talk,/__makeupCancelAgent/);
  assert.match(talk,/mode:'makeup_cancel_prepare'/);
  const dispatch=talk.slice(talk.indexOf('async function resolveSharedAgentRouteTurn'),talk.indexOf('async function resolveContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'makeup_cancel'/);
});

test('PC structured makeup cancel remains preferred in unified interpreter flow',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const structured=ai.indexOf("clean(structuredCommand?.action)==='cancel_makeup'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/resolveStructuredMakeupCancelTurn/);
});

test('PC contextual makeup compatibility remains but unified interpreter owns current follow-ups',()=>{
  assert.match(talk,/pendingMakeupDialogue/);
  assert.match(talk,/mode:'context_makeup_prepare'/);
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  assert.doesNotMatch(ai,/resolveContextualMakeupTurn\(/);
  assert.match(ai,/interpreterIntent==='cancel_pending'/);
});
