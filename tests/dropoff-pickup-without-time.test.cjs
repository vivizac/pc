const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20260921191000_dropoff_pickup_without_time.sql', 'utf8');

test('dropoff pickup may store null time but regular pickup still requires time', () => {
  assert.match(sql,/alter column pickup_time drop not null/);
  assert.match(sql,/check \(is_dropoff = true or pickup_time is not null\)/);
  assert.match(sql,/\(not v_is_dropoff and p_pickup_time is null\)/);
  assert.match(sql,/case when v_is_dropoff then null else p_pickup_time end/);
});
