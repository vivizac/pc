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
test('Mobile AI makeup routes occur before legacy prepareAction — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'makeup_add'/);
  assert.match(dispatch,/case 'makeup_cancel'/);
  assert.match(dispatch,/case 'makeup_update'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);
  assert.match(ai,/__makeupCancelAgent/);
});
test('Mobile incomplete makeup add is handled before generic AI fallback',()=>{
  assert.ok(talk.includes('parseOlliTalkMakeupAddDraftCandidate'));
  assert.ok(talk.includes('olliTalkMakeupAddDraftPrompt'));
  assert.ok(talk.includes('보강 날짜가 빠져 있어요.'));
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const draft=block.indexOf('const makeupAddDraftCandidate=parseOlliTalkMakeupAddDraftCandidate(commandText,router)');
  const fallback=block.indexOf('const resolved=await resolveOlliTalkAiReply(commandText,context)');
  assert.ok(draft>=0 && fallback>draft);
});

test('shared router exposes a makeup draft for the screenshot command without a date',()=>{
  const vm=require('node:vm');
  const routerText=fs.readFileSync(path.resolve(__dirname,'../../../packages/common/olli-command-router-common.js'),'utf8');
  const sandbox={window:{},globalThis:{},console};
  sandbox.globalThis=sandbox.window;
  vm.runInNewContext(routerText,sandbox);
  const router=sandbox.window.OlliCommandRouter;
  const draft=router.parseBatchDraftWriteIntent('권보미 초등부 5시 보강 등록해줘');
  assert.equal(draft?.intent,'add_makeup');
  assert.equal(draft?.batchDraft,true);
  assert.deepEqual(Array.from(draft?.missingBatchFields||[]),['date']);
  assert.equal(router.parseMakeupMutationIntent('권보미 초등부 5시 보강 등록해줘'),null);
});


test('makeup business validation errors become normal Olli replies instead of generic AI failures',()=>{
  const runtime=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/runtime.cjs'),'utf8');
  const tool=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/makeup-prepare-tools.cjs'),'utf8');
  const pc=fs.readFileSync(path.resolve(__dirname,'../../pc/pc-team-talk.js'),'utf8');

  assert.match(tool,/capturePrepareError/);
  assert.match(runtime,/if \(requirePersistedMessage && !persistedMessage && prepareError\) \{\s*throw prepareError;/);
  assert.match(talk,/OLLI_AGENT_MAKEUP_GROUP_REQUIRED/);
  assert.match(talk,/saveOlliTalkOlliReply\(context,message,replyToMessageId\)/);
  assert.match(pc,/OLLI_AGENT_MAKEUP_GROUP_REQUIRED/);
  assert.match(pc,/saveAssistantReply\(current,message,replyToMessageId\)/);
});


test('makeup tool wires capturePrepareError into createPrepareMakeupTool parameters',()=>{
  const tool=fs.readFileSync(path.join(__dirname,'../api/_lib/olli-agent/tools/makeup-prepare-tools.cjs'),'utf8');
  const start=tool.indexOf('function createPrepareMakeupTool({');
  const end=tool.indexOf('}) {',start);
  const signature=tool.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(signature,/capturePrepareError\s*=\s*null/);
  assert.match(tool,/if \(typeof capturePrepareError === 'function'\) \{\s*capturePrepareError\(error\);/);
});
