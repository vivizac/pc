'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile waitlist update uses structured rule bridge before Agent classifier',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  const structured=ai.indexOf("String(structuredCommand?.action || '').trim()==='update_waitlist'");
  const classifier=ai.indexOf('const routeClassifier=');
  assert.ok(structured>=0 && classifier>structured);
  assert.match(ai,/resolveOlliTalkStructuredWaitlistUpdateTurn/);
});

test('Mobile waitlist add/cancel use structured rule transport',()=>{
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  assert.match(ai,/add_waitlist/);
  assert.match(ai,/cancel_waitlist/);
  assert.match(ai,/prepareStructuredAction/);
});

test('Mobile dead waitlist Agent candidates and helpers are removed',()=>{
  for(const token of [
    'isOlliTalkWaitlistAddAgentCandidate','isOlliTalkWaitlistUpdateAgentCandidate','isOlliTalkWaitlistCancelAgentCandidate',
    'resolveOlliTalkWaitlistAddAgentTurn','resolveOlliTalkWaitlistUpdateAgentTurn','resolveOlliTalkWaitlistCancelAgentTurn'
  ]) assert.doesNotMatch(talk,new RegExp(token));
  const dispatch=talk.slice(talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),talk.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  assert.doesNotMatch(dispatch,/case 'waitlist_add'|case 'waitlist_update'|case 'waitlist_cancel'/);
});
