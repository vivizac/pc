'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const policy=require('../packages/common/olli-booking-policy.cjs');
const sql=fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261025150000_olli_booking_core_stage1.sql'),'utf8');

test('confirmed defaults yield 12 slots with 16:30 as last start',()=>{
 const slots=policy.listBaseSlots('2026-11-09');
 assert.equal(slots.length,12);
 assert.equal(slots[0],'11:00');
 assert.equal(slots.at(-1),'16:30');
 assert.ok(!slots.includes('17:00'));
 assert.equal(policy.DEFAULT_BOOKING_SETTINGS.allowParentCancel,true);
 assert.equal(policy.DEFAULT_BOOKING_SETTINGS.allowParentReschedule,true);
});

test('weeks mean Monday-Sunday calendar rows, including partial first week',()=>{
 assert.equal(policy.calendarWeekOfMonth('2026-11-01'),1); // Sunday
 assert.equal(policy.calendarWeekOfMonth('2026-11-02'),2); // Monday
 assert.equal(policy.calendarWeekOfMonth('2026-11-09'),3); // Monday
 assert.equal(policy.listBaseSlots('2026-11-03').length,12);
 assert.equal(policy.listBaseSlots('2026-11-09').length,12);
 assert.equal(policy.listBaseSlots('2026-11-16').length,0);
 assert.equal(policy.listBaseSlots('2026-11-07').length,0); // Saturday
 assert.equal(policy.listBaseSlots('2026-11-08').length,0); // Sunday
});

test('date validation and academy-local overrides',()=>{
 assert.throws(()=>policy.calendarWeekOfMonth('2026-02-30'),/INVALID_DATE/);
 assert.throws(()=>policy.listBaseSlots('bad'),/INVALID_DATE/);
 const custom={...policy.DEFAULT_BOOKING_SETTINGS,weeks:[1,2,3,4,5,6],weekdays:[6],startTime:'13:00',endTime:'15:00',slotMinutes:60};
 assert.deepEqual(policy.listBaseSlots('2026-11-07',custom),['13:00','14:00']);
 assert.throws(()=>policy.listBaseSlots('2026-11-07',{...custom,timezone:'UTC'}),/UNSUPPORTED_TIMEZONE/);
});

test('migration isolates tenants and enforces DB collision prevention',()=>{
 for(const table of ['olli_booking_settings','olli_booking_blocks','olli_booking_intakes',
  'olli_booking_reservations','olli_booking_links','olli_booking_events']){
   assert.match(sql,new RegExp('create table public\\.'+table+'\\b','i'));
   assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security','i'));
 }
 assert.match(sql,/exclude using gist[\s\S]+tstzrange\(start_at,end_at,'\[\)'\) with &&/i);
 assert.match(sql,/foreign key\(student_id,academy_id\) references public\.students\(id,academy_id\)/i);
 assert.match(sql,/foreign key\(intake_id,academy_id\) references public\.olli_booking_intakes\(id,academy_id\)/i);
 assert.match(sql,/revoke all on function public\.olli_booking_server_reserve[\s\S]+from public,anon,authenticated/i);
 assert.match(sql,/grant execute on function public\.olli_booking_server_reserve[\s\S]+to service_role/i);
 assert.match(sql,/perform olli_consultation_private\.require_owner\(p_session_token,p_academy_id\)/i);
 assert.match(sql,/expected_revision/i);
 assert.match(sql,/pg_advisory_xact_lock/i);
 assert.match(sql,/status='confirmed'/i);
 assert.match(sql,/allow_parent_cancel boolean not null default true/i);
 assert.match(sql,/allow_parent_reschedule boolean not null default true/i);
});

test('existing consultation summaries remain independent from reservation data',()=>{
 assert.doesNotMatch(sql,/update\s+(?:public\.)?(?:summary_feedbacks|olli_consultation_summary_jobs)\b/i);
 assert.doesNotMatch(sql,/delete\s+from\s+(?:public\.)?(?:summary_feedbacks|olli_consultation_summary_jobs)\b/i);
 assert.match(sql,/due_month text/);
 assert.match(sql,/begin;[\s\S]+commit;/i);
});
