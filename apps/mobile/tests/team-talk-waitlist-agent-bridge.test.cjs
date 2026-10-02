const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile waitlist add update cancel all route through Agent candidates',()=>{
  for(const name of ['isOlliTalkWaitlistAddAgentCandidate','isOlliTalkWaitlistUpdateAgentCandidate','isOlliTalkWaitlistCancelAgentCandidate']) assert.ok(talk.includes(name),name);
});
test('Mobile waitlist cancel keeps registered and guest requests on source-bound production',()=>{
  assert.ok(talk.includes("mode:'waitlist_cancel_prepare'"));
  const start=talk.indexOf('async function resolveOlliTalkWaitlistCancelAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkMakeupAddAgentTurn',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED|return null/);
});
test('Mobile waitlist routes occur before legacy prepareAction',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  for(const route of ['isOlliTalkWaitlistAddAgentCandidate','isOlliTalkWaitlistUpdateAgentCandidate','isOlliTalkWaitlistCancelAgentCandidate']){
    const at=block.indexOf(route);
    assert.ok(at>=0 && legacy>at,route);
  }
});
