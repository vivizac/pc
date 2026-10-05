'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile waitlist update direct structured bridge is source-bound',()=>{
  const start=talk.indexOf('async function resolveOlliTalkStructuredWaitlistUpdateTurn');
  const end=talk.indexOf('function isOlliTalkSafeMakeupClarification',start);
  const block=talk.slice(start,end);
  assert.match(block,/structured_waitlist_update_prepare/);
  assert.match(block,/sourceMessageId/);
  assert.match(block,/structuredCommand/);
  assert.doesNotMatch(block,/mode:'waitlist_update_prepare'/);
});

test('Mobile legacy waitlist update client Agent bridge is gone',()=>{
  assert.doesNotMatch(talk,/isOlliTalkWaitlistUpdateAgentCandidate|resolveOlliTalkWaitlistUpdateAgentTurn/);
});
