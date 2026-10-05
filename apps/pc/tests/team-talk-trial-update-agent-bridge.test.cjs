'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC trial update enters structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const structured=ai.indexOf("['add_makeup','update_makeup','add_trial','update_trial'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/prepareStructuredAction/);
});

test('PC dead trial update Agent candidate and client bridge helper are removed',()=>{
  for(const token of ['isTrialUpdateAgentCandidate','resolveTrialUpdateAgentTurn']){
    assert.doesNotMatch(talk,new RegExp(token));
  }
});

test('PC shared dispatch has no trial update or trial cancel case while cancel fallback remains',()=>{
  const dispatch=talk.slice(
    talk.indexOf('async function resolveSharedAgentRouteTurn'),
    talk.indexOf('async function resolveContextualMakeupTurn')
  );
  assert.doesNotMatch(dispatch,/case 'trial_update'/);
  assert.doesNotMatch(dispatch,/case 'trial_cancel'/);
  assert.match(talk,/__trialCancelAgent/);
  assert.match(talk,/resolve(?:OlliTalk)?TrialCancelAgentTurn/);
});

test('PC structured trial update now uses only the common prepareStructuredAction path',()=>{
  assert.doesNotMatch(talk,/async function resolveStructuredTrialUpdateTurn/);
  assert.doesNotMatch(talk,/mode:'structured_trial_update_prepare'/);
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  assert.match(ai,/['"]update_trial['"]/);
  assert.match(ai,/prepareStructuredAction\(structuredCommand/);
});
