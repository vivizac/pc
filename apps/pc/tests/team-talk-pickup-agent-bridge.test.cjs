'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const talk=fs.readFileSync('pc-team-talk.js','utf8');

test('PC pickup add/update/cancel enter structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const structured=ai.indexOf("['add_makeup','update_makeup','add_trial','update_trial','add_waitlist','cancel_waitlist','add_pickup','update_pickup','cancel_pickup','move_class','mark_absent'].includes(clean(structuredCommand?.action))");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/prepareStructuredAction/);
});

test('PC dead pickup Agent candidates and client bridge helpers are removed',()=>{
  for(const token of [
    'isPickupAddAgentCandidate','isPickupUpdateAgentCandidate','isPickupCancelAgentCandidate',
    'resolvePickupAddAgentTurn','resolvePickupUpdateAgentTurn','resolvePickupCancelAgentTurn'
  ]) assert.doesNotMatch(talk,new RegExp(token));
});

test('PC shared compatibility dispatch has no pickup CRUD Agent cases',()=>{
  const dispatch=talk.slice(
    talk.indexOf('async function resolveSharedAgentRouteTurn'),
    talk.indexOf('async function resolveContextualMakeupTurn')
  );
  assert.doesNotMatch(dispatch,/case 'pickup_add'|case 'pickup_update'|case 'pickup_cancel'/);
  assert.match(dispatch,/case 'pickup_read'/);
});

test('PC bot path remains independent from pickup structured AI path',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/prepareStructuredAction|pickup_prepare|pickup_update_prepare|pickup_cancel_prepare/);
});
