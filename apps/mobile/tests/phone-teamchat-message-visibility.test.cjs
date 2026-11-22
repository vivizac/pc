const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('olli-talk-beta.js','utf8');
const html=fs.readFileSync('index.html','utf8');

const start=source.indexOf('  async function loadOlliTalkBetaMessages(options = {}){');
const end=source.indexOf('\n  async function loadOlderOlliTalkMessages()',start);
assert.ok(start>0&&end>start,'original phone message loader must be present');
const originalLoader=source.slice(start,end);

function scenario({shared=true}={}){
  const academyId='academy-a';
  const local=[
    {id:1,academy_id:academyId,message_type:'text',body:'일반 메시지',created_at:'2026-11-19T05:01:00Z'},
    {id:2,academy_id:academyId,message_type:'text',body:'@선생님 확인해 주세요',created_at:'2026-11-19T05:02:00Z'}
  ];
  const unified={id:'shared:20',is_shared:true,message_type:'text',body:'@선생님 통합 멘션',created_at:'2026-11-19T05:03:00Z'};
  const rendered=[],cached=[];
  let visibleIds=[];
  const ctx={
    console:{warn:()=>{}},setTimeout,
    window:{OlliSharedTeamChat:{
      unifiedExtension:async()=>shared?{
        joined:true,room:{id:'r1',participation_id:'p1'},messages:[unified],latestSeq:20
      }:{joined:false,messages:[]},
      markUnifiedRead:async()=>true
    }},
    document:{getElementById:()=>({replaceChildren(){}})},
    getOlliTalkBetaContext:()=>({academyId,sessionToken:'fixture',memberId:'member-a'}),
    readOlliTalkMessageCache:()=>null,
    renderOlliTalkCachedMessages:()=>null,
    setOlliTalkLoadingState:()=>{},
    callOlliTalkRpc:async()=>({ok:true,academy_id:academyId,current_member_id:'member-a',messages:local}),
    mergeOlliTalkMessagePayloads:(old,now)=>({...now,messages:[
      ...new Map([...(old.messages||[]),...(now.messages||[])].map(m=>[String(m.id),m])).values()
    ]}),
    areOlliTalkMessagePayloadsEquivalent:(a,b)=>JSON.stringify(a?.messages)===JSON.stringify(b?.messages),
    areOlliTalkMessagePayloadsRenderEquivalent:(a,b)=>JSON.stringify(a?.messages)===JSON.stringify(b?.messages),
    isOlliTalkMessageListInSync:(payload)=>visibleIds.join(',')===payload.messages.map(m=>String(m.id)).join(','),
    getOlliTalkAppendOnlyMessages:()=>null,
    writeOlliTalkMessageCache:(_ctx,payload)=>cached.push(payload),
    renderOlliTalkServerMessages:payload=>{
      rendered.push(payload);
      visibleIds=payload.messages.map(m=>String(m.id));
      ctx.rememberRendered?.(payload);
    },
    syncOlliTalkRenderedUnreadCounts:()=>{},
    isOlliTalkBetaVisible:()=>false,
    refreshOlliTalkMentionBadge:async()=>{},
    markOlliTalkMessagesRead:async()=>{},
    olliTalkHistoryExhausted:false,
    olliTalkRenderedMessageLimit:100
  };
  vm.createContext(ctx);
  vm.runInContext(
    "let olliTalkLoadSequence=0;let olliTalkCurrentPayload=null;let olliTalkCurrentViewPayload=null;let olliTalkSharedViewSignature='';let olliTalkInitialCombinedPaintPending=false;"
    +originalLoader+";globalThis.load=loadOlliTalkBetaMessages;globalThis.sharedSignature=()=>olliTalkSharedViewSignature;globalThis.rememberRendered=payload=>{olliTalkCurrentPayload=payload?.__academyLocal||payload;olliTalkCurrentViewPayload=payload;};",
    ctx
  );
  return {load:ctx.load,rendered,cached,setVisibleIds:ids=>{visibleIds=ids},sharedSignature:ctx.sharedSignature};
}

test('mobile displays normal, academy mention and shared mention messages together',async()=>{
  const x=scenario();
  assert.equal(await x.load(),true);
  assert.deepEqual(Array.from(x.rendered[0].messages,m=>m.id),[1,2,'shared:20']);
  assert.equal(x.rendered[0].messages[1].body,'@선생님 확인해 주세요');
  assert.equal(x.rendered[0].messages[2].body,'@선생님 통합 멘션');
  assert.deepEqual(Array.from(x.cached[0].messages,m=>m.id),[1,2],
    'shared messages must never be persisted to the academy cache');
});

test('unchanged server data must repair missing messages in the actual mobile DOM',async()=>{
  const x=scenario();
  assert.equal(await x.load(),true);
  x.setVisibleIds(['1']);
  assert.equal(await x.load(),true);
  assert.equal(x.rendered.length,2);
  assert.deepEqual(Array.from(x.rendered[1].messages,m=>m.id),[1,2,'shared:20']);
});

test('a render:false local prefetch must not prevent subsequent mention display',async()=>{
  const x=scenario({shared:false});
  assert.equal(await x.load({render:false}),true);
  assert.equal(x.rendered.length,0);
  assert.equal(x.sharedSignature(),'');
  assert.equal(await x.load(),true);
  assert.deepEqual(Array.from(x.rendered[0].messages,m=>m.id),[1,2]);
});

test('a render:false shared prefetch must not acknowledge an unseen unified room',async()=>{
  const x=scenario();
  assert.equal(await x.load({render:false}),true);
  assert.equal(x.rendered.length,0);
  assert.equal(x.sharedSignature(),'');
  assert.equal(await x.load(),true);
  assert.deepEqual(Array.from(x.rendered[0].messages,m=>m.id),[1,2,'shared:20']);
});

test('mobile gallery, history and single-message failures preserve shared messages',()=>{
  assert.match(source,/function getOlliTalkCurrentPresentation\(privatePayload\)/);
  assert.match(source,/renderOlliTalkServerMessages\(getOlliTalkCurrentPresentation\(olliTalkCurrentPayload\)/);
  assert.match(source,/renderOlliTalkServerMessages\(getOlliTalkCurrentPresentation\(current\)/);
  assert.match(source,/renderOlliTalkServerMessages\(getOlliTalkCurrentPresentation\(merged\)/);
  assert.match(source,/const visibleAfterDeletion=currentView===nextChat/);
  assert.match(source,/catch\(error\)\{\s*\/\/ One bad attachment\/action must not hide ordinary chat/);
  assert.match(html,/olli-talk-beta\.js\?v=20261122-persistent-conversation-1/);
});
