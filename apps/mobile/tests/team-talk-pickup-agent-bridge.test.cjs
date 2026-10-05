'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile pickup add/update/cancel enter structured rule path before Agent classifier',()=>{
  const ai=talk.slice(
    talk.indexOf('async function resolveOlliTalkAiTurn'),
    talk.indexOf('function getOlliTalkMentionMessageText')
  );
  const structured=ai.indexOf("['add_makeup','update_makeup','add_trial','update_trial','add_waitlist','cancel_waitlist','add_pickup','update_pickup','cancel_pickup','move_class','mark_absent'].includes(String(structuredCommand?.action || '').trim())");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/prepareStructuredAction/);
});

test('Mobile dead pickup Agent candidates and client bridge helpers are removed',()=>{
  for(const token of [
    'isOlliTalkPickupAddAgentCandidate','isOlliTalkPickupUpdateAgentCandidate','isOlliTalkPickupCancelAgentCandidate',
    'resolveOlliTalkPickupAddAgentTurn','resolveOlliTalkPickupUpdateAgentTurn','resolveOlliTalkPickupCancelAgentTurn'
  ]) assert.doesNotMatch(talk,new RegExp(token));
});

test('Mobile shared compatibility dispatch has no pickup CRUD Agent cases',()=>{
  const dispatch=talk.slice(
    talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),
    talk.indexOf('async function resolveOlliTalkContextualMakeupTurn')
  );
  assert.doesNotMatch(dispatch,/case 'pickup_add'|case 'pickup_update'|case 'pickup_cancel'/);
  assert.match(dispatch,/case 'pickup_read'/);
});

test('Mobile current Agent pickup_read history route remains intact',()=>{
  const dispatch=talk.slice(
    talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),
    talk.indexOf('async function resolveOlliTalkContextualMakeupTurn')
  );
  assert.match(dispatch,/mode:'pickup_read'/);
  assert.match(dispatch,/resolveOlliTalkSourceBoundReadAgentTurn/);
});
