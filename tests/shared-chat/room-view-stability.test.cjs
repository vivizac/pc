'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const phone=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
function extract(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'original loader must exist');
  return source.slice(a,b);
}
const pcLoader=extract(pc,'  async function loadMessages(options = {}) {','  function archiveItems()');
const phoneLoader=extract(phone,'  async function loadOlliTalkBetaMessages(options = {}){','  async function loadOlderOlliTalkMessages()');
const privateMessage={id:1,academy_id:'academy',created_at:'2026-11-20T00:00:00Z'};
const sharedMessage={id:'shared:2',created_at:'2026-11-20T00:01:00Z'};
const ctx={academyId:'academy',memberId:'member',sessionToken:'session'};
const scope=c=>[c.academyId,c.memberId,c.sessionToken].join(':');

async function runPc({verified=false,joined=true,fail=false}={}){
  const state={messageLoadSequence:0,messageViewContextKey:verified?scope(ctx):'',
    messages:verified?[{id:'shared:old'}]:[],sharedJoined:verified};
  const body={changes:[],replaceChildren(x){this.changes.push(x);}};
  const rendered=[];
  const dependencies={
    state,context:()=>ctx,teamTalkContextKey:scope,byId:()=>body,
    emptyState:title=>({title}),
    rpc:async()=>({ok:true,messages:[privateMessage]}),
    global:{OlliSharedTeamChat:{
      unifiedExtension:async()=>{
        if(fail)throw new Error('unified status unavailable');
        return {joined,room:{id:'room'},messages:[sharedMessage],latestSeq:0};
      }
    }},
    renderMessages:payload=>{rendered.push(payload.messages);state.messages=payload.messages;},
    isVisible:()=>false,markRead:async()=>true,refreshBadge:async()=>true,
    console:{warn(){}}
  };
  const fn=new Function(...Object.keys(dependencies),pcLoader+';return loadMessages')(...Object.values(dependencies));
  const ok=await fn({showLoading:true,followBottom:true});
  return {ok,state,rendered,changes:body.changes};
}
async function runPhone({verified=false,joined=true,fail=false}={}){
  const cache={ok:true,academy_id:'academy',messages:[privateMessage]};
  const initialView=verified?{ok:true,academy_id:'academy',__academyLocal:cache,
    messages:[privateMessage,{id:'shared:old',created_at:'2026-11-20T00:00:30Z'}]}:null;
  const rendered=[],changes=[];
  const area={replaceChildren(x){changes.push(x);}};
  const d={
    getOlliTalkBetaContext:()=>ctx,readOlliTalkMessageCache:()=>cache,
    isOlliTalkBetaVisible:()=>true,setOlliTalkLoadingState:()=>changes.push('loading'),
    document:{getElementById:()=>area},
    createOlliTalkEmptyState:(title,detail)=>({title,detail}),
    callOlliTalkRpc:async()=>({ok:true,academy_id:'academy',messages:[privateMessage]}),
    mergeOlliTalkMessagePayloads:(_old,next)=>next,
    areOlliTalkMessagePayloadsEquivalent:()=>false,
    areOlliTalkMessagePayloadsRenderEquivalent:()=>false,
    isOlliTalkMessageListInSync:()=>false,
    writeOlliTalkMessageCache:()=>{},
    renderOlliTalkServerMessages:payload=>rendered.push(payload.messages),
    syncOlliTalkRenderedUnreadCounts:()=>{},
    markOlliTalkMessagesRead:async()=>true,
    refreshOlliTalkMentionBadge:async()=>true,
    console:{warn(){}},
    window:{OlliSharedTeamChat:{
      unifiedExtension:async()=>{
        if(fail)throw new Error('unified status unavailable');
        return {joined,messages:[sharedMessage],room:{id:'room',participation_id:'part'},latestSeq:0};
      }
    }}
  };
  const init='let olliTalkLoadSequence=0;let olliTalkCurrentPayload=initialView?.__academyLocal||null;'
    +"let olliTalkCurrentViewPayload=initialView;let olliTalkSharedViewSignature=initialView?'room:part:old':'';"
    +'let olliTalkRenderedMessageLimit=100;let olliTalkHistoryExhausted=false;';
  const fn=new Function(...Object.keys(d),'initialView',init+phoneLoader+';return loadOlliTalkBetaMessages')(
    ...Object.values(d),initialView
  );
  const ok=await fn({cachedPayload:cache,localFirst:false,showLoading:true,initialCombinedPaint:true,messageLimit:100});
  return {ok,rendered,changes};
}
test('PC: verified combined messages survive failed status refresh',async()=>{
  const out=await runPc({verified:true,fail:true});
  assert.equal(out.ok,false);
  assert.deepEqual(out.state.messages,[{id:'shared:old'}]);
  assert.equal(out.rendered.length,0);
  assert.equal(out.changes.length,0);
});
test('PC: unknown status never renders academy-only chat',async()=>{
  const out=await runPc({fail:true});
  assert.equal(out.ok,false);
  assert.equal(out.rendered.length,0);
  assert.ok(out.changes.length>=1);
});
test('PC: combined and confirmed-unjoined modes render only after verification',async()=>{
  assert.deepEqual((await runPc()).rendered[0].map(x=>x.id),[1,'shared:2']);
  assert.deepEqual((await runPc({joined:false})).rendered[0].map(x=>x.id),[1]);
});
test('Phone: verified combined messages survive failed status refresh',async()=>{
  const out=await runPhone({verified:true,fail:true});
  assert.equal(out.ok,false);
  assert.equal(out.rendered.length,0);
  assert.equal(out.changes.length,0);
});
test('Phone: initial status failure shows error, not private cache',async()=>{
  const out=await runPhone({fail:true});
  assert.equal(out.ok,false);
  assert.equal(out.rendered.length,0);
  assert.match(out.changes.at(-1).title,/팀챗 연결/);
});
test('Phone: combined and confirmed-unjoined modes render after status verification',async()=>{
  assert.deepEqual((await runPhone()).rendered[0].map(x=>x.id),[1,'shared:2']);
  assert.deepEqual((await runPhone({joined:false})).rendered[0].map(x=>x.id),[1]);
});
