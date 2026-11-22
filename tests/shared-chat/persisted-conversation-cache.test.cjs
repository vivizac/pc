'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createRequire}=require('node:module');
const requireBrowser=createRequire(path.resolve(__dirname,'package.json'));
const {chromium}=requireBrowser('playwright');
const sharedScript=path.resolve(__dirname,'../../packages/common/olli-shared-team-chat.js');
const origin='https://olli-persisted-teamchat.test';

async function boot(page){
  await page.route('**/*',route=>{
    if(route.request().url().startsWith(origin))
      return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Team Chat Cache</title>'});
    return route.abort();
  });
  await page.goto(origin);
  await loadRuntime(page);
}
async function loadRuntime(page){
  await page.evaluate(()=>{
    for(const [key,value] of Object.entries({
      olli_account_id_v1:'account-1',
      olli_account_session_token_v1:'session-1',
      olli_current_academy_id:'academy-1',
      olli_current_member_id:'member-1'
    }))if(!localStorage.getItem(key))localStorage.setItem(key,value);
    window.OlliStorageCore={AcademyContext:{getCurrent:()=>({
      academyId:localStorage.getItem('olli_current_academy_id'),
      memberId:localStorage.getItem('olli_current_member_id'),contextVersion:1
    })}};
    window.SUPABASE_URL='https://unused-supabase.test';
    window.SUPABASE_KEY='test-anon';
    window.__rpcCalls=0;
    window.fetch=async()=>{window.__rpcCalls++;throw Error('Local cache reader must not call Supabase');};
  });
  await page.addScriptTag({path:sharedScript});
}
const message=(id,body,extra={})=>({
  id,body,created_at:'2026-11-22T03:00:00Z',message_type:'text',...extra
});
const privatePayload={
  ok:true,academy_id:'academy-1',current_member_id:'member-1',
  messages:[message(1,'학원 비공개', {academy_id:'academy-1'})]
};
const combinedPayload={
  ...privatePayload,__academyLocal:privatePayload,
  messages:[...privatePayload.messages,message('shared:2','통합 메시지',{
    is_shared:true,academy_id:'academy-2',branch_name:'상인점'
  })]
};
const room={id:'room-1',participation_id:'participation-1'};

test('actual IndexedDB cold restart paints the saved combined snapshot without a network status check',async t=>{
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const page=await browser.newPage();
  t.after(()=>page.close());
  await boot(page);
  assert.equal(await page.evaluate(async({payload,room})=>
    window.OlliSharedTeamChat.writeCachedConversation(payload,{joined:true,room}),
    {payload:combinedPayload,room}),true);
  await page.reload();
  await loadRuntime(page);
  const result=await page.evaluate(async()=>{
    const cached=await window.OlliSharedTeamChat.readCachedConversation();
    return {joined:cached?.joined,fromCache:cached?.fromCache,
      messages:cached?.payload?.messages.map(item=>item.body),
      privateMessages:cached?.payload?.__academyLocal?.messages.map(item=>item.body),
      calls:window.__rpcCalls};
  });
  assert.deepEqual(result,{joined:true,fromCache:true,
    messages:['학원 비공개','통합 메시지'],privateMessages:['학원 비공개'],calls:0});
});

test('cached conversations are scoped by account, academy and member and new verified lists replace stale shared content',async t=>{
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const page=await browser.newPage();
  t.after(()=>page.close());
  await boot(page);
  await page.evaluate(async({payload,room})=>
    window.OlliSharedTeamChat.writeCachedConversation(payload,{joined:true,room}),
    {payload:combinedPayload,room});
  const result=await page.evaluate(async()=>{
    const saved=localStorage.getItem('olli_account_id_v1');
    localStorage.setItem('olli_account_id_v1','another-account');
    const wrongAccount=await window.OlliSharedTeamChat.readCachedConversation();
    localStorage.setItem('olli_account_id_v1',saved);
    localStorage.setItem('olli_current_academy_id','another-academy');
    const wrongAcademy=await window.OlliSharedTeamChat.readCachedConversation();
    localStorage.setItem('olli_current_academy_id','academy-1');
    localStorage.setItem('olli_current_member_id','another-member');
    const wrongMember=await window.OlliSharedTeamChat.readCachedConversation();
    localStorage.setItem('olli_current_member_id','member-1');
    const nonJoined={ok:true,academy_id:'academy-1',current_member_id:'member-1',
      messages:[{id:1,body:'학원 비공개',academy_id:'academy-1',created_at:'2026-11-22T03:00:00Z'}]};
    await window.OlliSharedTeamChat.writeCachedConversation(nonJoined,{joined:false});
    const current=await window.OlliSharedTeamChat.readCachedConversation();
    return {wrongAccount,wrongAcademy,wrongMember,joined:current.joined,
      messages:current.payload.messages.map(item=>item.body),calls:window.__rpcCalls};
  });
  assert.equal(result.wrongAccount,null);
  assert.equal(result.wrongAcademy,null);
  assert.equal(result.wrongMember,null);
  assert.equal(result.joined,false);
  assert.deepEqual(result.messages,['학원 비공개']);
  assert.equal(result.calls,0);
});

const pcRuntime=path.resolve(__dirname,'../../apps/pc/pc-team-talk.js');

test('PC cold open paints actual IndexedDB conversation before the delayed server list',async t=>{
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const page=await browser.newPage();
  t.after(()=>page.close());
  await boot(page);
  await page.evaluate(async({payload,room})=>
    window.OlliSharedTeamChat.writeCachedConversation(payload,{joined:true,room}),
    {payload:combinedPayload,room});
  await page.reload();
  await loadRuntime(page);
  await page.evaluate(()=>{
    document.body.innerHTML='<div id="olliPcShell" data-pc-section="talk">'
      +'<div id="olliPcTeamTalkScreen" style="display:none">'
      +'<div id="olliPcTeamTalkMessages"></div>'
      +'<span id="olliPcTeamTalkMemberCount"></span>'
      +'</div></div>';
    window.OlliPcCore={hideMainScreensExcept(){}};
    const roomId='room-1',part='participation-1';
    window.fetch=async url=>{
      window.__rpcCalls++;
      const name=String(url).split('/').at(-1);
      const data=name==='olli_shared_chat_status'
        ? {ok:true,enabled:true,room:{id:roomId,participation_id:part,academies:[]}}
        : name==='olli_shared_chat_list'
          ? {ok:true,room_id:roomId,participation_id:part,messages:[
              {id:2,seq:2,body:'통합 메시지',message_type:'text',
                sender_member_id:'other',created_at:'2026-11-22T03:00:00Z'},
              {id:3,seq:3,body:'서버 새 메시지',message_type:'text',
                sender_member_id:'other',created_at:'2026-11-22T03:01:00Z'}
            ]}
          : {ok:true,members:[],unread_count:0};
      return new Response(JSON.stringify(data),{status:200,
        headers:{'Content-Type':'application/json'}});
    };
    window.supabase=async(_method,path)=>{
      const name=path.split('/').at(-1);
      if(name==='olli_team_chat_list'){
        await new Promise(resolve=>setTimeout(resolve,240));
        return {ok:true,academy_id:'academy-1',current_member_id:'member-1',
          messages:[{id:1,body:'학원 비공개',message_type:'text',
            academy_id:'academy-1',sender_member_id:'member-1',
            created_at:'2026-11-22T03:00:00Z'}]};
      }
      if(name==='olli_team_chat_members')return {ok:true,members:[]};
      if(name==='olli_team_chat_archive')return {ok:true,messages:[]};
      return {ok:true,messages:[],members:[],unread_count:0};
    };
  });
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addScriptTag({path:pcRuntime});
  const result=await page.evaluate(async()=>{
    const body=document.getElementById('olliPcTeamTalkMessages');
    const samples=[];
    const observer=new MutationObserver(()=>samples.push(body.textContent));
    observer.observe(body,{childList:true,subtree:true});
    await window.OlliPcTeamTalk.open();
    observer.disconnect();
    return {samples,finalText:body.textContent};
  });
  assert.deepEqual(errors,[]);
  const localIndex=result.samples.findIndex(value=>
    value.includes('통합 메시지')&&value.includes('학원 비공개')
      &&!value.includes('서버 새 메시지'));
  const latestIndex=result.samples.findIndex(value=>value.includes('서버 새 메시지'));
  assert.ok(localIndex>=0,'persisted private and shared messages paint before server reply: '+JSON.stringify(result.samples));
  assert.ok(latestIndex>localIndex,'new server message is only applied afterward');
  assert.ok(result.finalText.includes('서버 새 메시지'));
  assert.ok(!result.samples.slice(0,localIndex+1).some(value=>value.includes('통합 대화를 확인하는 중')),
    'cached first paint must not show a loading placeholder');
});
