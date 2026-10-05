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


test('waitlist CRUD dead client Agent bridges are removed after structured migration',()=>{
  assert.doesNotMatch(pc,/resolveWaitlist(?:Add|Update|Cancel)AgentTurn|isWaitlist(?:Add|Update|Cancel)AgentCandidate/);
  assert.doesNotMatch(mobile,/resolveOlliTalkWaitlist(?:Add|Update|Cancel)AgentTurn|isOlliTalkWaitlist(?:Add|Update|Cancel)AgentCandidate/);
});


test('trial add and update dead client Agent bridges are removed after structured migration',()=>{
  assert.doesNotMatch(pc,/resolveTrial(?:Add|Update)AgentTurn|isTrial(?:Add|Update)AgentCandidate/);
  assert.doesNotMatch(mobile,/resolveOlliTalkTrial(?:Add|Update)AgentTurn|isOlliTalkTrial(?:Add|Update)AgentCandidate/);
});


test('obsolete local Agent candidate duplicates and unreachable read switch cases are removed',()=>{
  for(const token of [
    'parseAttendanceStatusAgentCandidate',
    'parseTimetableReadAgentCandidate',
    'isStudentAttendanceReadCandidate',
    'isStudentPickupReadCandidate',
    'isStudentScheduleReadCandidate'
  ]) assert.doesNotMatch(pc,new RegExp('function '+token+'\\b'));

  for(const token of [
    'parseOlliTalkAttendanceStatusAgentCandidate',
    'parseOlliTalkTimetableReadAgentCandidate',
    'isOlliTalkStudentAttendanceReadCandidate',
    'isOlliTalkStudentPickupReadCandidate',
    'isOlliTalkStudentScheduleReadCandidate'
  ]) assert.doesNotMatch(mobile,new RegExp('function '+token+'\\b'));

  const pcDispatch=pc.slice(pc.indexOf('async function resolveSharedAgentRouteTurn'),pc.indexOf('async function resolveContextualMakeupTurn'));
  const mobileDispatch=mobile.slice(mobile.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),mobile.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  for(const dispatch of [pcDispatch,mobileDispatch]){
    assert.doesNotMatch(dispatch,/case 'timetable_read'|case 'schedule_read'/);
    assert.match(dispatch,/case 'attendance_read'/);
    assert.match(dispatch,/case 'pickup_read'/);
  }
});


test('dead structured trial and makeup update client resolvers are removed after common-router migration',()=>{
  assert.doesNotMatch(pc,/resolveStructured(?:Trial|Makeup)UpdateTurn/);
  assert.doesNotMatch(mobile,/resolveOlliTalkStructured(?:Trial|Makeup)UpdateTurn/);
  assert.doesNotMatch(pc,/structured_(?:trial|makeup)_update_prepare/);
  assert.doesNotMatch(mobile,/structured_(?:trial|makeup)_update_prepare/);
});


test('shared Agent dispatch removes classifier-unreachable routine cases while preserving class_once for now',()=>{
  const pcDispatch=pc.slice(pc.indexOf('async function resolveSharedAgentRouteTurn'),pc.indexOf('async function resolveContextualMakeupTurn'));
  const mobileDispatch=mobile.slice(mobile.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),mobile.indexOf('async function resolveOlliTalkContextualMakeupTurn'));
  for(const dispatch of [pcDispatch,mobileDispatch]){
    for(const key of ['timetable_admin','batch_write','trial_cancel','makeup_cancel','absence']){
      assert.doesNotMatch(dispatch,new RegExp("case '"+key+"'"));
    }
    assert.match(dispatch,/case 'attendance_status'/);
    assert.match(dispatch,/case 'attendance_read'/);
    assert.match(dispatch,/case 'pickup_read'/);
    assert.match(dispatch,/case 'class_once'/);
  }
});
