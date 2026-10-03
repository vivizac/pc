'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../../..');
const common=fs.readFileSync(path.join(root,'packages/common/olli-agent-routing-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('phase A adds classifier SOT without changing active PC/Mobile routing yet',()=>{
  assert.match(common,/global\.OlliAgentRouting = api/);
  assert.doesNotMatch(pc,/OlliAgentRouting\.classify/);
  assert.doesNotMatch(mobile,/OlliAgentRouting\.classify/);
});

test('legacy fallback and general talk remain in place during phase A',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/prepareAction/);
    assert.match(source,/runQuery/);
    assert.match(source,/\/api\/chat/);
  }
});

test('Bot mode remains separate and untouched during Agent-first preparation',()=>{
  assert.match(pc,/function resolveBotTurn/);
  assert.match(mobile,/function resolveOlliTalkBotTurn/);
});
