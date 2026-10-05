'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile trial add enters structured rule path before Agent classifier',()=>{
  const ai=talk.slice(
    talk.indexOf('async function resolveOlliTalkAiTurn'),
    talk.indexOf('function getOlliTalkMentionMessageText')
  );
  const structured=ai.indexOf("['add_makeup','update_makeup','add_trial','update_trial'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/prepareStructuredAction/);
});

test('Mobile dead trial add Agent candidate and client bridge helper are removed',()=>{
  for(const token of ['isOlliTalkTrialAddAgentCandidate','resolveOlliTalkTrialAddAgentTurn']){
    assert.doesNotMatch(talk,new RegExp(token));
  }
});

test('Mobile shared compatibility dispatch has no trial add Agent case and keeps trial cancel',()=>{
  const dispatch=talk.slice(
    talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),
    talk.indexOf('async function resolveOlliTalkContextualMakeupTurn')
  );
  assert.doesNotMatch(dispatch,/case 'trial_add'/);
  assert.match(dispatch,/case 'trial_cancel'/);
});

test('Mobile trial add compatibility prepare mode is no longer called by the client',()=>{
  assert.doesNotMatch(talk,/mode:'trial_add_prepare'/);
});
