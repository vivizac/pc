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
