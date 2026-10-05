'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const endpoint=fs.readFileSync(path.join(__dirname,'../apps/mobile/api/olli-agent.js'),'utf8');

test('batch_prepare preserves Luna structured subcommands through the API boundary',()=>{
  const start=endpoint.indexOf('const commands = rawCommands.map');
  const end=endpoint.indexOf("if (mode === 'privacy_probe'",start);
  const block=endpoint.slice(start,end);
  assert.match(block,/structuredCommand:/);
  for(const field of [
    'sourceDateExpression','sourceWeekday','sourceTimeSlot','sourceClassGroup',
    'targetDateExpression','targetWeekday','targetTimeSlot','targetClassGroup',
    'pickupKind','pickupLabel','pickupTime'
  ]) assert.match(block,new RegExp(field));
});

test('batch_prepare preserves deterministic choice selections needed after the single Luna call',()=>{
  const start=endpoint.indexOf('const commands = rawCommands.map');
  const end=endpoint.indexOf("if (mode === 'privacy_probe'",start);
  const block=endpoint.slice(start,end);
  for(const field of ['sessionDate','timeSlot','classGroup','division','weekday','classTime']){
    assert.match(block,new RegExp(field));
  }
  assert.doesNotMatch(block,/const agentContext = contextModule\.toAgentRunContext\(requestContext\);/);
});
