'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(base,'packages/common/olli-booking-guardian.js'),'utf8');
const academy='0123456789abcdef0123456789abcdef0123';

async function render(fetchFn, debug){
 const root={innerHTML:'',addEventListener(){}};
 const win={
  document:{getElementById:()=>root},
  location:{search:'?academy='+academy+(debug?'&booking_debug=1':'')},
  fetch:fetchFn
 };
 vm.runInNewContext(source,{window:win,URLSearchParams,Intl,Date,Map});
 await new Promise(resolve=>setImmediate(resolve));
 return root.innerHTML;
}
test('information failure exposes safe status only on diagnostic URL',async()=>{
 const rejected=()=>Promise.resolve({status:403,ok:false,
  json:async()=>({ok:false,code:'ORIGIN_FORBIDDEN'})});
 const details=await render(rejected,true);
 assert.match(details,/상담 예약 페이지를 열 수 없습니다/);
 assert.match(details,/진단: ORIGIN_FORBIDDEN \/ HTTP 403/);
 const publicView=await render(rejected,false);
 assert.match(publicView,/요청의 출처를 확인할 수 없습니다/);
 assert.doesNotMatch(publicView,/진단:|HTTP 403/);
});
test('browser fetch failures are categorized without leaking browser errors',async()=>{
 const result=await render(()=>Promise.reject(new TypeError('Network failed with sensitive parameters')),true);
 assert.match(result,/진단: NETWORK_REQUEST_FAILED/);
 assert.doesNotMatch(result,/sensitive parameters/);
 const invalid=await render(()=>Promise.resolve({status:502,ok:false,
  json:async()=>{throw Error('not json');}}),true);
 assert.match(invalid,/진단: SERVICE_RESPONSE_INVALID \/ HTTP 502/);
});
test('successful info response and both page entry points remain unchanged',async()=>{
 const ok=await render(()=>Promise.resolve({status:200,ok:true,json:async()=>({
  ok:true,academy_name:'비비작아이성향미술학원',weeks:[2,3],weekdays:[1,2,3,4,5]
 })}),true);
 assert.match(ok,/비비작아이성향미술학원/);
 assert.doesNotMatch(ok,/진단:|학원명 확인 중|ogbBoot/);
 for(const page of ['apps/pc/consultation-booking.html','apps/mobile/consultation-booking.html']){
  const html=fs.readFileSync(path.join(base,page),'utf8');
  assert.match(html,/olli-booking-guardian\.js\?v=20261027-boot-loading-1/);
 }
 assert.doesNotMatch(source,/localStorage\.|sessionStorage\./);
});
test('server rejects unmatched Origin without altering authorization rules',async()=>{
 const handler=require('../packages/common/api/_lib/olli-booking-public-handler.cjs');
 const response={statusCode:0,body:null,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 const originalWarn=console.warn,logs=[];
 console.warn=(...args)=>logs.push(args);
 try {
  await handler.createHandler({fetchFn:async()=>{throw Error('should not fetch');},env:{}})({
   method:'POST',
   headers:{origin:'https://other.example.org',host:'booking.example.org'},
   body:{action:'info',academy}
  },response);
 }finally{console.warn=originalWarn;}
 assert.equal(response.statusCode,403);
 assert.deepEqual(response.body,{ok:false,code:'ORIGIN_FORBIDDEN'});
 assert.equal(logs[0][0],'OLLI_BOOKING_PUBLIC_ORIGIN_REJECTED');
 assert.equal(logs[0][1].originMatchesHost,false);
 assert.equal(Object.keys(logs[0][1]).includes('origin'),false);
});


test('Vercel allows exact configured guardian public origin despite internal Host mismatch',async()=>{
 const server=require('../packages/common/api/_lib/olli-booking-public-handler.cjs');
 const origin='https://pc-seven-silk.vercel.app';
 const slug=academy;
 const makeRes=()=>({statusCode:0,body:null,setHeader(){},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}});
 const env={VERCEL:'1',OLLI_BOOKING_PUBLIC_ORIGIN:origin,SUPABASE_SECRET_KEY:'test-only'};
 const handler=server.createHandler({env,fetchFn:async(url,options)=>({
  ok:true,json:async()=>({ok:true,academy_name:'비비작아이성향미술학원',weeks:[2,3],weekdays:[1,2,3,4,5]})
 })});
 const resp=makeRes();
 await handler({method:'POST',headers:{origin,host:'pc-internal-deployment.vercel.app','x-forwarded-host':'pc-seven-silk.vercel.app'},
  body:{action:'info',academy:slug}},resp);
 assert.equal(resp.statusCode,200);
 assert.equal(resp.body.academy_name,'비비작아이성향미술학원');
 assert.deepEqual(resp.body.weekdays,[1,2,3,4,5]);
});
test('Origin security denies unapproved domains, spoofed forwarding and non-Vercel mismatch',async()=>{
 const server=require('../packages/common/api/_lib/olli-booking-public-handler.cjs');
 const canonical='https://pc-seven-silk.vercel.app';
 const makeRes=()=>({statusCode:0,body:null,setHeader(){},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}});
 const configs=[
  {origin:'https://evil.example',host:'pc-internal.vercel.app','x-forwarded-host':'pc-seven-silk.vercel.app'},
  {origin:'https://pc-seven-silk.vercel.app.evil.example',host:'pc-internal.vercel.app'},
  {origin:'http://pc-seven-silk.vercel.app',host:'pc-internal.vercel.app'},
  {origin:'null',host:'pc-internal.vercel.app'},
  {origin:'https://pc-seven-silk.vercel.app/',host:'pc-internal.vercel.app'}
 ];
 const originalWarn=console.warn;console.warn=()=>{};
 try{
  for(const headers of configs){
   const h=server.createHandler({env:{VERCEL:'1',OLLI_BOOKING_PUBLIC_ORIGIN:canonical},
    fetchFn:async()=>{throw Error('Must reject before network');}});
   const res=makeRes();
   await h({method:'POST',headers,body:{action:'info',academy}},res);
   assert.equal(res.statusCode,403,'must reject '+headers.origin);
   assert.deepEqual(res.body,{ok:false,code:'ORIGIN_FORBIDDEN'});
  }
  // Missing optional Vercel system variables must not block a strictly
  // configured public HTTPS origin. The canonical allowlist still applies.
  for(const flag of [undefined,'0','1']){
   const runtime={OLLI_BOOKING_PUBLIC_ORIGIN:canonical,SUPABASE_SECRET_KEY:'test-only'};
   if(flag!==undefined)runtime.VERCEL=flag;
   const handler=server.createHandler({env:runtime,fetchFn:async()=>({
    ok:true,json:async()=>({ok:true,academy_name:'비비작아이성향미술학원'})
   })});
   const res=makeRes();
   await handler({method:'POST',headers:{origin:canonical,host:'different.vercel.app'},
    body:{action:'info',academy}},res);
   assert.equal(res.statusCode,200,'configured origin must work with VERCEL='+flag);
   assert.equal(res.body.academy_name,'비비작아이성향미술학원');
  }
  // No configured allowlist means internal-Host mismatches still fail closed.
  const handler=server.createHandler({env:{VERCEL:'1'},
   fetchFn:async()=>{throw Error('Should not reach database');}});
  const res=makeRes();
  await handler({method:'POST',headers:{origin:canonical,host:'different.vercel.app'},
   body:{action:'info',academy}},res);
  assert.equal(res.statusCode,403);
 }finally{console.warn=originalWarn;}
});


test('guardian POST preserves browser Origin under no-referrer policy without relaxing credential scope',async()=>{
 let captured=null;
 const html=await render((url,options)=>{
  captured={url,options};
  return Promise.resolve({ok:true,status:200,json:async()=>({
   ok:true,academy_name:'비비작아이성향미술학원',
   weeks:[2,3],weekdays:[1,2,3,4,5]
  })});
 },false);
 assert.match(html,/비비작아이성향미술학원/);
 assert.equal(captured.url,'/api/olli-booking-public');
 assert.equal(captured.options.method,'POST');
 assert.equal(captured.options.mode,'cors');
 assert.equal(captured.options.credentials,'same-origin');
 assert.equal(captured.options.cache,'no-store');
 assert.equal(captured.options.headers['Content-Type'],'application/json');
 const payload=JSON.parse(captured.options.body);
 assert.deepEqual(payload,{action:'info',academy});
 for(const page of ['apps/pc/consultation-booking.html','apps/mobile/consultation-booking.html']){
  const sourceHtml=fs.readFileSync(path.join(base,page),'utf8');
  assert.match(sourceHtml,/meta name="referrer" content="no-referrer"/);
  assert.match(sourceHtml,/connect-src 'self'/);
  assert.match(sourceHtml,/olli-booking-guardian\.js\?v=20261027-boot-loading-1/);
 }
 assert.doesNotMatch(source,/localStorage\.|sessionStorage\./);
});


test('academy info loading gates the entire page until data arrives',async()=>{
 let resolveInfo;
 const pending=new Promise(resolve=>{resolveInfo=resolve});
 const root={innerHTML:'',addEventListener(){}};
 vm.runInNewContext(source,{window:{
  document:{getElementById:()=>root},
  location:{search:'?academy='+academy},
  fetch:()=>pending
 },URLSearchParams,Intl,Date,Map});
 assert.match(root.innerHTML,/ogbBoot/);
 assert.match(root.innerHTML,/상담 예약 페이지를 준비하고 있습니다/);
 assert.doesNotMatch(root.innerHTML,/학원명 확인 중|상담 예약하기|기존 예약 변경하기/);
 resolveInfo({status:200,ok:true,json:async()=>({
  ok:true,academy_name:'비비작아이성향미술학원',weeks:[2,3],weekdays:[1,2,3,4,5]
 })});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/비비작아이성향미술학원/);
 assert.match(root.innerHTML,/상담 예약하기/);
 assert.doesNotMatch(root.innerHTML,/ogbBoot|학원명 확인 중/);
});
test('academy failure hides booking actions and retry returns to normal choice',async()=>{
 const handlers={};
 const root={innerHTML:'',addEventListener(type,fn){handlers[type]=fn}};
 let requests=0;
 vm.runInNewContext(source,{window:{
  document:{getElementById:()=>root},
  location:{search:'?academy='+academy+'&booking_debug=1'},
  fetch:async()=>++requests===1
   ?{ok:false,status:503,json:async()=>({ok:false,code:'BOOKING_NOT_AVAILABLE'})}
   :{ok:true,status:200,json:async()=>({ok:true,academy_name:'비비작아이성향미술학원'})}
 },URLSearchParams,Intl,Date,Map});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/다시 시도하기/);
 assert.match(root.innerHTML,/BOOKING_NOT_AVAILABLE \/ HTTP 503/);
 assert.doesNotMatch(root.innerHTML,/ogbChoiceActions|학원명 확인 중|기존 예약 변경하기/);
 const btn={dataset:{action:'retry-academy'},hasAttribute:()=>false};
 await handlers.click({target:{closest:()=>btn}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,2);
 assert.match(root.innerHTML,/비비작아이성향미술학원/);
 assert.match(root.innerHTML,/기존 예약 변경하기/);
 assert.doesNotMatch(root.innerHTML,/다시 시도하기|ogbBoot/);
});
test('HTML entrypoints use same initial splash and shared CSS',()=>{
 for(const pathName of ['apps/pc/consultation-booking.html','apps/mobile/consultation-booking.html']){
  const h=fs.readFileSync(path.join(base,pathName),'utf8');
  assert.match(h,/class="ogbBoot"/);
  assert.match(h,/aria-busy="true"/);
  assert.doesNotMatch(h,/학원명 확인 중/);
  assert.match(h,/olli-booking-guardian\.css\?v=20261027-boot-loading-1/);
  assert.match(h,/olli-booking-guardian\.js\?v=20261027-boot-loading-1/);
 }
 const sheet=fs.readFileSync(path.join(base,'packages/common/olli-booking-guardian.css'),'utf8');
 assert.match(sheet,/\.ogbBootSpinner/);
 assert.match(sheet,/prefers-reduced-motion:reduce/);
});
