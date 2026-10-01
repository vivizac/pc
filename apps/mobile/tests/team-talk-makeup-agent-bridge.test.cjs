const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile makeup add and update route to production Agent endpoints',()=>{
  assert.ok(talk.includes('isOlliTalkMakeupAddAgentCandidate'));
  assert.ok(talk.includes('isOlliTalkMakeupUpdateAgentCandidate'));
  assert.ok(talk.includes("mode:'makeup_prepare'"));
  assert.ok(talk.includes("mode:'makeup_update_prepare'"));
});
test('Mobile makeup cancel preserves inline and two-turn reason flow',()=>{
  assert.ok(talk.includes('parseOlliTalkMakeupCancelAgentCandidate'));
  assert.ok(talk.includes('__makeupCancelAgent'));
  assert.ok(talk.includes('pendingMakeupCancel'));
  assert.ok(talk.includes("mode:'makeup_cancel_prepare'"));
  assert.ok(talk.includes('reasonMessageId:reasonId'));
  assert.ok(talk.includes('reasonMessageText:String(reasonMessageText'));
});
test('Mobile AI makeup routes occur before legacy prepareAction',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  for(const route of ['isOlliTalkMakeupUpdateAgentCandidate','isOlliTalkMakeupAddAgentCandidate']){
    const at=block.indexOf(route);
    assert.ok(at>=0 && legacy>at,route);
  }
});
