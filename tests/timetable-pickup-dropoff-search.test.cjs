const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const css = fs.readFileSync('pc-timetable.css', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20260921180000_timetable_pickup_dropoff.sql', 'utf8');

test('pickup add dialog uses a custom clock picker with an explicit done button', () => {
  assert.match(ui, /isDropoff: false/);
  assert.match(ui, /data-tt-pickup-dropoff/);
  assert.match(ui, /type="text" class="olliTtClockOnlyTime" data-tt-pickup-time/);
  assert.match(ui, /function openClockPicker\(input, onChange\)/);
  assert.match(ui, /data-tt-clock-hour/);
  assert.match(ui, /data-tt-clock-minute/);
  assert.match(ui, /data-tt-clock-done disabled>완료<\/button>/);
  assert.match(ui, /doneButton\.addEventListener\('click'/);
  assert.match(ui, /onChange\(value\)/);
  assert.match(ui, /closeClockPicker\(\)/);
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


test('clock picker stays open while choosing hour and minute and closes only with 완료 or escape/outside', () => {
  const openStart = ui.indexOf('function openClockPicker');
  const bindStart = ui.indexOf('function bindClockOnlyTimeInput', openStart);
  const openBlock = ui.slice(openStart, bindStart);
  assert.doesNotMatch(openBlock, /input\.addEventListener\('input'/);
  assert.match(openBlock, /draft\.hour = clean\(button\.dataset\.ttClockHour\)/);
  assert.match(openBlock, /draft\.minute = clean\(button\.dataset\.ttClockMinute\)/);
  assert.match(openBlock, /doneButton\.addEventListener\('click'[\s\S]*closeClockPicker\(\)/);
  assert.match(openBlock, /handleOutside/);
  assert.match(openBlock, /event\.key !== 'Escape'/);
});


test('custom clock picker has a footer complete button and sits above timetable dialogs', () => {
  assert.match(css,/\.olliTtClockPicker \{ position:fixed; z-index:100200;/);
  assert.match(css,/\.olliTtClockPickerFooter \{/);
  assert.match(css,/\.olliTtClockPickerDone \{[^}]*background:#111;/);
});


test('dropoff mode disables the pickup time field and allows saving without time', () => {
  assert.match(ui,/dialog\.isDropoff \? '하원은 시간 없음' : '시간 선택'/);
  assert.match(ui,/dialog\.isDropoff \? 'disabled' : ''/);
  assert.match(ui,/pickupTime\.disabled = true/);
  assert.match(ui,/state\.dialog\.pickupTime = ''/);
  assert.match(ui,/dialog\.isDropoff !== true && !dialog\.pickupTime/);
  assert.match(css,/\.olliTtPickupForm \.olliTtClockOnlyTime:disabled \{[^}]*background:#eef0f2;[^}]*cursor:not-allowed/);
  assert.match(service,/p_pickup_time: options\.isDropoff === true \? null : options\.pickupTime/);
});
