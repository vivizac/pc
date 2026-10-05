'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const ctx=fs.readFileSync(path.join(root,'apps/mobile/api/_lib/olli-agent/context-route.cjs'),'utf8');
const endpoint=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');
const router=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('one Luna interpretation transports two or three structured read commands',()=>{
  assert.match(ctx,/readCommandSchema/);
  assert.match(ctx,/read_commands/);
  assert.match(ctx,/intent multi_read_query/);
  assert.match(endpoint,/readCommands:/);
  for(const source of [pc,mobile]){
    assert.match(source,/language\.readCommands/);
    assert.match(source,/interpretation\.readCommands/);
  }
});

test('multi read is source-checked and executes only existing structured query SOTs',()=>{
  assert.match(router,/function structuredReadMatchesParsed/);
  assert.match(router,/async function runStructuredMultiQuery/);
  assert.match(router,/parseQueryIntent\(sourceText\)/);
  assert.match(router,/runStructuredQuery\(command,context\)/);
  assert.match(router,/queries\.length!==commands\.length/);
});

test('PC and Mobile use structured multi read before legacy rule fallback',()=>{
  for(const source of [pc,mobile]){
    const structured=source.indexOf("interpreterIntent==='multi_read_query'");
    const legacy=source.indexOf("ruleCommandMatchesInterpretation",structured);
    assert.ok(structured>=0);
    assert.match(source,/runStructuredMultiQuery/);
  }
});
