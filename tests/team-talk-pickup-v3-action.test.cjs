const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync(
  'supabase/migrations/20261001004000_team_chat_pickup_v3_action.sql',
  'utf8'
);

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
