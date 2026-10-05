'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC waitlist update uses dedicated structured rule bridge before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const structured=ai.indexOf("clean(structuredCommand?.action)==='update_waitlist'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/resolveStructuredWaitlistUpdateTurn/);
});

test('PC waitlist add/cancel remain on structured rule transport',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  assert.match(ai,/add_waitlist/);
  assert.match(ai,/cancel_waitlist/);
  assert.match(ai,/prepareStructuredAction/);
});

test('PC dead waitlist Agent candidates and helpers are removed',()=>{
  for(const token of [
    'isWaitlistAddAgentCandidate','isWaitlistUpdateAgentCandidate','isWaitlistCancelAgentCandidate',
    'resolveWaitlistAddAgentTurn','resolveWaitlistUpdateAgentTurn','resolveWaitlistCancelAgentTurn'
  ]) assert.doesNotMatch(talk,new RegExp(token));
  const dispatch=talk.slice(talk.indexOf('async function resolveSharedAgentRouteTurn'),talk.indexOf('async function resolveContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'waitlist_add'|case 'waitlist_update'|case 'waitlist_cancel'/);
});

test('PC Bot path remains independent from waitlist structured paths',()=>{
  const block=talk.slice(talk.indexOf('async function resolveBotTurn'),talk.indexOf('function buildAiConversationMessages'));
  assert.doesNotMatch(block,/waitlist_(?:add|update|cancel)_prepare/);
});
