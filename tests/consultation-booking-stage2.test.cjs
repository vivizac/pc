'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const backend=require('../packages/common/api/_lib/olli-booking-handler.cjs');
const sql=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261025183000_olli_booking_parent_stage2.sql'),'utf8');
const goodToken='A'.repeat(43);
const academy='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const student='11111111-1111-4111-8111-111111111111';
const reservation='44444444-4444-4444-8444-444444444444';
const requestKey='55555555-5555-4555-8555-555555555555';
function setup(onRpc=()=>({ok:true})){
 const calls=[];
 const fetchFn=async(url,opts)=>{
  calls.push({url,body:JSON.parse(opts.body),headers:opts.headers});
  const next=onRpc(calls.at(-1));
  return {ok:!next.error,status:next.error?400:200,
    json:async()=>next.error?{code:next.error,message:'private information must never leak'}:next};
 };
 const handler=backend.createHandler({fetchFn,env:{
  SUPABASE_SERVICE_ROLE_KEY:'server-key-only',SUPABASE_URL:'https://db.example.test'
 }});
 async function call(body,method='POST',origin){
  const headers={host:'academy.example.test'};
  if(origin)headers.origin=origin;
  let status=0,payload;
  const res={setHeader(){return this;},status(n){status=n;return this;},json(p){payload=p;return p;}};
  await handler({method,headers,body},res);
  return {status,payload};
 }
 return {calls,call};
}

test('issue link generates cryptographic URL-fragment token, DB receives only hash',async()=>{
 const t=setup(()=>({ok:true,link_id:reservation,expires_at:'2026-11-05T00:00:00Z'}));
 const r=await t.call({action:'issue',academy_id:academy,student_id:student,
  session_token:'valid-owner',days_valid:14});
 assert.equal(r.status,200);
 assert.match(r.payload.fragment,/^#token=[A-Za-z0-9_-]{43}$/);
 const sent=t.calls[0].body;
 const token=r.payload.fragment.slice('#token='.length);
 assert.equal(sent.p_token_hash,crypto.createHash('sha256').update(token).digest('hex'));
 assert.ok(!JSON.stringify(sent).includes(token));
 assert.ok(t.calls[0].url.endsWith('/rpc/olli_booking_staff_link_manage'));
 assert.equal(t.calls[0].headers.Authorization,'Bearer server-key-only');
 assert.equal(t.calls[0].body.p_student_id,student);
});

test('parent snapshot can only use token hash, never chooses academy/student',async()=>{
 const t=setup(()=>({ok:true,reservation:null,can_cancel:true}));
 const r=await t.call({action:'snapshot',token:goodToken,academy_id:academy,student_id:student});
 assert.equal(r.status,200);
 assert.deepEqual(Object.keys(t.calls[0].body).sort(),
  ['p_action','p_date','p_request_key','p_reservation_id','p_start_at','p_token_hash'].sort());
 assert.equal(t.calls[0].body.p_token_hash,crypto.createHash('sha256').update(goodToken).digest('hex'));
 assert.equal(t.calls[0].body.p_action,'snapshot');
 assert.equal(r.payload.reservation,null);
});

test('parent reserve and cancel use server RPC with idempotency and exact reservation ID',async()=>{
 const t=setup(()=>({ok:true,reservation_id:reservation,status:'confirmed'}));
 let r=await t.call({action:'reserve',token:goodToken,request_key:requestKey,
  start_at:'2026-11-09T11:00:00+09:00'});
 assert.equal(r.status,200);
 assert.equal(t.calls[0].body.p_start_at,'2026-11-09T11:00:00+09:00');
 assert.equal(t.calls[0].body.p_request_key,requestKey);
 r=await t.call({action:'cancel',token:goodToken,request_key:requestKey,reservation_id:reservation});
 assert.equal(r.status,200);
 assert.equal(t.calls[1].body.p_reservation_id,reservation);
});

test('malformed token, body, origin, method never reach privileged RPC',async()=>{
 const t=setup();
 assert.equal((await t.call({action:'snapshot',token:'guess'})).status,401);
 assert.equal((await t.call({action:'issue',academy_id:academy,student_id:student})).status,401);
 assert.equal((await t.call({action:'reserve',token:goodToken,
   start_at:'2026-11-09T11:00:00+09:00'})).status,400);
 assert.equal((await t.call({action:'snapshot',token:goodToken},'GET')).status,405);
 assert.equal((await t.call({action:'snapshot',token:goodToken},'POST',
    'https://attacker.example.test')).status,403);
 assert.equal((await t.call({action:'snapshot',token:goodToken,
    note:'x'.repeat(8500)})).status,413);
 assert.equal(t.calls.length,0);
});

test('expected database errors are sanitized for parents',async()=>{
 const t=setup(()=>({error:'23P01'}));
 let r=await t.call({action:'reserve',token:goodToken,request_key:requestKey,
   start_at:'2026-11-09T11:00:00+09:00'});
 assert.equal(r.status,409);assert.equal(r.payload.code,'SLOT_UNAVAILABLE');
 assert.ok(!JSON.stringify(r.payload).includes('private information'));
});

test('SQL contract: server-side link validation, scoped writes and atomic ledger',()=>{
 assert.match(sql,/create function public\.olli_booking_parent_request/i);
 assert.match(sql,/create function public\.olli_booking_staff_link_manage/i);
 assert.match(sql,/expires_at>now\(\) and revoked_at is null/i);
 assert.match(sql,/student_id=l\.student_id/);
 assert.match(sql,/intake_id=l\.intake_id/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/create unique index olli_booking_one_live_student/i);
 assert.match(sql,/create unique index olli_booking_one_live_intake/i);
 assert.match(sql,/unique\(link_id,request_key\)/);
 assert.match(sql,/create table public\.olli_booking_mutations/i);
 assert.match(sql,/alter table public\.olli_booking_mutations enable row level security/i);
 assert.match(sql,/revoke all on function public\.olli_booking_parent_request[\s\S]+from public,anon,authenticated/i);
 assert.match(sql,/grant execute on function public\.olli_booking_parent_request[\s\S]+to service_role/i);
 assert.doesNotMatch(sql,/update\s+public\.(?:summary_feedbacks|olli_consultation_summary_jobs)/i);
});

test('PC & mobile use the same handler file via common build manifest',()=>{
 for(const app of ['pc','mobile']){
  const js=fs.readFileSync(path.resolve(__dirname,'../apps/'+app+'/api/olli-booking.js'),'utf8');
  assert.match(js,/require\('\.\/_lib\/olli-booking-handler\.cjs'\)/);
  const m=require('../packages/common/'+app+'-runtime-manifest.json');
  assert.ok(m.files.includes('api/_lib/olli-booking-handler.cjs'));
 }
});
