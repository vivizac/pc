const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createDB,uid}=require('./fixture.cjs');
const root=path.resolve(__dirname,'../..');
for(const width of [390,1280]) test('existing Team Chat hosts the unified conversation at '+width+'px',{timeout:120000},async()=>{
  const db=await createDB();
  await db.exec('update private.olli_shared_chat_release set enabled=true');
  let queue=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/rest/v1/rpc/')){
      let raw='';for await(const chunk of req)raw+=chunk;
      const task=queue.then(async()=>{
        const body=JSON.parse(raw),name=req.url.split('/').at(-1);
        if(!/^olli_shared_chat_[a-z_]+$/.test(name)||Object.keys(body).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Unexpected RPC');
        await db.exec('set role anon');
        try{
          const args=Object.entries(body);
          const sql='select public.'+name+'('+args.map(([key],i)=>key+'=> $'+(i+1)).join(',')+') as result';
          return (await db.query(sql,args.map(([,value])=>value&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value))).rows[0].result;
        }finally{await db.exec('reset role')}
      });queue=task.catch(()=>{});
      try{const data=await task;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data))}
      catch(error){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({message:error.message}))}
      return;
    }
    if(req.url==='/shared.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,'packages/common/olli-shared-team-chat.js')))}
    if(req.url==='/settings.css'){res.setHeader('Content-Type','text/css');return res.end(fs.readFileSync(path.join(root,'packages/common/olli-settings-team-talk-common.css')))}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end([
      '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/settings.css"><body>',
      '<div class="olliTeamTalkSettingsCard" id="integration"></div>',
      '<section id="native-chat"><h2>Team Chat</h2><div id="chat-list"></div><textarea id="native-input" aria-label="메시지 입력"></textarea><button id="native-send">전송</button></section>',
      '<script>window.SUPABASE_URL=location.origin;window.SUPABASE_KEY="test-public";let cleaner;',
      'window.OlliStorageCore={AcademyContext:{getCurrent:()=>({academyId:localStorage.getItem("olli_current_academy_id"),memberId:localStorage.getItem("olli_current_member_id"),contextVersion:Number(localStorage.getItem("context_version")||0)}),registerRuntimeCleaner:fn=>cleaner=fn}};',
      'window.OlliRealtime={watchDomain:(name,fn)=>(window.refreshFromRealtime=fn)};',
      'window.setAccount=(token,academy,member)=>{cleaner?.();localStorage.setItem("olli_account_session_token_v1",token);localStorage.setItem("olli_current_academy_id",academy);localStorage.setItem("olli_current_member_id",member);localStorage.setItem("context_version",Number(localStorage.getItem("context_version")||0)+1)};',
      '</script><script src="/shared.js"></script>',
      '<script>window.OlliPcTeamTalk={open:async()=>window.renderNative()};',
      'window.renderNative=async()=>{const data=await OlliSharedTeamChat.unifiedExtension({messages:true,members:true});const list=document.getElementById("chat-list");list.replaceChildren();if(!data.joined)return false;for(const msg of data.messages){const row=document.createElement("article");row.textContent=msg.sender_name+" · "+msg.branch_name+" : "+msg.body;list.append(row)}return true};',
      'document.getElementById("native-send").onclick=async()=>{const input=document.getElementById("native-input");await OlliSharedTeamChat.sendUnified(input.value,crypto.randomUUID());input.value="";await renderNative()};',
      'window.mountNative=()=>OlliSharedTeamChat.mountSettings(document.getElementById("integration"));',
      '</script></body></html>'
    ].join('\n'));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;const errors=[];
  try{
    browser=await chromium.launch({headless:true,channel:'chromium',...(process.env.OLLI_SHARED_CHAT_BROWSER?{executablePath:process.env.OLLI_SHARED_CHAT_BROWSER}:{})});
    const url='http://127.0.0.1:'+server.address().port;
    async function page(token,academy,member){
      const context=await browser.newContext({viewport:{width,height:860}});
      const p=await context.newPage();p.on('pageerror',error=>errors.push(error.message));
      await p.goto(url);await p.evaluate(([token,academy,member])=>{setAccount(token,academy,member);mountNative()},[token,uid(academy),uid(200+member)]);
      return p;
    }
    const owner=await page('owner',1,1);
    await owner.getByRole('textbox',{name:'학원1 팀챗 표시 이름'}).fill('대천점');
    await owner.locator('[data-academy-id="'+uid(2)+'"] input[type=checkbox]').check();
    await owner.getByRole('textbox',{name:'학원2 팀챗 표시 이름'}).fill('상인점');
    await owner.getByRole('button',{name:'변경사항 저장'}).click();
    await owner.getByRole('status').filter({hasText:'통합 중'}).waitFor();
    await owner.getByRole('textbox',{name:'메시지 입력'}).fill('<img src=x onerror=alert(1)> 안녕하세요');
    await owner.getByRole('button',{name:'전송'}).click();
    await owner.locator('#chat-list article').filter({hasText:'안녕하세요'}).waitFor();
    assert.equal(await owner.locator('#chat-list img').count(),0);
    const teacher=await page('teacherB',2,5);
    assert.equal(await teacher.evaluate(()=>renderNative()),true);
    await teacher.locator('#chat-list article').filter({hasText:'대천점'}).waitFor();
    await teacher.getByRole('textbox',{name:'메시지 입력'}).fill('@전체 상인점 답장');
    await teacher.getByRole('button',{name:'전송'}).click();
    await owner.evaluate(()=>renderNative());
    await owner.locator('#chat-list article').filter({hasText:'상인점 답장'}).waitFor();
    const mentions=await db.query('select count(*)::int n from private.olli_shared_chat_mentions');
    assert.ok(mentions.rows[0].n>=1,'@전체 must mention another academy member');
    assert.equal(await owner.locator('dialog').count(),0,'never open a second Team Chat dialog');
    const third=await page('teacherC',3,6);
    assert.equal(await third.evaluate(()=>renderNative()),false,'unlinked academy cannot see the room');
    assert.equal(await third.locator('#chat-list article').count(),0);
    await owner.getByRole('textbox',{name:'학원1 팀챗 표시 이름'}).fill('실패 시 보존');
    await owner.route('**/rpc/olli_shared_chat_configure',route=>route.fulfill({status:403,contentType:'application/json',body:'{"message":"저장 거부 테스트"}'}));
    await owner.getByRole('button',{name:'변경사항 저장'}).click();
    await owner.getByRole('status').filter({hasText:'저장 거부 테스트'}).waitFor();
    assert.equal(await owner.getByRole('textbox',{name:'학원1 팀챗 표시 이름'}).inputValue(),'실패 시 보존');
    assert.equal(await owner.locator('dialog').count(),0);
    assert.deepEqual(errors,[]);
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.close();
  }
});
