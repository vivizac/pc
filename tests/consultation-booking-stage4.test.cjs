'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../packages/common/api/_lib/olli-booking-public-handler.cjs');
const parent=require('../packages/common/api/_lib/olli-booking-handler.cjs');
const base=path.resolve(__dirname,'..');
const guardian=fs.readFileSync(path.join(base,'packages/common/olli-booking-guardian.js'),'utf8');
const sql=fs.readFileSync(path.join(base,'supabase/migrations/20261026140000_olli_booking_public_academy_stage4.sql'),'utf8');
const owner=fs.readFileSync(path.join(base,'packages/common/olli-booking-owner-ui.js'),'utf8');
const slug='0123456789abcdef0123456789abcdef0123';
const academy='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function mockResponse(){
  return {headers:{},statusCode:0,body:null,setHeader(k,v){this.headers[k]=v;},
   status(n){this.statusCode=n;return this;},
   json(b){this.body=b;return this;}};
}
const env={SUPABASE_SERVICE_ROLE_KEY:'test-service-secret',SUPABASE_URL:'https://fake.supabase.co',
 OLLI_BOOKING_AUTH_SECRET:'a-booking-auth-secret-longer-than-32-chars',
 OLLI_BOOKING_PUBLIC_ORIGIN:'https://booking.example.org/'};
function makeApi(fetchFn,envOverride={}){
 const handler=api.createHandler({fetchFn,env:{...env,...envOverride}});
 return async body=>{
   const res=mockResponse();await handler({method:'POST',
    headers:{host:'booking.example.org',origin:'https://booking.example.org'},body,
    socket:{remoteAddress:'192.0.2.12'}},res);return res;
 };
}
test('guardian front end has name and phone ONLY and exact Bibi channel guidance',()=>{
 for(const p of ['apps/pc/consultation-booking.html','apps/mobile/consultation-booking.html']){
  const html=fs.readFileSync(path.join(base,p),'utf8');
  assert.match(html,/olli-booking-guardian\.js/);assert.match(html,/noindex,nofollow/);
  assert.match(html,/default-src 'none'/);
 }
 assert.match(guardian,/name="student_name"/);
 assert.match(guardian,/name="guardian_phone"/);
 assert.match(guardian,/비비작 채널 알림톡을 받고 계신 휴대전화번호를 입력해 주세요/);
 assert.doesNotMatch(guardian,/name="age"|name="grade"|name="level"|name="division"|학년|나이/);
 assert.doesNotMatch(guardian,/\b(?:global\.)?localStorage\.|\b(?:global\.)?sessionStorage\./);
 assert.match(guardian,/action:'verify'/);
 assert.match(guardian,/action:'snapshot'/);
 assert.match(guardian,/'reschedule':'reserve'/);
 assert.match(guardian,/'reschedule':'reserve'/);
 assert.match(guardian,/action:'cancel'/);
});
test('Postgres matching signature has no age or grade; confirmed contact and ambiguity guards',()=>{
 assert.match(sql,/create function public\.olli_booking_public_begin\(\s*p_slug text,p_student_name text,\s*p_guardian_phone text/);
 assert.doesNotMatch(sql,/\bp_level\b|\bp_division\b|\bs\.grade\b|\bs\.age\b/);
 assert.match(sql,/v_matches<>1/);
 assert.match(sql,/c\.enabled=true and c\.confirmed=true/);
 assert.match(sql,/regexp_replace\(c\.phone,'\[\^0-9\]','','g'\)=p_guardian_phone/);
 assert.match(sql,/olli_booking_public_verify/);
});
test('public link is one permanent academy URL and not a child-specific token',async()=>{
 let db=[];
 const send=makeApi(async(url,opt)=>{
  db.push({url,body:JSON.parse(opt.body)});
  return {ok:true,json:async()=>({ok:true,slug})};
 });
 const a=await send({action:'public-link',academy_id:academy,session_token:'owner-session'});
 const b=await send({action:'public-link',academy_id:academy,session_token:'owner-session'});
 assert.equal(a.statusCode,200);assert.deepEqual(a.body,b.body);
 assert.equal(a.body.url,'https://booking.example.org/consultation-booking.html?academy='+slug);
 assert.ok(!a.body.url.includes('#token='));
 assert.equal(db.length,2);
 assert.ok(db.every(x=>x.body.p_academy_id===academy));
 assert.match(owner,/통합 링크 복사/);
 assert.match(owner,/학생별 링크를 발급하지 않습니다/);
});
test('public begin posts name+phone only, generic HTTP response hides match and phone',async()=>{
 let forwarded=null;
 const apiFn=makeApi(async(url,opt)=>{
  forwarded=JSON.parse(opt.body);
  return {ok:true,json:async()=>({ok:true,send_to:null})};
 });
 const out=await apiFn({action:'begin',academy:slug,student_name:'김하늘',
  guardian_phone:'010-2222-4444',grade:'6',age:'7',level:5,division:'kinder'});
 assert.equal(out.statusCode,202);
 assert.equal(out.body.ok,true);
 assert.ok(/^[0-9a-f-]{36}$/.test(out.body.challenge_id));
 assert.ok(!JSON.stringify(out.body).includes('김하늘'));
 assert.ok(!JSON.stringify(out.body).includes('01022224444'));
 assert.ok(!Object.hasOwn(out.body,'send_to'));
 assert.deepEqual(Object.keys(forwarded).sort(),[
  'p_challenge_id','p_code_hash','p_guardian_phone','p_ip_digest','p_slug','p_student_name'
 ].sort());
 assert.equal(forwarded.p_student_name,'김하늘');
 assert.equal(forwarded.p_guardian_phone,'01022224444');
 assert.equal(forwarded.p_slug,slug);
});
test('different lookup results produce same public response and never disclose phone',async()=>{
 let match=null;
 const fn=makeApi(async()=>({ok:true,json:async()=>match===null?
  {ok:true,send_to:null}:{ok:true,send_to:'01022224444',academy_id:academy}}));
 const body={action:'begin',academy:slug,student_name:'김하늘',guardian_phone:'01022224444'};
 const one=await fn(body);match=true;const two=await fn(body);
 assert.equal(one.statusCode,202);assert.equal(two.statusCode,202);
 assert.deepEqual(Object.keys(one.body).sort(),Object.keys(two.body).sort());
 assert.equal(one.body.message,two.body.message);
 assert.equal(one.headers['Cache-Control'].includes('no-store'),true);
});
test('OTP verification is required and short-lived bearer stays out of public link',async()=>{
 let calls=[];
 const fn=makeApi(async(url,opt)=>{
  const x=JSON.parse(opt.body);calls.push(x);
  return {ok:true,json:async()=>({ok:true,expires_in_seconds:2700})};
 });
 const ch='22222222-2222-4222-8222-222222222222';
 const r=await fn({action:'verify',challenge_id:ch,code:'123456'});
 assert.equal(r.statusCode,200);
 assert.equal(r.body.expires_in_seconds,2700);
 assert.match(r.body.session_token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(calls[0].p_session_hash.length,64);
 assert.equal(calls[0].p_code_hash.length,64);
 assert.ok(!JSON.stringify(calls[0]).includes('123456'));
 assert.ok(!JSON.stringify(r.body).includes('guardian_phone'));
});
test('no direct browser service key or student id in guardian URL',()=>{
 const v=require('../packages/common/pc-runtime-manifest.json');
 const m=require('../packages/common/mobile-runtime-manifest.json');
 for(const manifest of [v,m]){
  for(const n of ['olli-booking-guardian.js','olli-booking-guardian.css',
    'api/_lib/olli-booking-public-handler.cjs'])assert.ok(manifest.files.includes(n));
 }
 assert.match(parent._test.tokenHash('A'.repeat(43)),/^[0-9a-f]{64}$/);
 assert.doesNotMatch(guardian,/SERVICE_ROLE|SUPABASE_SECRET_KEY|Bearer \+/);
 assert.match(owner,/\/api\/olli-booking-public/);
});
