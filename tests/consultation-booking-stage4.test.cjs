'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const api=require('../packages/common/api/_lib/olli-booking-public-handler.cjs');
const parent=require('../packages/common/api/_lib/olli-booking-handler.cjs');
const base=path.resolve(__dirname,'..');
const guardian=fs.readFileSync(path.join(base,'packages/common/olli-booking-guardian.js'),'utf8');
const sql=fs.readFileSync(path.join(base,'supabase/migrations/20261026140000_olli_booking_public_academy_stage4.sql'),'utf8');
const owner=fs.readFileSync(path.join(base,'packages/common/olli-booking-owner-ui.js'),'utf8');
const slug='0123456789abcdef0123456789abcdef0123';
const academy='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestKey='11111111-1111-4111-8111-111111111117';
function mockResponse(){return {headers:{},statusCode:0,body:null,setHeader(k,v){this.headers[k]=v;},
 status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}};}
const env={SUPABASE_SECRET_KEY:'test-service-secret',SUPABASE_URL:'https://fake.supabase.co',
 OLLI_BOOKING_AUTH_SECRET:'a-booking-auth-secret-longer-than-32-chars',
 OLLI_BOOKING_PUBLIC_ORIGIN:'https://booking.example.org/'};
function makeApi(fetchFn,envOverride={}){
 const handler=api.createHandler({fetchFn,env:{...env,...envOverride}});
 return async body=>{const res=mockResponse();await handler({method:'POST',
  headers:{host:'booking.example.org',origin:'https://booking.example.org'},body,
  socket:{remoteAddress:'192.0.2.12'}},res);return res;};
}
test('calendar is immediate; no OTP, age or grade inputs; name and phone at end',()=>{
 for(const p of ['apps/pc/consultation-booking.html','apps/mobile/consultation-booking.html']){
  const html=fs.readFileSync(path.join(base,p),'utf8');
  assert.match(html,/olli-booking-guardian\.js/);assert.match(html,/noindex,nofollow/);
 }
 assert.match(guardian,/phase:'booking'/);
 assert.match(guardian,/name="student_name"/);
 assert.match(guardian,/name="guardian_phone"/);
 assert.match(guardian,/비비작 채널 알림톡을 받고 계신 휴대전화번호를 입력해 주세요/);
 assert.doesNotMatch(guardian,/name="otp"|인증번호|action:'begin'|action:'verify'/);
 assert.doesNotMatch(guardian,/name="age"|name="grade"|name="level"|name="division"/);
 assert.doesNotMatch(guardian,/localStorage\.|sessionStorage\./);
 assert.match(guardian,/action:'slots',academy:slug,date/);
 assert.match(guardian,/student_name:state.name,guardian_phone:state.phone/);
 assert.match(guardian,/action:'snapshot'/);
 assert.match(guardian,/action:'cancel'/);
});
test('backend only matches on final reserve; no SMS table or verification RPC',()=>{
 assert.match(sql,/create function public\.olli_booking_public_reserve\(/);
 assert.match(sql,/create function public\.olli_booking_public_slots\(/);
 assert.doesNotMatch(sql,/create table public\.olli_booking_public_challenges|create function public\.olli_booking_public_verify/);
 assert.doesNotMatch(sql,/\bp_level\b|\bp_division\b|\bs\.grade\b|\bs\.age\b/);
 assert.match(sql,/v_matches<>1/);
 assert.match(sql,/c\.enabled=true and c\.confirmed=true/);
 assert.match(sql,/regexp_replace\(c\.phone,'\[\^0-9\]','','g'\)=p_guardian_phone/);
});
test('per-academy link unchanged',async()=>{
 const calls=[];const send=makeApi(async(url,opt)=>{
  calls.push(JSON.parse(opt.body));return {ok:true,json:async()=>({ok:true,slug})};
 });
 const a=await send({action:'public-link',academy_id:academy,session_token:'owner-session'});
 const b=await send({action:'public-link',academy_id:academy,session_token:'owner-session'});
 assert.equal(a.statusCode,200);assert.deepEqual(a.body,b.body);
 assert.equal(a.body.url,'https://booking.example.org/consultation-booking.html?academy='+slug);
 assert.ok(!a.body.url.includes('#token='));
 assert.ok(calls.every(x=>x.p_academy_id===academy));
 assert.match(owner,/통합 링크 복사/);
});
test('calendar query does not require guardian name/phone',async()=>{
 let called;const fn=makeApi(async(url,opt)=>{
  called={url,params:JSON.parse(opt.body)};
  return {ok:true,json:async()=>({ok:true,slots:[{start_at:'2026-11-10T02:00:00Z'}]})};
 });
 const r=await fn({action:'slots',academy:slug,date:'2026-11-10'});
 assert.equal(r.statusCode,200);assert.equal(r.body.slots.length,1);
 assert.match(called.url,/olli_booking_public_slots/);
 assert.deepEqual(Object.keys(called.params).sort(),['p_date','p_slug']);
});
test('reserve passes name, phone, start and random token hash only on click',async()=>{
 let called;const fn=makeApi(async(url,opt)=>{
  called={url,params:JSON.parse(opt.body)};
  return {ok:true,json:async()=>({ok:true,existing:false})};
 });
 const r=await fn({action:'reserve',academy:slug,student_name:'김하늘',
  guardian_phone:'010-2222-4444',start_at:'2026-11-10T11:00:00+09:00',
  request_key:requestKey,grade:4,age:9});
 assert.equal(r.statusCode,200);
 assert.match(r.body.session_token,/^[A-Za-z0-9_-]{43}$/);
 assert.match(called.url,/olli_booking_public_reserve/);
 assert.deepEqual(Object.keys(called.params).sort(),[
  'p_slug','p_student_name','p_guardian_phone','p_start_at','p_request_key',
  'p_session_hash','p_ip_digest'].sort());
 assert.equal(called.params.p_guardian_phone,'01022224444');
 assert.match(called.params.p_session_hash,/^[0-9a-f]{64}$/);
 assert.ok(!JSON.stringify(r.body).includes('01022224444'));
});
test('wrong phone and duplicate lookup produce same name/phone warning with no session',async()=>{
 const fn=makeApi(async()=>({ok:true,json:async()=>({ok:false,code:'MATCH_NOT_FOUND'})}));
 const req={action:'reserve',academy:slug,student_name:'김하늘',guardian_phone:'01022224444',
  start_at:'2026-11-10T11:00:00+09:00',request_key:requestKey};
 const r=await fn(req);
 assert.equal(r.statusCode,400);assert.deepEqual(r.body,{ok:false,code:'MATCH_NOT_FOUND'});
 assert.ok(!('session_token' in r.body));
 const otp=await fn({action:'verify',challenge_id:requestKey,code:'123456',academy:slug});
 assert.equal(otp.body.code,'INVALID_ACTION');
});
test('guardian and public API never leak service key or use SMS',()=>{
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
