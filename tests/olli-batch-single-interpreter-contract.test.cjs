'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const context=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('one Luna interpreter response carries only canonical text, not structured batch fields',()=>{
  const start=context.indexOf('async function defaultOlliInterpreterRunner');
  const end=context.indexOf('async function resolveOlliSystemInterpretation',start);
  const block=context.slice(start,end);
  assert.match(block,/standalone_command/);
  assert.doesNotMatch(block,/batch_commands/);
  assert.doesNotMatch(block,/batchCommandSchema/);
  assert.doesNotMatch(block,/structured_command/);
});

test('PC and Mobile derive batch subcommands from the deterministic parser after one Luna translation',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/interpretedIntentToStructuredCommand/);
    assert.match(source,/parseMultiWriteIntent/);
    assert.match(source,/structuredCommand:Object\.assign\(\{\},system,\{action:intent\}\)/);
    assert.match(source,/resolve(?:OlliTalk)?BatchRuleTurn/);
  }
});
