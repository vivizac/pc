'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const runtime=fs.readFileSync(path.join(__dirname,'../apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');

test('runtime keeps downstream functions after structured move cancel patch',()=>{
  for(const name of [
    'restorePreparedSubjectLabels',
    'runMakeupPrepare',
    'runTimetableAdminPrepare',
    'runBatchPrepare'
  ]) assert.match(runtime,new RegExp('(?:function|async function) '+name+'\\b'));
});

test('structured move cancel and memo are direct SOT paths without Agents SDK',()=>{
  for(const [startName,endName] of [
    ['runStructuredTimetableMemoPrepare','resolvePickupPrepareScope'],
    ['runStructuredMoveCancelPrepare','runMakeupPrepare']
  ]){
    const start=runtime.indexOf('async function '+startName);
    const end=runtime.indexOf(startName==='runStructuredTimetableMemoPrepare'?'function '+endName:'async function '+endName,start+20);
    const block=runtime.slice(start,end);
    assert.match(block,/prepare(?:TimetableMemo|MoveCancel)Action/);
    assert.doesNotMatch(block,/loadAgentsSdk\s*\(/);
    assert.doesNotMatch(block,/new Agent\s*\(/);
  }
});
