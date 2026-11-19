const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');

test('all timetable card kinds expose a source id and date for native drag start', () => {
  for (const kind of ['regular', 'wait', 'makeup', 'trial', 'pickup']) {
    assert.match(ui, new RegExp('draggable="true" data-tt-drag-kind="' + kind + '" data-tt-drag-id='));
  }
  assert.match(ui, /root\.addEventListener\('dragstart', onTimetableDragStart\)/);
  assert.match(ui, /root\.addEventListener\('drop', onTimetableDrop\)/);
  assert.match(ui, /root\.addEventListener\('dragend', clearTimetableDrag\)/);
});

test('dropping onto a dated A or B lane uses the existing mutation paths without optimistic DOM movement', () => {
  assert.match(ui, /if \(split && !cell\.classList\.contains\('olliTtClassLane'\)\) return null/);
  assert.match(ui, /date < todayKey\(\)/);
  assert.match(ui, /source\.kind === 'regular'[\s\S]*?service\.changeSchedule\(/);
  assert.match(ui, /allowWait:false/);
  assert.match(ui, /service\.updateWaitlistTarget\(source\.id/);
  assert.match(ui, /service\.updateOneTimeSession\(source\.id/);
  assert.match(ui, /service\.movePickup\(source\.id/);
  assert.match(ui, /const result = await withSaving\(async \(\) =>/);
  assert.match(ui, /source\.academyId !== currentSyncAcademyId\(\)/);
});

test('pickup relocation is an atomic, authenticated RPC and preserves source history', () => {
  const migration = fs.readFileSync('../../supabase/migrations/20261119054400_pc_timetable_drag_pickup.sql', 'utf8');
  assert.match(service, /rpc\('olli_schedule_move_pickup_v1'/);
  assert.match(service, /p_source_date: sourceDate/);
  assert.match(migration, /private\.olli_schedule_can_access\(p_session_token, p_academy_id\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /set effective_to = p_target_date - 1/);
  assert.match(migration, /set status = 'cancelled'/);
  assert.match(migration, /insert into public\.olli_schedule_pickups/);
  assert.match(migration, /v_pickup\.dropoff_time/);
  assert.match(migration, /v_pickup\.pickup_scope/);
  assert.match(migration, /v_pickup\.created_at/);
  assert.match(migration, /v_count >= 6/);
});

test('daily pickups can be moved by date without changing their class time', () => {
  const migration = fs.readFileSync('../../supabase/migrations/20261119054400_pc_timetable_drag_pickup.sql', 'utf8');
  assert.match(ui, /pickupScope\(source\.row\) === 'weekly'/);
  assert.match(migration, /v_pickup\.pickup_scope = 'weekly' or p_source_date = p_target_date/);
});
