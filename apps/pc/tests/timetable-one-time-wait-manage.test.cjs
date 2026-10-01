const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');

test('makeup and trial management can change date time and class through the expanded RPC', () => {
  assert.match(service, /async\s+function\s+updateOneTimeSession\s*\(/);
  assert.match(service, /rpc\('olli_schedule_update_one_time_session'/);
  assert.match(service, /p_session_date\s*:/);
  assert.match(service, /p_time_slot\s*:/);
  assert.match(service, /p_class_group\s*:/);

  assert.match(ui, /data-tt-managed-date/);
  assert.match(ui, /data-tt-managed-time/);
  assert.match(ui, /data-tt-change-makeup-schedule/);
  assert.match(ui, /async\s+function\s+changeMakeupSessionSchedule\s*\(/);
  assert.match(ui, /service\.updateOneTimeSession\(/);
});

test('one-time schedule equality checks date time and class so A/B-only changes remain valid', () => {
  const start = ui.indexOf('async function changeMakeupSessionSchedule');
  const end = ui.indexOf('async function cancelMakeupSession', start);
  const block = ui.slice(start, end);
  assert.match(block, /targetDate\s*===\s*clean\(item\.session_date\)/);
  assert.match(block, /targetTime\s*===\s*Number\(item\.time_slot\)/);
  assert.match(block, /targetGroup\s*===\s*currentGroup/);
  assert.match(block, /service\.updateOneTimeSession\([^]*classGroup:\s*targetGroup/);
});

test('waitlist management can change effective date time and class without replacing accept or cancel actions', () => {
  assert.match(service, /async\s+function\s+updateWaitlistTarget\s*\(/);
  assert.match(service, /rpc\('olli_schedule_update_waitlist_target'/);
  assert.match(service, /p_target_weekday\s*:/);
  assert.match(service, /p_target_time_slot\s*:/);
  assert.match(service, /p_target_class_group\s*:/);
  assert.match(service, /p_desired_effective_date\s*:/);

  assert.match(ui, /data-tt-change-wait-schedule/);
  assert.match(ui, /async\s+function\s+changeWaitSchedule\s*\(/);
  assert.match(ui, /service\.updateWaitlistTarget\(/);
  assert.match(ui, /data-tt-accept-wait/);
  assert.match(ui, /data-tt-cancel-wait/);
});

test('managed schedule UI keeps A/B class selection tied to the selected date and time', () => {
  assert.match(ui, /managedScheduleGroupHtml/);
  assert.match(ui, /classGroupChoiceHtml\(/);
  assert.match(ui, /isClassSplit\(division, targetWeekday, targetTime, targetDate\)/);
  assert.match(ui, /targetClassGroup/);
});
