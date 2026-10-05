'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC waitlist add uses structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  const classifier=ai.indexOf('const routeClassifier=');
  const action=ai.indexOf("'add_waitlist'");
  assert.ok(action>=0 && classifier>action);
  assert.match(ai,/prepareStructuredAction/);
});

test('PC dead waitlist add Agent bridge is removed',()=>{
  assert.doesNotMatch(talk,/isWaitlistAddAgentCandidate|resolveWaitlistAddAgentTurn/);
  const dispatch=talk.slice(talk.indexOf('async function resolveSharedAgentRouteTurn'),talk.indexOf('async function resolveContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'waitlist_add'/);
});

test('PC Bot path remains independent from waitlist structured routing',()=>{
  const block=talk.slice(talk.indexOf('async function resolveBotTurn'),talk.indexOf('function buildAiConversationMessages'));
  assert.doesNotMatch(block,/waitlist_add_prepare|prepareStructuredAction/);
});
