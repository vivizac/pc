'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const ui=read('packages/common/olli-booking-owner-ui.js');
const css=read('packages/common/olli-booking-owner-ui.css');
const sql=read('supabase/migrations/20261106180000_olli_booking_staff_intake_trial.sql');
const original=read('supabase/migrations/20261103150000_olli_booking_staff_reschedule_owner_slots.sql');
test('PC only offers a separate free-text intake/age booking dialog',()=>{
 assert.match(ui,/data-action="add-intake"/);
 assert.match(ui,/\+ 재원생 상담/);
 assert.match(ui,/\+ 신규 상담/);
 assert.match(ui,/state\.mode==='pc'[\s\S]*?data-action="add-intake"/);
 assert.match(ui,/data-intake-name/);
 assert.match(ui,/data-intake-age/);
 assert.match(ui,/name="obmIntakeType" value="consultation" checked/);
 assert.match(ui,/name="obmIntakeType" value="trial"/);
 assert.match(ui,/data-action="save-intake"/);
 assert.doesNotMatch(ui, /data-intake-phone/);
 assert.match(css,/obmIntakeTypeOptions/);
 assert.match(css,/obmPcAddIntake/);
});
test('new intake and enrolled-student bookings share a single backend time ledger',()=>{
 assert.match(ui,/olli_booking_staff_intake_create/);
 assert.match(ui,/intakeManage\(\{name,age,visitType,startAt,requestKey\}\)/);
 assert.match(ui,/loadSlotChoices\(selectedDate,\{manual:true\}\)/);
 assert.match(ui,/if\(action==='save-manual'\)/);
 assert.match(ui,/if\(action==='save-reschedule'\)/);
 assert.match(ui,/if\(action==='cancel'\)/);
 assert.match(sql,/require_owner\(p_session_token,p_academy_id\)/);
 assert.match(sql,/olli_booking_staff_manual_slots/);
 assert.match(sql,/insert into public\.olli_booking_intakes/);
 assert.match(sql,/insert into public\.olli_booking_reservations/);
 assert.match(sql,/insert into public\.olli_booking_events/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/REQUEST_KEY_REUSED/);
 assert.doesNotMatch(sql,/(?:drop|truncate)\s+(?:table|function)/i);
 assert.match(read('supabase/migrations/20261025150000_olli_booking_core_stage1.sql'),/constraint olli_booking_reservations_no_overlap/);
});
test('existing owner reschedule/cancel procedure body remains unchanged',()=>{
 const fnStart='create or replace function public.olli_booking_staff_manage(';
 const previous=original.slice(original.indexOf(fnStart),original.lastIndexOf('\ncommit;'));
 const current=sql.slice(sql.indexOf(fnStart),sql.lastIndexOf('commit;')).trim();
 const expected=previous.replace(
  "'name',coalesce(s.name,i.child_name,'이름 없음'),",
  "'name',coalesce(s.name,i.child_name,'이름 없음'),\n    'visit_type',case when r.student_id is not null then 'consultation' else coalesce(i.visit_type,'consultation') end,\n    'age_years',i.age_years,"
 ).trim();
 assert.equal(current,expected);
});
test('legacy intakes default to consultation, and new trials render distinctly',()=>{
 assert.match(sql,/visit_type text not null default 'consultation'/);
 assert.match(sql,/age_years is null or age_years between 1 and 99/);
 const a=ui.indexOf(' function bookingTypeLabel(row){');
 const b=ui.indexOf(' function bookingsHtml(){',a);
 assert.ok(a>=0&&b>a);
 const fn=vm.runInNewContext(ui.slice(a,b)+'\nbookingTypeLabel;', {});
 assert.equal(fn({kind:'intake',visit_type:'trial'}),'체험수업');
 assert.equal(fn({kind:'intake'}),'신규 상담');
 assert.equal(fn({kind:'regular',visit_type:'trial'}),'재원생 정기 상담');
 assert.match(ui,/r\.kind==='intake'&&r\.visit_type==='trial'\?' · 체험':''/);
});
