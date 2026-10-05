'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC trial add enters structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const structured=ai.indexOf("['add_makeup','update_makeup','add_trial','update_trial'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/prepareStructuredAction/);
});

test('PC dead trial add Agent candidate and client bridge helper are removed',()=>{
  for(const token of ['isTrialAddAgentCandidate','resolveTrialAddAgentTurn']){
    assert.doesNotMatch(talk,new RegExp(token));
  }
});

test('PC shared dispatch has no trial add or trial cancel case while cancel fallback remains',()=>{
  const dispatch=talk.slice(
    talk.indexOf('async function resolveSharedAgentRouteTurn'),
    talk.indexOf('async function resolveContextualMakeupTurn')
  );
  assert.doesNotMatch(dispatch,/case 'trial_add'/);
  assert.doesNotMatch(dispatch,/case 'trial_cancel'/);
  assert.match(talk,/__trialCancelAgent/);
  assert.match(talk,/resolve(?:OlliTalk)?TrialCancelAgentTurn/);
});

test('PC trial add compatibility prepare mode is no longer called by the client',()=>{
  assert.doesNotMatch(talk,/mode:'trial_add_prepare'/);
});
