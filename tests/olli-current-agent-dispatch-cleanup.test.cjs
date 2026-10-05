'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const classifier=fs.readFileSync(path.join(root,'packages/common/olli-team-talk-agent-route-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('current classifier cannot route deterministic routine families',()=>{
  for(const token of ['batch_write','timetable_admin','timetable_memo','trial_add','makeup_add','waitlist_add','pickup_add','move_cancel','timetable_read','schedule_read']){
    assert.doesNotMatch(classifier,new RegExp(token));
  }
});

test('timetable memo dead client Agent bridge is actually removed',()=>{
  assert.doesNotMatch(pc,/resolveTimetableMemoAgentTurn|parseTimetableMemoAgentCandidate/);
  assert.doesNotMatch(mobile,/resolveOlliTalkTimetableMemoAgentTurn|parseOlliTalkTimetableMemoAgentCandidate/);
});

test('other compatibility switch cases remain gated behind the narrow Agent classifier for staged cleanup',()=>{
  for(const source of [pc,mobile]){
    const classifierPos=source.indexOf('const routeClassifier=');
    assert.ok(classifierPos>=0);
    assert.match(source,/interpreterRoute==='agent'/);
  }
});


test('pickup CRUD dead client Agent bridges are removed after structured migration',()=>{
  assert.doesNotMatch(pc,/resolvePickup(?:Add|Update|Cancel)AgentTurn|isPickup(?:Add|Update|Cancel)AgentCandidate/);
  assert.doesNotMatch(mobile,/resolveOlliTalkPickup(?:Add|Update|Cancel)AgentTurn|isOlliTalkPickup(?:Add|Update|Cancel)AgentCandidate/);
});


test('move and move-cancel dead client Agent bridges are removed after structured migration',()=>{
  assert.doesNotMatch(pc,/resolveMove(?:Cancel)?AgentTurn|isMove(?:Cancel)?AgentCandidate/);
  assert.doesNotMatch(mobile,/resolveOlliTalkMove(?:Cancel)?AgentTurn|isOlliTalkMove(?:Cancel)?AgentCandidate/);
});


test('makeup add/update dead client Agent bridges are removed while cancel compatibility remains',()=>{
  assert.doesNotMatch(pc,/resolveMakeup(?:Add|Update)AgentTurn|isMakeup(?:Add|Update)AgentCandidate/);
  assert.doesNotMatch(mobile,/resolveOlliTalkMakeup(?:Add|Update)AgentTurn|isOlliTalkMakeup(?:Add|Update)AgentCandidate/);
  assert.match(pc,/resolveMakeupCancelAgentTurn/);
  assert.match(mobile,/resolveOlliTalkMakeupCancelAgentTurn/);
});
