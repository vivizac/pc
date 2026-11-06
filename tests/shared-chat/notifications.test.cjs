const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'../..');
test('shared mobile push preserves academy Work/payroll badge state and routes to a separate room event',async()=>{
  const handlers={},posts=[],shown=[];let touchedBadge=false;
  const self={registration:{scope:'https://example.test/',showNotification:async(...args)=>shown.push(args)},
    clients:{matchAll:async()=>[{postMessage:x=>posts.push(x),focus:async()=>{}}]},
    addEventListener:(name,fn)=>handlers[name]=fn,navigator:{setAppBadge:()=>{touchedBadge=true;}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'apps/mobile/olli-push-sw.js'),'utf8'),{self,URL,Response,Intl,Date,caches:{open:()=>{touchedBadge=true;throw Error('must not touch academy badge');}}});
  let pending;
  handlers.push({data:{json:()=>({body:'Do not display private payload',data:{type:'olli-shared-chat',roomId:'room',messageId:1}})},waitUntil:p=>pending=p});await pending;
  assert.equal(touchedBadge,false);assert.equal(posts[0].type,'OLLI_SHARED_CHAT_REFRESH');assert.equal(shown[0][1].body,'공동 대화방에 새 메시지가 있습니다.');
  handlers.notificationclick({notification:{data:{type:'olli-shared-chat',roomId:'room'},close(){}},waitUntil:p=>pending=p});await pending;
  assert.equal(posts.at(-1).type,'OLLI_SHARED_CHAT_OPEN');assert.equal(posts.at(-1).roomId,'room');
});
test('push service authorizes before secrets/delivery and never pushes the shared message body',async()=>{
  let handler;const calls=[],sent=[];
  const source=fs.readFileSync(path.join(root,'supabase/functions/olli-shared-chat-push/index.ts'),'utf8').replace(/^import webpush[^\n]*\n/,'');
  const Deno={env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'sb_secret_test'}[n])},serve:fn=>handler=fn};
  const webpush={setVapidDetails(){},sendNotification:async(subscription,body)=>sent.push({subscription,body:JSON.parse(body)})};
  const sandbox={Deno,webpush,URL,Response,JSON,fetch:async(url,init)=>{
    calls.push({url,init});if(url.endsWith('push_claim'))return new Response(JSON.stringify({ok:true,body:'PRIVATE',targets:[{endpoint:'https://fcm.googleapis.com/push',p256dh:'key',auth:'auth',academy_id:'school'}]}));
    if(url.endsWith('olli_push_server_vapid'))return new Response('{"public_key":"pub","private_key":"priv"}');
    return new Response('null');
  }};
  vm.runInNewContext(stripTypeScriptTypes(source),sandbox);
  const res=await handler(new Request('https://fn.test',{method:'POST',body:JSON.stringify({session_token:'token',academy_id:'school',room_id:'room',message_id:1})}));
  assert.equal(res.status,200);assert.ok(calls[0].url.endsWith('push_claim'));assert.equal(calls.some(c=>c.init.headers.Authorization),false);
  assert.equal(sent.length,1);assert.equal(JSON.stringify(sent).includes('PRIVATE'),false);
  sandbox.fetch=async()=>new Response('{}',{status:403});sent.length=0;
  const denied=await handler(new Request('https://fn.test',{method:'POST',body:JSON.stringify({session_token:'forged',academy_id:'school',room_id:'room',message_id:1})}));
  assert.equal(denied.status,403);assert.equal(sent.length,0);
});
