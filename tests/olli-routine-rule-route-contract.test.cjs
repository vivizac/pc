'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.resolve(__dirname,'..');
const context=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('batch and timetable admin are deterministic rule intents',()=>{
  const ruleStart=context.indexOf('const OLLI_RULE_INTENTS');
  const agentStart=context.indexOf('const OLLI_AGENT_INTENTS');
  const ruleBlock=context.slice(ruleStart,agentStart);
  const agentEnd=context.indexOf('function routeForSystemIntent',agentStart);
  const agentBlock=context.slice(agentStart,agentEnd);
  for(const intent of [
    'set_class_layout','set_class_teacher','set_teacher_override',
    'set_session_order','set_normal_class_day','batch_write'
  ]){
    assert.match(ruleBlock,new RegExp("'"+intent+"'"));
    assert.doesNotMatch(agentBlock,new RegExp("'"+intent+"'"));
  }
});

test('PC and Mobile enter direct rule handlers before shared Agent classifier',()=>{
  for(const source of [pc,mobile]){
    const classifier=source.indexOf('const routeClassifier=');
    const batch=source.indexOf("interpreterRoute==='rule' && interpreterIntent==='batch_write'");
    const admin=source.indexOf("['set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'].includes(interpreterIntent)");
    assert.ok(classifier>=0);
    assert.ok(batch>=0 && batch<classifier);
    assert.ok(admin>=0 && admin<classifier);
  }
});

test('direct batch rule helpers keep existing deterministic preparation and confirmation path',()=>{
  assert.match(pc,/async function resolveBatchRuleTurn/);
  assert.match(pc,/return resolveBatchAgentTurn/);
  assert.match(mobile,/async function resolveOlliTalkBatchRuleTurn/);
  assert.match(mobile,/return resolveOlliTalkBatchAgentTurn/);
});
