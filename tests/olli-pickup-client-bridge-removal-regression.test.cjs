'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const endpoint=fs.readFileSync(path.join(root,'apps/mobile/api/olli-agent.js'),'utf8');

test('pickup CRUD client helpers stay removed without changing neighboring legacy helper boundaries',()=>{
  for(const source of [pc,mobile]){
    assert.doesNotMatch(source,/resolve(?:OlliTalk)?Pickup(?:Add|Update|Cancel)AgentTurn/);
    assert.match(source,/resolve(?:OlliTalk)?MakeupUpdateAgentTurn/);
    assert.match(source,/resolve(?:OlliTalk)?MoveCancelAgentTurn/);
    assert.match(source,/resolve(?:OlliTalk)?WaitlistCancelAgentTurn/);
  }
});

test('pickup compatibility endpoints remain server-side only',()=>{
  for(const mode of ['pickup_prepare','pickup_update_prepare','pickup_cancel_prepare']){
    assert.match(endpoint,new RegExp("mode === '"+mode+"'"));
  }
});
