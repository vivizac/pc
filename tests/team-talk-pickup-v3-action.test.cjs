const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync(
  'supabase/migrations/20261001004000_team_chat_pickup_v3_action.sql',
  'utf8'
);
const common = fs.readFileSync('packages/common/olli-command-schedule-common.js', 'utf8');

test('Team Chat add_pickup confirmation uses pickup v3 source of truth', () => {
  const block = sql.match(/elsif v_type='add_pickup' then[\s\S]*?elsif v_type='update_pickup_arrival' then/i)?.[0] || '';
  assert.match(block, /olli_schedule_save_pickup_v3/i);
  assert.doesNotMatch(block, /olli_schedule_save_pickup_v2/i);
  assert.match(block, /v_payload->>'dropoffLabel'/i);
  assert.match(block, /v_payload->>'pickupLabel'/i);
  assert.match(block, /v_payload->>'pickupTime'/i);
  assert.match(block, /v_payload->>'effectiveDate'/i);
});

test('legacy pending dropoff cards remain compatible after the v3 switch', () => {
  const block = sql.match(/elsif v_type='add_pickup' then[\s\S]*?elsif v_type='update_pickup_arrival' then/i)?.[0] || '';
  assert.match(block, /coalesce\(\(v_payload->>'isDropoff'\)::boolean,false\)/i);
  assert.match(
    block,
    /coalesce\([\s\S]*v_payload->>'dropoffLabel'[\s\S]*isDropoff[\s\S]*v_payload->>'pickupLabel'/i
  );
});

test('pickup update and delete execution paths remain unchanged', () => {
  assert.match(sql, /v_type='update_pickup_arrival'[\s\S]*olli_schedule_save_pickup_arrival/i);
  assert.match(sql, /v_type='update_pickup_dropoff'[\s\S]*olli_schedule_register_pickup_dropoff/i);
  assert.match(sql, /v_type='cancel_pickup_dropoff'[\s\S]*olli_schedule_remove_pickup_dropoff/i);
  assert.match(sql, /v_type='cancel_pickup'[\s\S]*olli_schedule_remove_pickup/i);
});


test('browser and phone common pickup execution already use pickup v3 payload fields', () => {
  const block = common.match(/else if \(intent === 'add_pickup'\) \{[\s\S]*?else if \(intent === 'update_pickup_arrival'\)/)?.[0] || '';
  assert.match(block, /olli_schedule_save_pickup_v3/i);
  assert.match(block, /p_arrival_label:item\.pickupLabel \|\| null/i);
  assert.match(block, /p_pickup_time:item\.pickupTime \|\| null/i);
  assert.match(block, /p_dropoff_label:item\.dropoffLabel \|\| null/i);
  assert.doesNotMatch(block, /olli_schedule_save_pickup_v2/i);
});
