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
    +'let olliTalkRenderedMessageLimit=100;let olliTalkHistoryExhausted=false;let olliTalkInitialCombinedPaintPending=false;';
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

test('phone first entry never paints a stale shared cache before latest server snapshot',()=>{
  const openStart=phone.indexOf('  async function openOlliTalkBetaPage(event){');
  const openEnd=phone.indexOf('  async function closeOlliTalkBetaPage(',openStart);
  assert.ok(openStart>0&&openEnd>openStart);
  const opening=phone.slice(openStart,openEnd);
  assert.match(opening,/const openCachedPayload = readOlliTalkMessageCache\(openContext\)/);
  assert.match(opening,/setOlliTalkLoadingState\(\)/);
  assert.match(opening,/loadOlliTalkBetaMessages\(\{/);
  assert.doesNotMatch(opening,/readCachedUnified\(\)/);
  assert.doesNotMatch(opening,/renderOlliTalkServerMessages\(combined/);
  assert.match(phoneLoader,/const \[payload,extension\]=await Promise\.all\(\[/);
});
test('PC first entry paints only the latest verified combined server snapshot',()=>{
  const source=pc.slice(pc.indexOf('  async function open() {'),pc.indexOf('  function start() {'));
  assert.match(source,/state\.messageViewContextKey='';/);
  assert.match(source,/emptyState\('통합 대화를 확인하는 중이에요'/);
  assert.match(pcLoader,/const \[payload,extension\]=await Promise\.all\(\[/);
  assert.doesNotMatch(pcLoader,/readCachedUnified\(\)/);
  assert.doesNotMatch(pcLoader,/renderedCachedCombined/);
});
test('latest-message fetch is concurrent on both clients, not sequential after cached rendering',async()=>{
  const sharedResolvers=[];
  for(const client of ['PC','phone']){
    const privateMsg={id:1,academy_id:'academy',created_at:'2026-11-20T00:00:00Z'};
    const latest={id:'shared:newest',created_at:'2026-11-21T12:00:00Z'};
    let resolveShared;
    const sharedGate=new Promise(resolve=>{resolveShared=resolve;});
    const renders=[];
    const global={OlliSharedTeamChat:{unifiedExtension:()=>sharedGate}};
    let fn;
    if(client==='PC'){
      const state={messageLoadSequence:0,messageViewContextKey:'',messages:[]};
      const el={replaceChildren(){}};
      const args={
        state,context:()=>ctx,teamTalkContextKey:scope,byId:()=>el,
        emptyState:title=>({title}),
        rpc:async()=>({ok:true,messages:[privateMsg]}),
        global,renderMessages:p=>renders.push(p.messages),
        isVisible:()=>false,markRead:async()=>true,refreshBadge:async()=>true,
        console:{warn(){}}
      };
      fn=new Function(...Object.keys(args),pcLoader+';return loadMessages')(...Object.values(args));
    }else{
      const cache={ok:true,academy_id:'academy',messages:[privateMsg]};
      const args={
        getOlliTalkBetaContext:()=>ctx,
        readOlliTalkMessageCache:()=>cache,
        document:{getElementById:()=>({replaceChildren(){}})},
        isOlliTalkBetaVisible:()=>false,setOlliTalkLoadingState:()=>{},
        createOlliTalkEmptyState:title=>({title}),
        callOlliTalkRpc:async()=>({ok:true,academy_id:'academy',messages:[privateMsg]}),
        mergeOlliTalkMessagePayloads:(_old,next)=>next,
        areOlliTalkMessagePayloadsEquivalent:()=>false,
        areOlliTalkMessagePayloadsRenderEquivalent:()=>false,
        isOlliTalkMessageListInSync:()=>false,
        writeOlliTalkMessageCache:()=>{},
        renderOlliTalkServerMessages:p=>renders.push(p.messages),
        syncOlliTalkRenderedUnreadCounts:()=>{},
        markOlliTalkMessagesRead:async()=>true,
        refreshOlliTalkMentionBadge:async()=>true,
        console:{warn(){}},
        window:global
      };
      const init="let olliTalkLoadSequence=0;let olliTalkCurrentPayload=null;let olliTalkCurrentViewPayload=null;let olliTalkSharedViewSignature='';let olliTalkRenderedMessageLimit=100;let olliTalkHistoryExhausted=false;let olliTalkInitialCombinedPaintPending=false;";
      fn=new Function(...Object.keys(args),init+phoneLoader+';return loadOlliTalkBetaMessages')(...Object.values(args));
    }
    const pending=fn({showLoading:false,initialCombinedPaint:true});
    await Promise.resolve();
    assert.equal(renders.length,0,client+' must not paint before the shared latest response');
    resolveShared({joined:true,room:{id:'room',participation_id:'part'},messages:[latest],latestSeq:0});
    assert.equal(await pending,true);
    assert.equal(renders.length,1,client+' should paint exactly once');
    assert.deepEqual(Array.from(renders[0],item=>item.id),[1,'shared:newest']);
  }
});
