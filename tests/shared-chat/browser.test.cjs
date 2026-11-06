const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createDB,uid}=require('./fixture.cjs');
const root=path.resolve(__dirname,'../..');
for(const width of [390,1280])test(`shared conversation browser → RPC → Postgres at ${width}px`,{timeout:120000},async()=>{
  const db=await createDB();await db.exec('update private.olli_shared_chat_release set enabled=true');
  let queue=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/rest/v1/rpc/')){
      let raw='';for await(const part of req)raw+=part;
      const task=queue.then(async()=>{
        const body=JSON.parse(raw);const name=req.url.split('/').at(-1);
        if(!/^olli_shared_chat_[a-z_]+$/.test(name)||Object.keys(body).some(k=>!/^p_[a-z_]+$/.test(k)))throw new Error('Bad RPC');
        await db.exec('set role anon');
        try{
          const args=Object.entries(body);const query=`select public.${name}(${args.map(([k],i)=>k+'=> $'+(i+1)).join(',')}) as result`;
          return (await db.query(query,args.map(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v))).rows[0].result;
        }finally{await db.exec('reset role');}
      });queue=task.catch(()=>{});
      try{const value=await task;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
      catch(error){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({message:error.message}));}
      return;
    }
    if(req.url.startsWith('/shared.js')){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,'packages/common/olli-shared-team-chat.js')));}
    if(req.url.startsWith('/shared.css')){res.setHeader('Content-Type','text/css');return res.end(fs.readFileSync(path.join(root,'packages/common/olli-shared-team-chat.css')));}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/shared.css"><body>
      <button onclick="OlliSharedTeamChat.manage()">통합 관리 열기</button><button data-shared-chat-entry hidden>공동 대화</button>
      <script>window.SUPABASE_URL=location.origin;window.SUPABASE_KEY='test-public';let cleaner;
      window.OlliStorageCore={AcademyContext:{getCurrent:()=>({academyId:localStorage.getItem('olli_current_academy_id'),memberId:localStorage.getItem('olli_current_member_id'),contextVersion:Number(localStorage.getItem('context_version')||0)}),registerRuntimeCleaner:fn=>cleaner=fn}};
      window.OlliRealtime={watchDomain:(name,fn)=>(window.refreshFromRealtime=fn)};
      window.setAccount=(token,academy,member)=>{cleaner?.();localStorage.setItem('olli_account_session_token_v1',token);localStorage.setItem('olli_current_academy_id',academy);localStorage.setItem('olli_current_member_id',member);localStorage.setItem('context_version',Number(localStorage.getItem('context_version')||0)+1)};
      </script><script src="/shared.js"></script></body></html>`);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{browser=await chromium.launch({headless:true,channel:'chromium',...(process.env.OLLI_SHARED_CHAT_BROWSER?{executablePath:process.env.OLLI_SHARED_CHAT_BROWSER}:{})});}
  catch(error){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.close();throw error;}
  const errors=[];const url='http://127.0.0.1:'+server.address().port;
  async function page(token,school,mem){
    const ctx=await browser.newContext({viewport:{width,height:860}});const page=await ctx.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://fvkxipjwgeyosgnfhdnx.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'{"ok":true}'}));
    await page.goto(url);assert.match(await page.content(),/통합 관리 열기/);
    await page.evaluate(([token,school,mem])=>window.setAccount(token,school,mem),[token,uid(school),uid(200+mem)]);
    return page;
  }
  try{
    const owner=await page('owner',1,1);
    await owner.getByRole('button',{name:'통합 관리 열기'}).click();
    await owner.getByRole('textbox',{name:'학원1 팀챗 표시 이름'}).fill('대천점');
    await owner.locator(`[data-academy-id="${uid(2)}"] input[type=checkbox]`).check();
    await owner.getByRole('textbox',{name:'학원2 팀챗 표시 이름'}).fill('상인점');
    await owner.getByRole('button',{name:'통합 설정 저장'}).click();
    await owner.getByRole('status').filter({hasText:'서버에 저장되었습니다.'}).waitFor();
    await owner.getByRole('button',{name:'내 학원 대화로 돌아가기'}).click();
    await owner.locator('[data-shared-chat-entry]').click();
    await owner.getByRole('status').filter({hasText:/대천점.*상인점|상인점.*대천점/}).waitFor();
    await owner.getByRole('textbox',{name:'공동 메시지 입력'}).fill('<img src=x onerror=alert(1)> 공동 인사');
    await owner.getByRole('button',{name:'전송',exact:true}).click();
    await owner.locator('[data-shared-messages] article').filter({hasText:'공동 인사'}).waitFor();
    assert.equal(await owner.locator('[data-shared-messages] img').count(),0);
    const teacher=await page('teacherB',2,5);
    await teacher.evaluate(()=>OlliSharedTeamChat.refreshEntry());await teacher.locator('[data-shared-chat-entry]').click();
    await teacher.locator('[data-shared-messages] article').filter({hasText:'공동 인사'}).waitFor();
    assert.equal(await teacher.locator('.olliSharedChatBranch').filter({hasText:'대천점'}).count()>0,true);
    await teacher.locator('[data-shared-messages] article').filter({hasText:'공동 인사'}).getByRole('button',{name:'답장',exact:true}).click();
    await teacher.getByRole('textbox',{name:'공동 메시지 입력'}).fill('상인점 답장');
    await teacher.getByRole('button',{name:'전송',exact:true}).click();
    const reply=teacher.locator('[data-shared-messages] article').filter({hasText:'상인점 답장'});
    await reply.waitFor();await reply.getByRole('button',{name:'수정',exact:true}).click();
    await teacher.getByRole('textbox',{name:'공동 메시지 입력'}).fill('수정한 답장');await teacher.getByRole('button',{name:'전송',exact:true}).click();
    await teacher.locator('[data-shared-messages] article').filter({hasText:'수정한 답장'}).waitFor();
    await owner.evaluate(()=>window.refreshFromRealtime());
    await owner.getByText('@멘션 선택',{exact:true}).click();
    await owner.locator(`[data-shared-members] input[value="${uid(205)}"]`).check();
    await owner.getByRole('textbox',{name:'공동 메시지 입력'}).fill('상인점 선생님 멘션');await owner.getByRole('button',{name:'전송',exact:true}).click();
    await owner.locator('[data-shared-messages] article').filter({hasText:'상인점 선생님 멘션'}).waitFor();
    if(process.env.OLLI_SHARED_CHAT_SCREENSHOTS){fs.mkdirSync(process.env.OLLI_SHARED_CHAT_SCREENSHOTS,{recursive:true});
      await owner.screenshot({path:path.join(process.env.OLLI_SHARED_CHAT_SCREENSHOTS,`shared-chat-conversation-${width}.png`)});}
    const mentions=await db.query('select count(*)::int n from private.olli_shared_chat_mentions');assert.equal(mentions.rows[0].n,1);
    await owner.getByRole('button',{name:'내 학원 대화로 돌아가기'}).click();
    await owner.getByRole('button',{name:'통합 관리 열기'}).click();
    await owner.locator(`[data-academy-id="${uid(3)}"] input[type=checkbox]`).check();
    await owner.getByRole('textbox',{name:'학원3 팀챗 표시 이름'}).fill('세번째점');await owner.getByRole('button',{name:'통합 설정 저장'}).click();
    await owner.getByRole('status').filter({hasText:'서버에 저장되었습니다.'}).waitFor();
    const third=await page('teacherC',3,6);await third.evaluate(()=>OlliSharedTeamChat.refreshEntry());await third.locator('[data-shared-chat-entry]').click();
    await third.getByRole('status').filter({hasText:'세번째점'}).waitFor();
    assert.equal(await third.locator('[data-shared-messages] article').count(),1);
    assert.equal(await third.getByText('상인점 선생님 멘션',{exact:true}).count(),0);
    await owner.locator(`[data-academy-id="${uid(3)}"] input[type=checkbox]`).uncheck();await owner.getByRole('button',{name:'통합 설정 저장'}).click();
    await owner.getByRole('status').filter({hasText:'서버에 저장되었습니다.'}).waitFor();
    await third.evaluate(()=>window.refreshFromRealtime());await third.getByRole('status').filter({hasText:'해제되었습니다'}).waitFor();
    assert.equal(await third.locator('[data-shared-messages] article').count(),0);
    assert.equal(await third.getByRole('button',{name:'전송',exact:true}).isDisabled(),true);
    await teacher.evaluate(()=>window.setAccount('outsider','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000207'));
    assert.equal(await teacher.locator('dialog').count(),0);
    assert.equal(await teacher.locator('[data-shared-chat-entry]').isHidden(),true);
    // Save failure preserves input and does not pretend the server accepted it.
    await owner.getByRole('textbox',{name:'학원1 팀챗 표시 이름'}).fill('실패 시 보존');
    await owner.route('**/rpc/olli_shared_chat_configure',route=>route.fulfill({status:403,contentType:'application/json',body:'{"message":"저장 거부 테스트"}'}));
    await owner.getByRole('button',{name:'통합 설정 저장'}).click();await owner.getByRole('status').filter({hasText:'저장 거부 테스트'}).waitFor();
    assert.equal(await owner.getByRole('textbox',{name:'학원1 팀챗 표시 이름'}).inputValue(),'실패 시 보존');
    const bounds=await owner.locator('dialog').boundingBox();assert.ok(bounds.width<=width&&bounds.x>=0);
    const screenshotDir=process.env.OLLI_SHARED_CHAT_SCREENSHOTS;
    if(screenshotDir){fs.mkdirSync(screenshotDir,{recursive:true});await owner.screenshot({path:path.join(screenshotDir,`shared-chat-management-${width}.png`)});}
    await owner.getByRole('button',{name:'내 학원 대화로 돌아가기'}).click();await owner.locator('[data-shared-chat-entry]').click();
    await owner.locator('[data-shared-send]:not([disabled])').waitFor();
    await owner.getByRole('textbox',{name:'공동 메시지 입력'}).fill('오늘 시간표 알려줘');
    await owner.evaluate(()=>{window.OlliPcTeamTalk={open:async()=>{document.body.insertAdjacentHTML('beforeend','<textarea id="olliPcTeamTalkInput"></textarea>');}};});
    await owner.getByRole('button',{name:'올리에게 비공개로 질문'}).click();
    assert.equal(await owner.locator('#olliPcTeamTalkInput').inputValue(),'@올리 오늘 시간표 알려줘');
    assert.equal(await owner.locator('dialog').count(),0);
    await owner.locator('[data-shared-chat-entry]').click();await owner.locator('[data-shared-send]:not([disabled])').waitFor();
    let release,arrived;const gate=new Promise(r=>release=r),arrival=new Promise(r=>arrived=r);
    await owner.route('**/rpc/olli_shared_chat_list',async route=>{arrived();await gate;await route.continue();});
    await owner.evaluate(()=>{window.pendingRefresh=window.refreshFromRealtime();});await arrival;
    await owner.evaluate(()=>window.setAccount('outsider','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000207'));
    release();await owner.evaluate(()=>window.pendingRefresh);
    assert.equal(await owner.locator('dialog').count(),0,'late room responses must not reopen or refill the new academy');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await db.close();}
});
