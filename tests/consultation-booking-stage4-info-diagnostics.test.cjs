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
 assert.match(details,/학원명 확인 불가/);
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
 assert.doesNotMatch(ok,/진단:|학원명 확인 불가/);
 for(const page of ['apps/pc/consultation-booking.html','apps/mobile/consultation-booking.html']){
  const html=fs.readFileSync(path.join(base,page),'utf8');
  assert.match(html,/olli-booking-guardian\.js\?v=20261026-diagnostics-1/);
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
