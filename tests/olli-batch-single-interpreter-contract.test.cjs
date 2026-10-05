'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const context=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const api=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('one interpreter response carries ordered structured batch subcommands',()=>{
  assert.match(context,/batch_commands/);
  assert.match(context,/batchCommandSchema/);
  assert.match(context,/For intent batch_write/);
  assert.match(context,/batchCommands:intent==='batch_write'/);
  assert.match(api,/batchCommands:/);
});

test('PC and Mobile bind Luna batch commands to deterministic parsed parts by index and intent',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/interpretedBatchCommands/);
    assert.match(source,/structuredCommand:Object\.assign\(\{\},system,\{action:intent\}\)/);
    assert.match(source,/복합명령 구조화 결과와 규칙 시스템 작업 수가 일치하지 않습니다/);
    assert.match(source,/batchCommands/);
  }
});
