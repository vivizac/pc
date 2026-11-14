'use strict';
// Run: node --test apps/pc/tests/olli-makeup-public.test.cjs
// The tests mock Supabase responses; they never write production data.
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/olli-makeup-public.js');
const originalFetch=global.fetch;
const oldEnv={
  SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY,
  OLLI_BOOKING_AUTH_SECRET:process.env.OLLI_BOOKING_AUTH_SECRET,
  OLLI_BOOKING_PUBLIC_ORIGIN:process.env.OLLI_BOOKING_PUBLIC_ORIGIN
};
process.env.SUPABASE_SECRET_KEY='example-key-for-unit-tests';
process.env.OLLI_BOOKING_AUTH_SECRET='unit-test-secret-only-keep-it-long-enough-000001';
process.env.OLLI_BOOKING_PUBLIC_ORIGIN='https://pc-seven-silk.vercel.app';
const slug='0123456789abcdef0123456789abcdef0123';
const id='123e4567-e89b-42d3-a456-426614174000';
function response(body,options={}){
  const out={headers:{},statusCode:0,payload:null,
    setHeader(k,v){this.headers[k]=v;return this;},
    status(n){this.statusCode=n;return this;},
    json(v){this.payload=v;return this;}};
  const req={method:options.method||'POST',
    headers:{host:'pc-seven-silk.vercel.app',
      origin:options.origin||'https://pc-seven-silk.vercel.app'},
    body:body,socket:{remoteAddress:'192.0.2.11'}};
  return handler(req,out).then(()=>out);
}
function mockRpc(map){
  global.fetch=async(url,options)=>{
    const name=url.split('/rpc/')[1],params=JSON.parse(options.body);
    const handlerResult=map[name];
    if(!handlerResult)return {ok:false,status:404,json:async()=>({message:'not configured'})};
    const result=typeof handlerResult==='function'?handlerResult(params):handlerResult;
    if(result.__error)return {ok:false,status:400,json:async()=>result.__error};
    return {ok:true,status:200,json:async()=>result};
  };
}
test.after(()=>{global.fetch=originalFetch;
  for(const [k,v] of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('form input and origin are rejected before any data access',async()=>{
  mockRpc({});
  const wrong=await response({action:'identify',academy:slug,student_name:'김민서',guardian_phone:'abc'});
  assert.equal(wrong.statusCode,400);
  const blocked=await response({action:'info',academy:slug},{origin:'https://evil.example'});
  assert.equal(blocked.statusCode,403);
  assert.equal(blocked.payload.code,'ACCESS_DENIED');
});
test('info returns only public academy name',async()=>{
  mockRpc({olli_booking_public_info:{ok:true,academy_name:'비비작아이성향미술학원'}});
  const r=await response({action:'info',academy:slug});
  assert.equal(r.statusCode,200);
  assert.equal(r.payload.academy_name,'비비작아이성향미술학원');
  assert.equal(r.headers['Cache-Control'].includes('no-store'),true);
});
test('identification is phone scoped; session token never appears in URL',async()=>{
  let params;
  mockRpc({olli_makeup_parent_identify:p=>(params=p,{
    ok:true,student_name:'김민서',division:'elementary',student_id:id})});
  const r=await response({action:'identify',academy:slug,student_name:'김민서',guardian_phone:'010-1234-5678'});
  assert.equal(r.statusCode,200);
  assert.equal(r.payload.student_name,'김민서');
  assert.equal(r.payload.session_token.length,43);
  assert.match(params.p_token_hash,/^[0-9a-f]{64}$/);
  assert.notEqual(params.p_token_hash,r.payload.session_token);
  assert.equal(params.p_guardian_phone,'01012345678');
});
test('bulk submit validates each row and passes one atomic request to RPC',async()=>{
  let params;
  mockRpc({olli_makeup_parent_submit:p=>(params=p,{ok:true,request_id:id})});
  const token='A'.repeat(43);
  const r=await response({action:'submit',session_token:token,request_key:id,
    absences:[{date:'2026-11-18',time_slot:4,group:'A'},
      {date:'2026-11-20',time_slot:5,group:'A'}],
    makeups:[{date:'2026-11-21',time_slot:11,group:'A'}]});
  assert.equal(r.statusCode,200);
  assert.equal(params.p_absences.length,2);
  assert.equal(params.p_makeups.length,1);
  assert.match(params.p_token_hash,/^[0-9a-f]{64}$/);
});
test('duplicate slot and back-end vacancy failures are blocked',async()=>{
  const token='A'.repeat(43);
  const invalid=await response({action:'submit',session_token:token,request_key:id,
    absences:[],makeups:[{date:'2026-11-21',time_slot:11,group:'A'},
      {date:'2026-11-21',time_slot:11,group:'A'}]});
  assert.equal(invalid.statusCode,400);
  mockRpc({olli_makeup_parent_submit:{__error:{code:'P0001',message:'SLOT_UNAVAILABLE'}}});
  const full=await response({action:'submit',session_token:token,request_key:id,
    absences:[],makeups:[{date:'2026-11-21',time_slot:11,group:'A'}]});
  assert.equal(full.statusCode,409);
  assert.equal(full.payload.code,'SLOT_UNAVAILABLE');
});
