'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile waitlist add uses structured rule path before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  const classifier=ai.indexOf('const routeClassifier=');
  const action=ai.indexOf("'add_waitlist'");
  assert.ok(action>=0 && classifier>action);
  assert.match(ai,/prepareStructuredAction/);
});

test('Mobile dead waitlist add Agent bridge is removed',()=>{
  assert.doesNotMatch(talk,/isOlliTalkWaitlistAddAgentCandidate|resolveOlliTalkWaitlistAddAgentTurn/);
  const dispatch=talk.slice(talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),talk.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'waitlist_add'/);
});
