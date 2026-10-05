'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const runtime=fs.readFileSync(path.join(__dirname,'../apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');

function functionBlock(name,nextName){
  const start=runtime.indexOf('async function '+name+'(');
  assert.ok(start>=0,name+' missing');
  const end=nextName
    ? runtime.indexOf('async function '+nextName+'(',start+20)
    : runtime.indexOf('\nfunction ',start+20);
  return runtime.slice(start,end>start?end:runtime.length);
}

test('batch prepare does not invoke per-command Agents SDK after the Luna interpretation',()=>{
  const block=functionBlock('runBatchPrepare','runContextualReadAgent');
  assert.match(block,/runBatchDirectPrepare/);
  assert.doesNotMatch(block,/run(?:Makeup|Trial|Waitlist|Pickup|Move|Absence|ClassOnce|TimetableMemo)[A-Za-z]*PrepareAgent\s*\(/);
  assert.doesNotMatch(block,/loadAgentsSdk\s*\(|new Agent\s*\(/);
});

test('batch direct dispatcher uses deterministic prepare action SOTs',()=>{
  const start=runtime.indexOf('async function runBatchDirectPrepare(');
  const end=runtime.indexOf('async function runBatchStructuredMakeupPrepare(',start);
  const block=runtime.slice(start,end);
  for(const fn of [
    'prepareMakeupAction','prepareMakeupUpdateAction','prepareMakeupCancelAction',
    'prepareTrialAddAction','prepareTrialUpdateAction','prepareTrialCancelAction',
    'prepareWaitlistAddAction','prepareWaitlistUpdateAction','prepareWaitlistCancelAction',
    'prepareMoveAction','prepareMoveCancelAction',
    'preparePickupAddAction','preparePickupUpdateAction','preparePickupCancelAction',
    'prepareTimetableMemoAction','prepareAbsenceAction','prepareClassOnceAction'
  ]) assert.match(block,new RegExp(fn));
  assert.doesNotMatch(block,/loadAgentsSdk\s*\(|new Agent\s*\(/);
});

test('server independently checks structured batch action against each stored source part',()=>{
  assert.match(runtime,/validateBatchStructuredCommand/);
  assert.match(runtime,/parseWriteIntent/);
  assert.match(runtime,/OLLI_ROUTINE_BATCH_SOURCE_INTENT_MISMATCH/);
});
