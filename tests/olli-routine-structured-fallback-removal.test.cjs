'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.resolve(__dirname,'..');

const ctx=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const endpoint=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('routine interpreter transports pickup edit cancel move cancel and timetable memo as structured commands',()=>{
  for(const action of ['update_pickup','cancel_pickup','cancel_move','add_timetable_memo','delete_timetable_memo']){
    assert.match(ctx,new RegExp("'"+action+"'"));
  }
  assert.match(ctx,/memo_note/);
  assert.match(endpoint,/memoNote:safeText\(result\?\.structuredCommand\?\.memoNote/);
  assert.match(pc,/memoNote:clean\(structuredRaw\.memoNote\)/);
  assert.match(mobile,/memoNote:String\(structuredRaw\.memoNote/);
});

test('cancel move initial structured path resolves current move rows without model-selected ids',()=>{
  const start=runtime.indexOf('async function runStructuredMoveCancelPrepare');
  const end=runtime.indexOf('function parseAttendanceStatusSource',start);
  const block=runtime.slice(start,end);
  assert.match(block,/sourceWeekday/);
  assert.match(block,/sourceHour/);
  assert.match(block,/prepareMoveCancelAction/);
  assert.match(block,/target_choice_required/);
  assert.doesNotMatch(block,/new Agent\s*\(/);
  assert.doesNotMatch(block,/loadAgentsSdk\s*\(/);
  for(const source of [pc,mobile]){
    assert.match(source,/choiceRequired/);
    assert.match(source,/cancel_move/);
  }
});

test('timetable memo initial structured path resolves date and current timetable before confirmation',()=>{
  const start=runtime.indexOf('async function runStructuredTimetableMemoPrepare');
  const end=runtime.indexOf('function resolvePickupPrepareScope',start);
  const block=runtime.slice(start,end);
  assert.match(block,/dateExpression/);
  assert.match(block,/parseDateExpression/);
  assert.match(block,/prepareTimetableMemoAction/);
  assert.match(block,/target_choice_required/);
  assert.doesNotMatch(block,/new Agent\s*\(/);
  assert.doesNotMatch(block,/loadAgentsSdk\s*\(/);
});

test('PC and Mobile choose structured cancel move and memo before legacy rule fallback',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/structuredCommand\?\.action/);
    assert.match(source,/cancel_move/);
    assert.match(source,/add_timetable_memo/);
    assert.match(source,/delete_timetable_memo/);
    assert.match(source,/StructuredTimetableMemoTurn/);
  }
});
