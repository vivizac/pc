'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../packages/common/olli-booking-owner-ui.js'),'utf8');
const pc=fs.readFileSync(path.join(__dirname,'../apps/pc/index.html'),'utf8');
const mobile=fs.readFileSync(path.join(__dirname,'../apps/mobile/index.html'),'utf8');
const shell=fs.readFileSync(path.join(__dirname,'../apps/pc/pc-shell.js'),'utf8');
const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/validate-consultation-booking-stage1.yml'),'utf8');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261026103000_olli_booking_staff_stage3.sql'),'utf8');

function setup(owner=true){
 const calls=[];
 const root={style:{display:'none'},dataset:{},innerHTML:'',addEventListener(){}};
 const window={OlliConsultationMessages:{isOwner:()=>owner},callOlliRpc:async(name,body)=>{
  calls.push({name,body});
  if(name!=='olli_booking_staff_manage')throw new Error('Unexpected RPC '+name);
  return {ok:true,appointments:[{id:'44444444-4444-4444-8444-444444444444',
    name:'예약 아이',kind:'student',student_id:'33333333-3333-4333-8333-333333333333',
    start_at:'2026-11-09T02:00:00Z',end_at:'2026-11-09T02:30:00Z',status:'confirmed'}],
    settings:{weeks:[2,3],weekdays:[1,2,3,4,5],start_time:'11:00:00',end_time:'17:00:00',slot_minutes:30,
      allow_parent_cancel:true,allow_parent_reschedule:true,revision:1}};
 },crypto:{randomUUID:()=>'11111111-1111-4111-8111-111111111111'}};
 const document={readyState:'loading',addEventListener(){},getElementById:(id)=>id==='olliConsultationBookingPanel'?root:null};
 const localStorage={getItem:(key)=>({'olli_current_academy_id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'olli_account_session_token_v1':'owner-session'})[key]||''};
 vm.runInNewContext(source,{window,document,localStorage,Intl,Date,console,MutationObserver:class{}});
 return {window,root,calls};
}

test('PC consultation booking is a tab inside 상담기록, not standalone sidebar route',()=>{
 assert.match(pc,/data-pc-nav="consultation"[^>]*[\s\S]*?<span>상담기록<\/span>/);
 assert.doesNotMatch(pc,/data-pc-nav="booking"/);
 assert.doesNotMatch(pc,/id="olliBookingPcScreen"/);
 assert.match(shell,/BOOKING:\s*'booking'/);
 assert.match(source,/getElementById\('olliConsultationBookingPanel'\)/);
 assert.doesNotMatch(shell,/hideMainScreensExcept\('olliBookingPcScreen'\)/);
 assert.match(pc,/olli-booking-owner-ui\.js/);
 const survey=require('node:fs').readFileSync(require('node:path').join(__dirname,'../apps/pc/consultation-survey-core.js'),'utf8');
 assert.match(shell,/consultationTopbarTabs/);
 assert.match(shell,/consultationPageTabBooking/);
 assert.match(shell,/consultationPageTabSurvey/);
 assert.match(shell,/aria-controls="olliConsultationBookingPanel"/);
 assert.match(shell,/aria-controls="olliConsultationSurveyPanel"/);
 assert.match(shell,/상담예약현황/);
 assert.match(shell,/설문기록/);
 assert.doesNotMatch(survey,/<div class="consultationPageTabs"/);
 assert.match(survey,/#olliPcTopbarTitle \\[data-consultation-page-tab\\]/);
 assert.match(survey,/handleConsultationTopbarKeydown/);
 assert.match(survey,/role="tabpanel"/);
});
test('mobile dashboard shortcut is additive and uses dedicated mobile view',()=>{
 assert.match(mobile,/id="recordAcademyDashboard"/);
 assert.match(mobile,/olli-booking-owner-ui\.css/);
 assert.match(mobile,/olli-booking-owner-ui\.js/);
 assert.match(source,/dataset\.olliBookingEntry='true'/);
 assert.match(source,/state\.entryObserver\.observe\(root/);
 assert.match(source,/initMobileShortcut/);
 assert.match(source,/overlay\.hidden=false;mount\(overlay,'mobile'\)/);
 assert.match(source,/role="tablist"/);
 for(const label of ['오늘','이번 주','전체 예약','설정'])assert.ok(source.includes(label));
});

test('owner-only client gate does not call any booking RPC as teacher',async()=>{
 const {window,calls}=setup(false);
 assert.equal(window.OlliBookingDashboard.open('pc'),false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,0);
});

test('PC starts owner-scoped data load, month is YYYY-MM, no fake reservations',async()=>{
 const {window,root,calls}=setup();
 assert.equal(window.OlliBookingDashboard.open('pc'),true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls[0].name,'olli_booking_staff_manage');
 assert.equal(calls[0].body.p_session_token,'owner-session');
 assert.equal(calls[0].body.p_academy_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 assert.match(calls[0].body.p_month,/^\d{4}-(0[1-9]|1[0-2])$/);
 assert.match(root.innerHTML,/상담 현황/);
 assert.match(root.innerHTML,/예약 아이/);
 assert.match(root.innerHTML,/11월 9일\(월\)/);
 assert.match(root.innerHTML,/11:00/);
 assert.doesNotMatch(root.innerHTML,/<small>11월 9일/);
 assert.match(root.innerHTML,/캘린더/);
 assert.match(root.innerHTML,/예약 설정/);
 assert.doesNotMatch(root.innerHTML,/데모 데이터|가상 예약/);
});

test('staff SQL uses tenant authenticated owner and never mutates summary feedback',()=>{
 assert.match(migration,/perform olli_consultation_private\.require_owner\(p_session_token,p_academy_id\)/i);
 assert.match(migration,/where r\.academy_id=p_academy_id/);
 assert.match(migration,/create table public\.olli_booking_staff_mutations/);
 assert.match(migration,/enable row level security/);
 assert.match(migration,/pg_advisory_xact_lock/);
 assert.match(migration,/olli_booking_private\.assert_slot/);
 assert.match(migration,/values\(v_record\.id,p_academy_id,'cancelled','staff'\)/);
 assert.doesNotMatch(migration,/(?:update|delete from|insert into)\s+public\.(?:summary_feedbacks|olli_consultation_summary_jobs)/i);
 assert.match(migration,/revoke all on function public\.olli_booking_staff_manage[\s\S]*from public,anon,authenticated/i);
});

test('both app build manifests stage the SAME common JS and CSS',()=>{
 for(const app of ['pc','mobile']){
   const m=require('../packages/common/'+app+'-runtime-manifest.json');
   assert.ok(m.files.includes('olli-booking-owner-ui.js'));
   assert.ok(m.files.includes('olli-booking-owner-ui.css'));
   assert.ok(m.files.includes('api/_lib/olli-booking-handler.cjs'));
 }
 assert.match(workflow,/consultation-booking-stage3\.integration\.sql/);
 assert.match(workflow,/consultation-booking-stage3-ui\.test\.cjs/);
});
