'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const ui=read('packages/common/olli-booking-owner-ui.js');
const css=read('packages/common/olli-booking-owner-ui.css');
const sql=read('supabase/migrations/20261102152500_olli_booking_staff_manual_create.sql');
test('Manual appointment UI is shared by PC and mobile with one server mutation',()=>{
  for(const p of ['apps/pc/index.html','apps/mobile/index.html']){
    const html=read(p);
    assert.match(html,new RegExp('olli-booking-owner-ui\\.js\\?v='+(p.startsWith('apps/mobile/')?'20261103-work-back-match-3':'20261102-manual-slots-search-4')));
    assert.match(html,new RegExp('olli-booking-owner-ui\\.css\\?v='+(p.startsWith('apps/mobile/')?'20261103-work-back-match-3':'20261102-manual-slots-search-4')));
  }
  assert.match(ui,/data-action="add-manual"/);
  assert.match(ui,/data-action="save-manual"/);
  assert.match(ui,/data-manual-student/);
  assert.match(ui,/data-manual-search/);
  assert.match(ui,/pick-manual-student/);
  assert.match(ui,/olli_booking_staff_manual_slots/);
  assert.match(ui,/manualManage\('students'\)/);
  assert.match(ui,/manualManage\('create',\{studentId,startAt,requestKey\}\)/);
  assert.match(css,/data-action="add-manual"/);
});
test('Manual RPC checks owner and reuses existing booking primitive; never rewrites old actions',()=>{
  assert.match(sql,/require_owner\(p_session_token,p_academy_id\)/);
  assert.match(sql,/s\.academy_id=p_academy_id and s\.status='active' and s\.is_deleted=false/);
  assert.match(sql,/olli_booking_private\.assert_slot\(p_academy_id,p_start_at\)/);
  assert.match(sql,/public\.olli_booking_server_reserve/);
  assert.match(sql,/action='created' and actor='system'/);
  assert.doesNotMatch(sql,/drop (table|function)|truncate|delete from public\.olli_booking_reservations/i);
  assert.match(sql,/revoke all on function public\.olli_booking_staff_manual_manage/);
});
