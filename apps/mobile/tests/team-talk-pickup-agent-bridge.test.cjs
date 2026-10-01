const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile pickup add/update/cancel all have Agent candidates',()=>{
  for(const name of ['isOlliTalkPickupAddAgentCandidate','isOlliTalkPickupUpdateAgentCandidate','isOlliTalkPickupCancelAgentCandidate']) assert.ok(talk.includes(name),name);
});
test('Mobile pickup production modes are source-bound',()=>{
  for(const mode of ["mode:'pickup_prepare'","mode:'pickup_update_prepare'","mode:'pickup_cancel_prepare'"]) assert.ok(talk.includes(mode),mode);
  assert.ok(talk.includes('sourceMessageId'));
});
test('Mobile AI routes pickup Agent paths before legacy prepareAction',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  for(const route of ['isOlliTalkPickupCancelAgentCandidate','isOlliTalkPickupUpdateAgentCandidate','isOlliTalkPickupAddAgentCandidate']){
    const at=block.indexOf(route);
    assert.ok(at>=0 && legacy>at,route);
  }
});
