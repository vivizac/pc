'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../apps/mobile/olli-talk-beta.js'),'utf8');
function extract(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a);
 assert.ok(a>=0&&b>a,'source function must exist');
 return source.slice(a,b);
}
const helper=extract('  function settleOlliTalkInitialLatestPaint(chatArea,list){','  function renderOlliTalkServerMessages(');
function makeAnchor(){
 const callbacks=[],calls=[];
 const chatArea={scrollTop:0,scrollHeight:860,querySelector(){return list}};
 const list={isConnected:true,style:{visibility:'hidden'}};
 const settle=new Function('scheduleOlliTalkLatestMessageAnchor','requestAnimationFrame',
   helper+';return settleOlliTalkInitialLatestPaint;')(
   ()=>{calls.push(chatArea.scrollTop);return true;},
   callback=>{callbacks.push(callback);return callbacks.length;}
 );
 return {chatArea,list,settle,callbacks,calls};
}
test('initial newest-message position is anchored before the first visible frame',()=>{
 const {chatArea,list,settle,callbacks,calls}=makeAnchor();
 settle(chatArea,list);
 assert.equal(chatArea.scrollTop,860,'initial anchor is synchronous');
 assert.equal(list.style.visibility,'hidden','content remains hidden until the layout settles');
 assert.equal(callbacks.length,1,'one pre-paint correction, not an animated scroll');
 chatArea.scrollHeight=1120; // image or iOS visual viewport caused layout growth
 callbacks[0]();
 assert.equal(chatArea.scrollTop,1120,'correct newest position with the final height');
 assert.equal(list.style.visibility,'','reveal after correction');
 assert.deepEqual(calls,[860,1120]);
});
test('old detached message list never becomes visible after a newer render',()=>{
 const {chatArea,list,settle,callbacks}=makeAnchor();
 settle(chatArea,list);
 list.isConnected=false;
 callbacks[0]();
 assert.equal(list.style.visibility,'hidden');
});
test('first local paint uses hidden latest-anchor transaction, not delayed visible jump',()=>{
 const render=extract('  function renderOlliTalkServerMessages(payload,options={}){','  function getOlliTalkSearchRows()');
 assert.match(render,/if\(scrollMode==='initial-latest'\)list\.style\.visibility='hidden';/);
 assert.match(render,/if\(scrollMode==='initial-latest'\)\{[\s\S]*settleOlliTalkInitialLatestPaint\(chatArea,list\);/);
 assert.doesNotMatch(render,/if\(scrollMode==='initial-latest'\)\{[\s\S]*?setTimeout\(/);
});
test('unchanged combined messages do not force redraw just because unread counts changed',()=>{
 const load=extract('  async function loadOlliTalkBetaMessages(options = {}){','  async function loadOlderOlliTalkMessages()');
 assert.match(load,/areOlliTalkMessagePayloadsRenderEquivalent\(olliTalkCurrentViewPayload,presentation\)/);
 assert.doesNotMatch(load,/const renderChanged=sharedChanged\|\|/);
 const snap=extract('  function getOlliTalkRenderableMessageSnapshot(item){','  // Reuse authorized shared messages');
 const factory=new Function(snap+';return areOlliTalkMessagePayloadsRenderEquivalent;');
 const same=factory();
 const original={current_member_id:'member',messages:[{id:'shared:23',body:'읽은 메시지',unread_count:3}]};
 const refreshed={current_member_id:'member',messages:[{id:'shared:23',body:'읽은 메시지',unread_count:0}]};
 assert.equal(same(original,refreshed),true,'unread updates do not replace the chat DOM');
 assert.equal(same(original,{...refreshed,messages:[{...refreshed.messages[0],body:'새 메시지'}]}),false);
});

test('repeat entry after read stays in place; only actual new messages are appended',()=>{
 const sourceFn=extract('  function getOlliTalkRenderableMessageSnapshot(item){',
   '  // Reuse authorized shared messages');
 const append=new Function(sourceFn+';return getOlliTalkAppendOnlyMessages;')();
 const same=new Function(sourceFn+';return areOlliTalkMessagePayloadsRenderEquivalent;')();
 const a={current_member_id:'teacher',messages:[
   {id:'shared:8',body:'사진',seq:8,shared_seq:8,unread_count:1,
     created_at:'2026-11-20T11:00:00Z'},
   {id:'shared:9',body:'마지막 메시지',seq:9,shared_seq:9,unread_count:0,
     created_at:'2026-11-20T12:00:00Z'}
 ]};
 const b={current_member_id:'teacher',messages:[
   {...a.messages[0],seq:8,unread_count:0},
   {...a.messages[1],seq:9,unread_count:0}
 ]};
 assert.equal(same(a,b),true,'read-only metadata cannot rebuild same chat DOM');
 assert.equal(append(a,b),null,'no new messages means no append and no scroll jump');
 const c={...b,messages:[...b.messages,{
   id:'shared:10',body:'새 메시지',created_at:'2026-11-21T12:00:00Z'
 }]};
 assert.deepEqual(Array.from(append(a,c),item=>item.id),['shared:10']);
 const edit={...c,messages:[{...c.messages[0],body:'사진 수정'},...c.messages.slice(1)]};
 assert.equal(append(a,edit),null,'real edits use correct full reconciliation');
});
test('phone append path honors reader scroll position and retains DOM',()=>{
 const body=extract('  async function loadOlliTalkBetaMessages(options = {}){',
   '  async function loadOlderOlliTalkMessages()');
 assert.match(body,/const canAppend=!!added\?\.length/);
 assert.match(body,/appendOlliTalkPersistedMessage\(item,[\s\S]*\{anchor:nearBottom\}\)/);
 const appendSource=extract('  function appendOlliTalkPersistedMessage(', '  // Reveal the first local chat snapshot');
 assert.match(appendSource,/if\(options\.anchor!==false&&!isOlliTalkPendingReasonInputActive\(\)\)/);
 assert.match(body,/olliTalkCurrentViewPayload=presentation/);
});

test('phone first entry has exactly one authorized message-list render path',()=>{
  const open=extract('  async function openOlliTalkBetaPage(event){',
    '  async function closeOlliTalkBetaPage(event){');
  const loader=extract('  async function loadOlliTalkBetaMessages(options = {}){',
    '  async function loadOlderOlliTalkMessages()');
  assert.match(open,/setOlliTalkLoadingState\(\)/);
  assert.match(open,/loadOlliTalkBetaMessages\(\{[\s\S]*?initialCombinedPaint:true/);
  assert.doesNotMatch(open,/readCachedUnified\(/,
    'opening must not paint a known-stale persisted room before the latest server response');
  assert.doesNotMatch(open,/renderOlliTalkServerMessages\(combined/,
    'there cannot be an intermediate cached-message DOM commit');
  assert.match(loader,/const \[payload,initialShared\]=options\.initialCombinedPaint===true\s*\? await Promise\.all\(\[/);
  assert.match(loader,/const extension=initialShared\|\|await window\.OlliSharedTeamChat\.unifiedExtension/);
  assert.match(loader,/options\.openGeneration===olliTalkOpenGeneration&&isOlliTalkBetaVisible\(\)/,
    'closing the chat invalidates a pending first entry');
});
