'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile trial update enters structured rule path before Agent classifier',()=>{
  const ai=talk.slice(
    talk.indexOf('async function resolveOlliTalkAiTurn'),
    talk.indexOf('function getOlliTalkMentionMessageText')
  );
  const structured=ai.indexOf("['add_makeup','update_makeup','add_trial','update_trial'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/prepareStructuredAction/);
});

test('Mobile dead trial update Agent candidate and client bridge helper are removed',()=>{
  for(const token of ['isOlliTalkTrialUpdateAgentCandidate','resolveOlliTalkTrialUpdateAgentTurn']){
    assert.doesNotMatch(talk,new RegExp(token));
  }
});

test('Mobile shared compatibility dispatch has no trial update Agent case and keeps trial cancel',()=>{
  const dispatch=talk.slice(
    talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),
    talk.indexOf('async function resolveOlliTalkContextualMakeupTurn')
  );
  assert.doesNotMatch(dispatch,/case 'trial_update'/);
  assert.match(dispatch,/case 'trial_cancel'/);
});

test('Mobile structured trial update production path remains source-bound',()=>{
  const start=talk.indexOf('async function resolveOlliTalkStructuredTrialUpdateTurn');
  const end=talk.indexOf('async function resolveOlliTalkStructuredWaitlistUpdateTurn',start);
  const block=talk.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(block,/mode:'structured_trial_update_prepare'/);
  assert.match(block,/sourceMessageId/);
  assert.match(block,/structuredCommand/);
  assert.match(block,/update_trial/);
});
