const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeHandler,credentials}=require('../../apps/mobile/api/_lib/shared-team-chat-files.cjs');
const {uid}=require('./fixture.cjs');
function response(){return {statusCode:200,headers:{},bytes:[],setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;this.headersSent=true;return this;},write(v){this.bytes.push(v);this.headersSent=true;},end(v){if(v)this.bytes.push(v);this.ended=true;}};}
const request=(method,body)=>({method,body,query:{attachmentId:uid(4)},headers:{'x-olli-session-token':'session','x-olli-academy-id':uid(1),'x-olli-room-id':uid(2)}});
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
test('secret API keys are only sent in apikey; legacy JWT keys retain bearer header',()=>{
  assert.deepEqual(credentials('sb_secret_test'),{apikey:'sb_secret_test'});
  assert.equal(credentials('eyJ.test').Authorization,'Bearer eyJ.test');
});
test('denied attachment never touches storage or exposes server error details',async()=>{
  const calls=[];const handler=makeHandler({base:'https://test-branch.supabase.co',key:()=> 'sb_secret_test',fetchImpl:async(url,init)=>{calls.push({url,init});return new Response('{"message":"sensitive internal error"}',{status:403});}});
  const res=response();await handler(request('GET'),res);assert.equal(res.statusCode,403);assert.equal(calls.length,1);
  assert.ok(calls[0].url.endsWith('/rpc/olli_shared_chat_file_access'));assert.equal(JSON.stringify(res.body).includes('sensitive'),false);
  assert.ok(calls[0].url.startsWith('https://test-branch.supabase.co/'));
});
test('download is streamed via a server-only short-lived signed storage URL after reauthorization',async()=>{
  const calls=[];const path=`${uid(2)}/${uid(3)}/${uid(4)}`;
  const handler=makeHandler({base:'https://test-branch.supabase.co',key:()=> 'sb_secret_test',fetchImpl:async(url,init)=>{
    calls.push({url,init});
    if(url.includes('/rpc/'))return json({ok:true,storage_path:path,file_name:'학생명.html',file_size:4});
    if(init?.method==='POST'&&url.includes('/object/sign/'))return json({signedURL:'/object/sign/olli_shared_chat_files/'+path+'?token=opaque'});
    if(url.includes('?token=opaque'))return new Response('FILE');
    throw new Error('Unexpected storage operation');
  }});const res=response();await handler(request('GET'),res);
  assert.equal(calls.filter(c=>c.url.includes('/rpc/')).length,2);
  assert.equal(calls.filter(c=>c.url.includes('/object/sign/')).length,2);
  assert.equal(Buffer.concat(res.bytes).toString(),'FILE');
  assert.equal(res.headers['Content-Length'],'4');
  assert.equal(res.headers['Content-Type'],'application/octet-stream');assert.match(res.headers['Cache-Control'],/no-store/);
  assert.match(res.headers['Content-Disposition'],/^attachment;/);
  assert.equal(calls.some(c=>c.init?.headers?.Authorization),false);
  assert.equal(calls.find(c=>c.url.includes('?token=opaque')).init.headers.apikey,undefined);
  assert.equal(JSON.stringify(res).includes('opaque'),false);
});
test('leave/delete between storage fetch and response blocks download',async()=>{
  let checks=0;const path=`${uid(2)}/${uid(3)}/${uid(4)}`;
  const handler=makeHandler({key:()=> 'sb_secret_test',fetchImpl:async(url,init)=>{
    if(url.includes('/rpc/')){
      if(++checks===2)return new Response('{}',{status:403});
      return json({ok:true,storage_path:path,file_name:'a.txt'});
    }
    if(init?.method==='POST')return json({signedURL:'/object/sign/olli_shared_chat_files/'+path+'?token=opaque'});
    return new Response('PRIVATE');
  }});const res=response();await handler(request('GET'),res);
  assert.equal(checks,2);assert.equal(res.statusCode,403);assert.equal(res.bytes.length,0);
});
test('oversize metadata and uploaded-size mismatch cannot commit a file message',async()=>{
  const calls=[];const handler=makeHandler({key:()=> 'sb_secret_test',fetchImpl:async(url)=>{
    calls.push(url);if(url.includes('/rpc/'))return json({ok:true,storage_path:`${uid(2)}/${uid(3)}/${uid(4)}`,file_size:100});
    return new Response(null,{headers:{'content-length':'99'}});
  }});const oversized=response();await handler(request('POST',{action:'prepare',file_name:'x',file_size:20971521}),oversized);
  assert.equal(oversized.statusCode,400);assert.equal(calls.length,0);
  const mismatch=response();await handler(request('POST',{action:'commit',attachment_id:uid(4)}),mismatch);
  assert.equal(mismatch.statusCode,403);assert.equal(calls.some(c=>c.includes('file_commit')),false);
});
test('signed upload URL must stay on the dedicated bucket and trusted storage origin',async()=>{
  const handler=makeHandler({key:()=> 'sb_secret_test',fetchImpl:async(url)=>url.includes('/rpc/')
    ?json({ok:true,attachment_id:uid(4),storage_path:`${uid(2)}/${uid(3)}/${uid(4)}`})
    :json({url:'https://attacker.test/upload'})});
  const res=response();await handler(request('POST',{action:'prepare',file_name:'a.txt',file_size:4,mime_type:'text/plain'}),res);
  assert.equal(res.statusCode,403);assert.equal(JSON.stringify(res.body).includes('attacker'),false);
});
test('retry after a lost commit response returns the already authorized file message',async()=>{
  const calls=[];const handler=makeHandler({key:()=> 'sb_secret_test',fetchImpl:async(url)=>{calls.push(url);return json({ok:true,message_id:42});}});
  const res=response();await handler(request('POST',{action:'commit',attachment_id:uid(4)}),res);
  assert.equal(res.statusCode,200);assert.equal(res.body.message_id,42);assert.equal(calls.length,1);
});

test('untrusted signed URL cannot redirect server to external host',async()=>{
  const path=`${uid(2)}/${uid(3)}/${uid(4)}`;
  const calls=[];
  const handler=makeHandler({key:()=> 'sb_secret_test',fetchImpl:async(url,init)=>{
    calls.push(url);
    if(url.includes('/rpc/'))return json({ok:true,storage_path:path,file_name:'a.jpg'});
    return json({signedURL:'https://evil.example/object/sign/olli_shared_chat_files/'+path+'?token=x'});
  }});
  const res=response();await handler(request('GET'),res);
  assert.equal(res.statusCode,403);assert.equal(calls.length,2);assert.equal(res.bytes.length,0);
});
