const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('pc-timetable.js', 'utf8');
const css = fs.readFileSync('pc-timetable.css', 'utf8');
const service = fs.readFileSync('pc-timetable-service.js', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20260921180000_timetable_pickup_dropoff.sql', 'utf8');
const dropoffManageSql = fs.readFileSync('supabase/migrations/20260922165500_pickup_manage_dropoff_registration.sql', 'utf8');

test('pickup add dialog groups arrival and dropoff and keeps the custom clock picker', () => {
  assert.match(ui, /olliTtPickupAddSection arrival/);
  assert.match(ui, /olliTtPickupAddSection dropoff/);
  assert.match(ui, /data-tt-pickup-label/);
  assert.match(ui, /data-tt-pickup-time/);
  assert.match(ui, /data-tt-pickup-dropoff-label/);
  assert.doesNotMatch(ui, /data-tt-pickup-dropoff aria-pressed/);
  assert.match(ui, /function openClockPicker\(input, onChange\)/);
  assert.match(ui, /data-tt-clock-hour/);
  assert.match(ui, /data-tt-clock-minute/);
  assert.match(ui, /data-tt-clock-done disabled>완료<\/button>/);
});

test('pickup add allows arrival only, dropoff only, or both', () => {
  assert.match(ui, /const hasArrivalInput = Boolean\(dialog\.pickupLabel \|\| dialog\.pickupTime\)/);
  assert.match(ui, /const hasDropoff = Boolean\(dialog\.dropoffLabel\)/);
  assert.match(ui, /if \(hasArrivalInput && \(!dialog\.pickupLabel \|\| !dialog\.pickupTime\)\)/);
  assert.match(ui, /if \(!hasArrivalInput && !hasDropoff\)/);
  assert.match(ui, /dropoffLabel: hasDropoff \? dialog\.dropoffLabel : ''/);
  assert.match(service, /rpc\('olli_schedule_save_pickup_v3'/);
});

test('pickup manage popup groups arrival and dropoff settings and keeps the header icon-free', () => {
  assert.match(ui, /olliTtPickupManageSection arrival/);
  assert.match(ui, /const hasArrival = !isDropoffOnly/);
  assert.doesNotMatch(ui, /const arrivalSection = isDropoffOnly \? ''/);
  assert.match(ui, />등원 설정</);
  assert.match(ui, /현재 등원 픽업/);
  assert.match(ui, /olliTtPickupManageSection dropoff/);
  assert.match(ui, />하원 설정</);
  assert.match(ui, /olliTtPickupManageSection effective/);
  assert.match(ui, />변경·삭제 적용일</);
  assert.match(ui, /olliTtPickupManageHead/);
  assert.match(ui, /return '<div class="olliTtPickupManageHead">'/);
  assert.match(css, /\.olliTtPickupManageSection\.arrival/);
  assert.match(css, /\.olliTtPickupManageSection\.dropoff/);
});

test('dropoff registration preserves an existing arrival pickup and stores dropoff separately', () => {
  const preserveSql = fs.readFileSync('supabase/migrations/20260922171000_preserve_pickup_when_adding_dropoff.sql', 'utf8');
  assert.match(preserveSql, /add column if not exists dropoff_label text/);
  assert.match(preserveSql, /set dropoff_label = v_label/);
  assert.match(preserveSql, /if v_pickup\.is_dropoff = true then/);
  assert.match(preserveSql, /else[\s\S]*set dropoff_label = v_label/);
  assert.doesNotMatch(preserveSql, /pickup_time = null/);
});

test('normal arrival pickup keeps its label/time and gains 하 from dropoff_label', () => {
  assert.match(ui, /item\.is_dropoff === true \|\| Boolean\(clean\(item\.dropoff_label\)\)/);
  assert.match(ui, /\$\{esc\(item\.pickup_label\)\} \$\{esc\(pickupTimeLabel\(item\.pickup_time\)\)\}/);
  assert.match(service, /dropoff_label:clean\(dropoff\.dropoffLabel\)/);
  assert.match(ui, /기존 등원 픽업은 그대로 두고 하원 장소만 추가합니다/);
});

test('pickup manage popup can delete only the supplemental dropoff setting', () => {
  assert.match(ui, /data-tt-remove-dropoff>하원삭제<\/button>/);
  assert.match(ui, /async function removePickupDropoff\(\)/);
  assert.match(ui, /service\.removePickupDropoff\(dialog\.pickupId\)/);
  assert.match(service, /async function removePickupDropoff\(pickupId\)/);
  assert.match(service, /rpc\('olli_schedule_remove_pickup_dropoff'/);
});

test('pickup timetable card renders purple 하 marker beside the student name', () => {
  assert.match(ui, /olliTtPickupDropoffMark[^]*aria-label="하원">하<\/span>/);
  assert.match(css, /\.olliTtPickupStudentName \.olliTtPickupDropoffMark \{[^}]*background:#8061c7;[^}]*color:#fff/);
});

test('student-add search box stays behind nested popup while result list stacking stays unchanged', () => {
  assert.match(css, /#olliTtDialog\.olliTtAddDialog \.olliTtField:has\(> \.olliTtStudentSearch\[type="search"\]\) \{\s*z-index:auto;\s*\}/);
  assert.match(css, /\.olliTtStudentSearch\[type="search"\] \+ \.olliTtPickerList \{[\s\S]*?z-index: 200;[\s\S]*?max-height: 144px;/);
  assert.match(css, /\.olliTtField:focus-within > \.olliTtStudentSearch\[type="search"\]:not\(:placeholder-shown\) \+ \.olliTtPickerList \{ display: block; \}/);
  assert.match(css, /\.olliTtTeacherToggleRow \{[\s\S]*?z-index: 8;/);
  assert.match(css, /\.olliTtTeacherToggle\[open\] \{ z-index: 40; \}/);
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

test('unified pickup save keeps dropoff separately and supports dropoff-only rows', () => {
  const unifiedSql = fs.readFileSync('supabase/migrations/20260922182000_unified_pickup_arrival_dropoff.sql', 'utf8');
  assert.match(unifiedSql, /create or replace function public\.olli_schedule_save_pickup_v3/);
  assert.match(unifiedSql, /v_has_arrival := \(v_arrival_label <> '' or p_pickup_time is not null\)/);
  assert.match(unifiedSql, /v_has_dropoff := \(v_dropoff_label <> ''\)/);
  assert.match(unifiedSql, /case when v_has_arrival then v_arrival_label else v_dropoff_label end/);
  assert.match(unifiedSql, /not v_has_arrival/);
  assert.match(unifiedSql, /case when v_has_dropoff then v_dropoff_label else null end/);
  assert.match(service, /rpc\('olli_schedule_save_pickup_v3'/);
  assert.match(service, /rpc\('olli_schedule_pickup_dropoff_flags'/);
  assert.match(service, /dropoff_label:clean\(dropoff\.dropoffLabel\)/);
});

test('dropoff-only pickup can later receive arrival settings without losing dropoff', () => {
  const unifiedSql = fs.readFileSync('supabase/migrations/20260922182000_unified_pickup_arrival_dropoff.sql', 'utf8');
  assert.match(ui, /data-tt-save-arrival/);
  assert.match(ui, /async function savePickupArrival\(\)/);
  assert.match(service, /async function savePickupArrival\(pickupId, pickupLabel, pickupTime\)/);
  assert.match(service, /rpc\('olli_schedule_save_pickup_arrival'/);
  assert.match(unifiedSql, /if v_pickup\.is_dropoff = true and v_dropoff_label is null then/);
  assert.match(unifiedSql, /v_dropoff_label := v_pickup\.pickup_label/);
  assert.match(unifiedSql, /is_dropoff = false/);
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


test('dropoff delete removes only dropoff from combined rows and removes dropoff-only cards', () => {
  const unifiedSql = fs.readFileSync('supabase/migrations/20260922182000_unified_pickup_arrival_dropoff.sql', 'utf8');
  assert.match(unifiedSql, /create or replace function public\.olli_schedule_remove_pickup_dropoff/);
  assert.match(unifiedSql, /if v_pickup\.is_dropoff = true then[\s\S]*set status = 'cancelled'/);
  assert.match(unifiedSql, /else[\s\S]*set dropoff_label = null/);
  assert.match(ui, /하원 설정을 삭제하면 이 픽업카드는 사라집니다/);
  assert.match(ui, /기존 등원 픽업은 그대로 유지됩니다/);
});


test('pickup action buttons reuse standard dialog button classes', () => {
  assert.match(ui, /class="olliTtDialogPrimary olliTtPickupInlineAction" data-tt-save-arrival/);
  assert.match(ui, /class="olliTtDialogPrimary olliTtPickupInlineAction" data-tt-register-dropoff/);
  assert.match(ui, /class="olliTtDialogPrimary danger olliTtPickupInlineAction" data-tt-remove-dropoff/);
  assert.match(css, /\.olliTtPickupInlineAction[^}]*height:48px[^}]*border-radius:12px/);
  assert.doesNotMatch(css, /\.olliTtDropoffRegisterBtn/);
  assert.doesNotMatch(css, /\.olliTtDropoffDeleteBtn/);
});


test('pickup popup footer actions size to their text instead of filling the footer', () => {
  assert.match(ui, /olliTtDialogBody olliTtPickupAddBody/);
  assert.match(css, /\.olliTtPickupAddBody > \.olliTtDialogActions,[\s\S]*?\.olliTtPickupManageBody > \.olliTtDialogActions \{[^}]*display:flex;[^}]*justify-content:flex-end;/);
  assert.match(css, /\.olliTtPickupAddBody > \.olliTtDialogActions button,[\s\S]*?\.olliTtPickupManageBody > \.olliTtDialogActions button \{[^}]*width:auto;[^}]*min-width:76px;[^}]*padding:0 18px;/);
});

test('arrival dropoff and schedule primary actions share one width and align to the right edge', () => {
  assert.match(css, /\.olliTtPickupManageArrivalGrid \{[^}]*grid-template-columns:minmax\(0,1fr\) 150px 112px;/);
  assert.match(css, /\.olliTtPickupManageDropoffGrid \{[^}]*grid-template-columns:minmax\(0,1fr\) 112px 112px;/);
  assert.match(css, /\[data-tt-register-dropoff\] \{ grid-column:3; \}/);
  assert.match(css, /\.olliTtPickupInlineAction, \.olliTtPickupManageFieldRow > button \{[^}]*width:112px;[^}]*justify-self:end;/);
  assert.match(css, /\.olliTtPickupManageSection\.effective \.olliTtPickupManageFieldRow \{[^}]*grid-template-columns:minmax\(0,1fr\) 112px;/);
});
