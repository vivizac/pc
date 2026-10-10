const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const css = fs.readFileSync('pc-timetable.css', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const sql = fs.readFileSync('../../supabase/migrations/20261010031126_pickup_manage_optional_dropoff_time.sql', 'utf8');

test('arrival and dropoff share one inline compact layout', () => {
  assert.match(css, /\.olliTtPickupManageArrivalGrid,[\s\S]*?\.olliTtPickupManageDropoffGrid \{[^}]*grid-template-columns:minmax\(0,1fr\) 80px 86px 86px;/);
  assert.match(css, /\.olliTtPickupManageArrivalGrid > \[data-tt-save-arrival\],[\s\S]*?\.olliTtPickupManageDropoffGrid > \[data-tt-register-dropoff\] \{ grid-column:4; \}/);
  assert.match(css, /\.olliTtPickupManageArrivalGrid > \.olliTtPickupInlineAction,[\s\S]*?\.olliTtPickupManageDropoffGrid > \.olliTtPickupInlineAction \{[^}]*width:100%;/);
  assert.match(css, /@media \(max-width:450px\)/);
});

test('pickup manage restores existing dropoff time and marks time-only updates dirty', () => {
  assert.match(ui, /const initialDropoffTime = pickupTimeInputValue\(item\.dropoff_time\);/);
  assert.match(ui, /originalDropoffTime: initialDropoffTime/);
  assert.match(ui, /dropoffTime !== clean\(dialog && dialog\.originalDropoffTime\)/);
  assert.match(ui, /data-tt-pickup-edit-dropoff-time/);
  assert.match(ui, /bindClockOnlyTimeInput\(pickupManageDropoffTime,/);
});

test('dropoff time is optional, can be cleared, and is persisted with its place', () => {
  assert.match(ui, /placeholder="선택" readonly aria-label="하원 시간 선택 \(선택사항\)"/);
  assert.match(ui, /isOptionalDropoffTime \? '<button type="button" class="olliTtClockPickerClear" data-tt-clock-clear>시간 없음<\/button>'/);
  assert.match(ui, /if \(clearButton\) clearButton\.addEventListener\('click',[\s\S]*?onChange\(''\);/);
  assert.match(ui, /service\.registerPickupDropoff\(dialog\.pickupId, location, time \|\| null\)/);
  assert.match(service, /async function registerPickupDropoff\(pickupId, dropoffLabel, dropoffTime\)/);
  assert.match(service, /rpc\('olli_schedule_register_pickup_dropoff_v2'/);
  assert.match(service, /p_dropoff_time: dropoffTime \|\| null/);
});

test('new DB operation has academy scope, leaves arrival unchanged and allows null time', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.olli_schedule_register_pickup_dropoff_v2/);
  assert.match(sql, /private\.olli_schedule_can_access\(p_session_token, p_academy_id\)/);
  assert.match(sql, /and p\.academy_id = p_academy_id/);
  assert.match(sql, /set dropoff_label = v_label,[\s\S]*dropoff_time = p_dropoff_time/);
  assert.doesNotMatch(sql, /p_dropoff_time is null then/);
  assert.doesNotMatch(sql, /\bDELETE FROM\b/i);
});

test('existing arrival requirements, deletion and script revisions remain connected', () => {
  assert.match(ui, /if \(!location \|\| !time\) \{ alert\('등원 장소와 시간을 모두 입력해 주세요\.'\); return; \}/);
  assert.match(ui, /removeDropoffButton\.addEventListener\('click', removePickupDropoff\)/);
  assert.match(ui, /removeArrivalButton\.addEventListener\('click', removePickupArrival\)/);
  assert.match(html, /pc-timetable\.css\?v=20261010-pickup-inline-1/);
  assert.match(html, /pc-timetable-service\.js\?v=20261010-dropoff-time-1/);
  assert.match(html, /pc-timetable\.js\?v=20261010-dropoff-time-1/);
});
