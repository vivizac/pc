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
test('choice screen precedes calendar; booking shows name and phone before calendar; no OTP',()=>{
 for(const p of ['apps/pc/consultation-booking.html','apps/mobile/consultation-booking.html']){
  const html=fs.readFileSync(path.join(base,p),'utf8');
  assert.match(html,/olli-booking-guardian\.js/);assert.match(html,/noindex,nofollow/);
 }
 assert.match(guardian,/phase:'choice'/);
 assert.match(guardian,/data-action="choose-book"/);
 assert.match(guardian,/data-action="choose-change"/);
 assert.match(guardian,/action:'lookup'/);
 assert.match(guardian,/credentials:'same-origin'/);
 assert.doesNotMatch(guardian,/credentials:'omit'/);
 assert.match(guardian,/PREVIEW_ACCESS_REQUIRED/);
 assert.match(guardian,/name="student_name"/);
 assert.match(guardian,/name="guardian_phone"/);
 assert.match(guardian,/비비작 채널 알림톡을 받고 계신 휴대전화번호를 입력해 주세요/);
 assert.doesNotMatch(guardian,/name="otp"|인증번호|action:'begin'|action:'verify'/);
 assert.doesNotMatch(guardian,/name="age"|name="grade"|name="level"|name="division"/);
 assert.doesNotMatch(guardian,/localStorage\.|sessionStorage\./);
 assert.match(guardian,/action:'slots',academy:slug,date/);
 assert.match(guardian,/state.academyName/);
 assert.doesNotMatch(guardian,/ogbEyebrow">상담 예약/);
 assert.doesNotMatch(guardian,/학생 정보 확인|상담 예약하기를 누르면 올리에 등록된 학생 정보와 대조합니다/);
 assert.match(guardian,/slotStatus==='error'/);
 assert.match(guardian,/allowedDay\(day\)/);
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

test('public info returns academy_name and booking weekdays, never student data',async()=>{
 let rpcName,params;const fn=makeApi(async(url,opt)=>{
  rpcName=url;params=JSON.parse(opt.body);
  return {ok:true,json:async()=>({ok:true,academy_name:'비비작아이성향미술학원',weeks:[2,3],weekdays:[1,2,3,4,5]})};
 });
 const r=await fn({action:'info',academy:slug});
 assert.equal(r.statusCode,200);
 assert.equal(r.body.academy_name,'비비작아이성향미술학원');
 assert.deepEqual(r.body.weeks,[2,3]);assert.deepEqual(r.body.weekdays,[1,2,3,4,5]);
 assert.match(rpcName,/olli_booking_public_info/);
 assert.deepEqual(params,{p_slug:slug});
 assert.equal('student_name' in r.body,false);
 const sql=fs.readFileSync(path.join(base,'supabase/migrations/20261026140000_olli_booking_public_academy_stage4.sql'),'utf8');
 assert.match(sql,/a\.academy_name/);
});
test('QA-only preview supplies visibly marked sample slots, never accepts booking',async()=>{
 const fake=makeApi(async()=>{throw Error('Preview must never reach the real database');},
  {VERCEL_ENV:'preview',OLLI_BOOKING_QA_DEMO:'1',OLLI_BOOKING_QA_ACADEMY_NAME:'비비작아이성향미술학원'});
 const info=await fake({action:'info',academy:slug});
 assert.equal(info.body.demo,true);assert.equal(info.body.academy_name,'비비작아이성향미술학원');
 const date='2026-11-10';
 const slots=await fake({action:'slots',academy:slug,date});
 assert.equal(slots.statusCode,200);assert.equal(slots.body.demo,true);
 assert.equal(slots.body.slots.length,12);
 const request={action:'reserve',academy:slug,student_name:'김하늘',guardian_phone:'01022224444',start_at:'2026-11-10T11:00:00+09:00',request_key:requestKey};
 const reserve=await fake(request);
 assert.equal(reserve.statusCode,503);assert.equal(reserve.body.code,'DEMO_NOT_BOOKABLE');
 const normal=makeApi(async()=>{throw Error('No DB');},{VERCEL_ENV:'production',OLLI_BOOKING_QA_DEMO:'1'});
 const noPreview=await normal(request);
 assert.notEqual(noPreview.body.code,'DEMO_NOT_BOOKABLE');
});

test('QA health probe verifies real preview mode, without DB access or production leak',async()=>{
 const mock=()=>({headers:{},statusCode:null,body:null,setHeader(k,v){this.headers[k]=v;},
   status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}});
 const handler=api.createHandler({
  fetchFn:async()=>{throw Error('QA health must never read DB');},
  env:{...env,VERCEL_ENV:'preview',OLLI_BOOKING_QA_DEMO:'1',OLLI_BOOKING_QA_ACADEMY_NAME:'비비작아이성향미술학원'}
 });
 const req={method:'GET',headers:{host:'qa.example.org'},
  url:'/api/olli-booking-public?qa_health=1&academy='+slug+'&date=2026-11-03'};
 const result=mock();await handler(req,result);
 assert.equal(result.statusCode,200);assert.equal(result.body.demo,true);
 assert.equal(result.body.sample_slot_count,12);
 assert.equal(result.body.academy_name,'비비작아이성향미술학원');
 assert.ok(!('session_token' in result.body));
 const prod=api.createHandler({fetchFn:async()=>{throw Error('No DB');},
  env:{...env,VERCEL_ENV:'production',OLLI_BOOKING_QA_DEMO:'1'}});
 const r2=mock();await prod(req,r2);
 assert.equal(r2.statusCode,404);
});
