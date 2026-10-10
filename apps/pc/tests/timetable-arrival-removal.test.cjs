const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const css = fs.readFileSync('pc-timetable.css', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');
const sql = fs.readFileSync('../../supabase/migrations/20261010120000_remove_pickup_arrival.sql', 'utf8');

test('move dialog retains white selected surfaces and dark active session', () => {
  assert.match(css, /\.olliTtEnrollmentChoice\.active \{ border-color: #0A84FF; color: #0877df; background: #fff; \}/);
  assert.match(css, /\.olliTtSessionOrder button\.active \{ color: #fff; background: #454c56;/);
  assert.match(css, /\.olliTtChoice\.active:is\(\[data-tt-target-day\],\[data-tt-target-time\],\[data-tt-kinder-time-class\]\):not\(\.full\)/);
  assert.match(css, /\.olliTtChoiceGrid\.times\.elementaryFullHours \{ grid-template-columns: repeat\(6,/);
  assert.match(ui, /elementaryFullHours/);
});

test('arrival deletion button is present only for registered arrivals', () => {
  assert.match(ui, /const arrivalDelete = hasArrival/);
  assert.match(ui, /data-tt-remove-arrival>등원삭제<\/button>/);
  assert.match(ui, /removeArrivalButton\.addEventListener\('click', removePickupArrival\)/);
});

test('deleting arrival retains dropoff, while arrival-only delegates to existing full deletion', () => {
  assert.match(ui, /hasDropoff\s*\? service\.removePickupArrival\(dialog\.pickupId\)\s*:\s*service\.removePickup\(dialog\.pickupId, effectiveDate\)/);
  assert.match(service, /async function removePickupArrival\(pickupId\)/);
  assert.match(service, /rpc\('olli_schedule_remove_pickup_arrival'/);
  assert.match(service, /removePickupArrival,/);
});

test('arrival removal RPC requires academy access and preserves dropoff data', () => {
  assert.match(sql, /private\.olli_schedule_can_access\(p_session_token, p_academy_id\)/);
  assert.match(sql, /where p\.id = p_pickup_id and p\.academy_id = p_academy_id and p\.status = 'active'/);
  assert.match(sql, /for update;/);
  assert.match(sql, /v_dropoff_label := nullif\(btrim\(coalesce\(v_pickup\.dropoff_label, ''\)\), ''\);/);
  assert.match(sql, /set pickup_label = v_dropoff_label,[\s\S]*pickup_time = null,[\s\S]*is_dropoff = true,[\s\S]*dropoff_label = v_dropoff_label/);
  assert.doesNotMatch(sql, /set status = 'cancelled'/);
});
