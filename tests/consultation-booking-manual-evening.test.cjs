'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261102180000_olli_booking_owner_manual_evening_slots.sql');
const original=read('supabase/migrations/20261102174500_olli_booking_owner_manual_slots_search.sql');
const ui=read('packages/common/olli-booking-owner-ui.js');
test('owner booking evening slots are explicit and thirty minutes long',()=>{
  for(const time of ['17:00','17:30','18:00'])
    assert.ok(migration.includes("'"+time+"'::time"),time+' missing');
  assert.match(migration,/select p_date\+evening\.start_time,30 as duration_minutes/);
  assert.match(migration,/g\.duration_minutes/);
  assert.match(migration,/slot->>'end_at'/);
  assert.match(ui,/olli_booking_staff_manual_slots/);
});
test('parent slots and existing booking identity/audit constraints are preserved',()=>{
  assert.match(migration,/require_owner\(p_session_token,p_academy_id\)/);
  assert.match(migration,/olli_booking_reservations/);
  assert.match(migration,/tstzrange/);
  assert.match(migration,/olli_booking_events/);
  assert.doesNotMatch(migration,/(?:create or replace|alter)\s+function\s+public\.olli_booking_list_slots/i);
  assert.doesNotMatch(migration,/alter\s+table\s+public\.olli_booking_settings|drop\s+(?:table|function)|truncate\s+table/i);
  assert.match(original,/create function public\.olli_booking_staff_manual_slots/);
});
