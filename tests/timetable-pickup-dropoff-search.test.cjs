const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const css = fs.readFileSync('pc-timetable.css', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20260921180000_timetable_pickup_dropoff.sql', 'utf8');

test('pickup add dialog supports dropoff marker and clock-only pickup time', () => {
  assert.match(ui, /isDropoff: false/);
  assert.match(ui, /data-tt-pickup-dropoff/);
  assert.match(ui, /class="olliTtClockOnlyTime" data-tt-pickup-time/);
  assert.match(ui, /input\.showPicker/);
  assert.match(ui, /input\.addEventListener\('input', \(\) => commitValue\(true\)\)/);
  assert.match(ui, /input\.addEventListener\('change', \(\) => commitValue\(true\)\)/);
  assert.match(ui, /\^\\d\{2\}:\\d\{2\}\(\?:\:\\d\{2\}\)\?\$/);
  assert.match(ui, /global\.setTimeout\(\(\) => \{[\s\S]*input\.blur\(\)/);
  assert.match(ui, /isDropoff: dialog\.isDropoff === true/);
});

test('pickup timetable card renders purple 하 marker beside the student name', () => {
  assert.match(ui, /olliTtPickupDropoffMark[^]*aria-label="하원">하<\/span>/);
  assert.match(css, /\.olliTtPickupStudentName \.olliTtPickupDropoffMark \{[^}]*background:#8061c7;[^}]*color:#fff/);
});

test('all timetable popup student searches support arrow-key highlight and Enter selection', () => {
  assert.match(ui, /\.olliTtStudentSearch\[type="search"\]/);
  assert.match(ui, /\['ArrowDown', 'ArrowUp', 'Enter'\]/);
  assert.match(ui, /button\.classList\.toggle\('keyboardActive', active\)/);
  assert.match(ui, /buttons\[index\]\.click\(\)/);
  assert.match(ui, /function commitDialogStudentSelection\(button\)/);
  assert.match(ui, /state\.dialog\.query = clean\(student\.name\)/);
  assert.match(ui, /nextInput\.value = clean\(student\.name\)/);
  assert.match(ui, /nextInput\.blur\(\)/);
  assert.match(css, /\.olliTtField:has\(> \.olliTtStudentSearch\[type="search"\]\) \{ position: relative; z-index: 120; \}/);
  assert.match(css, /\.olliTtStudentSearch\[type="search"\] \+ \.olliTtPickerList \{[\s\S]*z-index: 200;/);
});

test('dropoff persistence uses a dedicated boolean and survives scheduled pickup time changes', () => {
  assert.match(sql, /add column if not exists is_dropoff boolean not null default false/);
  assert.match(sql, /create or replace function public\.olli_schedule_save_pickup_v2/);
  assert.match(sql, /p_is_dropoff boolean default false/);
  assert.match(sql, /v_pickup\.pickup_label, p_pickup_time, v_pickup\.is_dropoff/);
  assert.match(service, /rpc\('olli_schedule_save_pickup_v2'/);
  assert.match(service, /rpc\('olli_schedule_pickup_dropoff_flags'/);
  assert.match(service, /is_dropoff: pickupDropoffMap\.get/);
});


test('dropoff button is explicitly anchored at the far-left of the pickup row', () => {
  assert.match(css,/\.olliTtPickupDropoffBtn \{ grid-column:1; justify-self:start; width:76px; height:46px; margin-left:0;/);
});


test('clock picker closes as soon as a complete hour and minute value is emitted', () => {
  const bindingStart = ui.indexOf('function bindClockOnlyTimeInput');
  const bindingEnd = ui.indexOf('function esc', bindingStart);
  const binding = ui.slice(bindingStart, bindingEnd);
  assert.match(binding, /input\.addEventListener\('input'/);
  assert.match(binding, /commitValue\(true\)/);
  assert.match(binding, /input\.blur\(\)/);
  assert.ok(binding.indexOf("input.addEventListener('input'") < binding.indexOf("input.addEventListener('change'"));
});
