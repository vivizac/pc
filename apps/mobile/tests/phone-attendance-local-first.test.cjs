const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const adapter = fs.readFileSync('olli-attendance-phone-adapter.js', 'utf8');
const navigation = fs.readFileSync('olli-record-room-navigation.js', 'utf8');
const observationRuntime = fs.readFileSync('olli-observation-runtime.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const baseCss = fs.readFileSync('olli-phone-base.css', 'utf8');

test('attendance local snapshot hydrates month and week caches before server work', () => {
  assert.match(adapter, /function hydrateCurrentMonthFromLocal\(/);
  assert.match(adapter, /function hydrateTodayScheduleFromLocal\(/);
  assert.match(adapter, /function hydrateLocalAttendanceSnapshot\([\s\S]*?hydrateCurrentMonthFromLocal[\s\S]*?hydrateTodayScheduleFromLocal/);
  assert.match(adapter, /typeof data\.getCachedWeek !== 'function'/);
  assert.match(adapter, /data\.getCachedWeek\(targetDateKey\)/);
});

test('record list restores attendance snapshot before awaiting student server refresh', () => {
  assert.match(navigation, /renderElementaryRecords\(name\);\s*hydrateRecordAttendanceLocalSnapshot\(\);\s*if \(localOnly\) return true;\s*await loadStudentsFromSupabase\(\);/);
  assert.match(navigation, /renderKinderRecords\(name\);\s*hydrateRecordAttendanceLocalSnapshot\(\);\s*if \(localOnly\) return true;\s*await loadStudentsFromSupabase\(\);/);
});

test('attendance local store separates same-kind sessions by time and class', () => {
  assert.match(adapter, /function sessionStorageKey\(timeSlot, classGroup\)/);
  assert.match(adapter, /function setStoreSessionStatus\(store, student, targetDateKey, kind, status, serverSynced, timeSlot, classGroup\)/);
  assert.match(adapter, /bucket\[exactKey\] = \{/);
  assert.match(adapter, /function getAttendanceSessionStatus\(studentId, targetDateKey, kind, timeSlot, classGroup\)/);
});

test('attendance exact-session rollback preserves sibling session state', () => {
  assert.match(adapter, /function getLocalSessionSnapshot\(studentId, targetDateKey, kind, timeSlot, classGroup\)/);
  assert.match(adapter, /function restoreLocalSession\(student, targetDateKey, kind, timeSlot, classGroup, snapshot\)/);
  assert.match(adapter, /bucket\[exactKey\] = cloneValue\(snapshot\)/);
  assert.match(adapter, /delete bucket\[exactKey\]/);
});

test('month merge distinguishes exact register overrides by time and class', () => {
  assert.match(adapter, /const exactKey = sessionStorageKey\(timeSlot, classGroup\)/);
  assert.match(adapter, /overrideKeys\.has/);
  assert.match(adapter, /setStoreSessionStatus\(store, student, targetDateKey, kind/);
});

test('legacy coarse attendance migrates once to the first exact session', () => {
  assert.match(adapter, /const legacyBucket = bucket/);
  assert.match(adapter, /const legacyItem =/);
  assert.match(adapter, /if \(exactKey && \(legacyBucket \|\| legacyItem\)\)/);
  assert.match(adapter, /ensureItemSessions\(item, targetKind, timeSlot, classGroup\)/);
  assert.match(adapter, /global\.writeRecordDailyAttendanceStore\(store\)/);
});

test('attendance tapping updates local status before any schedule network wait', () => {
  const start = adapter.indexOf('async function toggleTodayAttendance');
  const end = adapter.indexOf('function afterRecordListLoaded', start);
  const body = adapter.slice(start, end);
  const localWrite = body.indexOf('writeLocalStatus(student, targetDateKey, kind, nextStatus, false, target.timeSlot, target.classGroup)');
  const serverWrite = body.indexOf('await setAttendanceRegisterStatus');
  assert.ok(localWrite >= 0, 'local attendance write must exist');
  assert.ok(serverWrite > localWrite, 'server save must follow local attendance write');
  assert.doesNotMatch(body.slice(0, localWrite), /await syncTodaySchedule/);
});

test('phone attendance writes exact session status through v2 RPC', () => {
  assert.match(adapter, /rpc\/olli_schedule_set_attendance_session_status_v2/);
  assert.match(adapter, /p_time_slot: targetSlot/);
  assert.match(adapter, /p_class_group: targetGroup/);
  assert.doesNotMatch(adapter, /'rpc\/olli_schedule_set_attendance_session_status'/);
});

test('attendance controls carry time and class through touch and keyboard handlers', () => {
  assert.match(adapter, /toggleRecordTodayAttendance\(event,'\$\{id\}','\$\{kind\}',\$\{Number\(target\.timeSlot\) \|\| 0\},'\$\{safeGroup\}'\)/);
  assert.match(adapter, /handleRecordAttendanceLeadKeydown\(event,'\$\{id\}','\$\{kind\}',\$\{Number\(target\.timeSlot\) \|\| 0\},'\$\{safeGroup\}'\)/);
  assert.match(observationRuntime, /function handleRecordAttendanceLeadKeydown\(event, studentId, sessionKind, timeSlot, classGroup\)/);
  assert.match(observationRuntime, /toggleRecordTodayAttendance\(event, studentId, sessionKind, timeSlot, classGroup\)/);
  assert.match(observationRuntime, /adapter\.toggleTodayAttendance\(event, studentId, sessionKind, timeSlot, classGroup\)/);
});

test('attendance save failure restores only the selected exact session', () => {
  const start = adapter.indexOf('async function toggleTodayAttendance');
  const end = adapter.indexOf('function afterRecordListLoaded', start);
  const body = adapter.slice(start, end);
  assert.match(body, /getLocalSessionSnapshot\(student\.id, targetDateKey, kind, target\.timeSlot, target\.classGroup\)/);
  assert.match(body, /restoreLocalSession\(student, targetDateKey, kind, target\.timeSlot, target\.classGroup, beforeSession\)/);
  assert.doesNotMatch(body, /restoreLocalItem/);
});

test('attendance background refresh does not block the already rendered list', () => {
  assert.match(adapter, /function afterRecordListLoaded\(\)[\s\S]*?hydrateLocalAttendanceSnapshot\(new Date\(\), \{ render: true \}\);[\s\S]*?Promise\.all\(/);
  assert.doesNotMatch(adapter, /async function afterRecordListLoaded\(\)/);
});

test('attendance server refresh only rerenders schedule when the visible snapshot changed', () => {
  assert.match(adapter, /const beforeSignature = todayScheduleState\.signature \|\| currentTodayScheduleSignature\(\);/);
  assert.match(adapter, /const changed = nextSignature !== beforeSignature;/);
  assert.match(adapter, /if \(changed && options\.render !== false\) renderCurrentRecordList\(\);/);
});

test('phone loads cache-busted shared and adapter attendance scripts', () => {
  assert.match(html, /olli-attendance-data\.js\?v=20260924-week-local-first-1/);
  assert.match(html, /olli-attendance-phone-adapter\\.js\\?v=20260928-attendance-exact-session-1/);
  assert.match(html, /olli-record-room-navigation\.js\?v=20260924-attendance-local-first-1/);
});


test('attendance student cards restore the original long-press action menu wiring', () => {
  const list = fs.readFileSync('olli-record-list-view.js', 'utf8');
  const operations = fs.readFileSync('olli-data-student-operations.js', 'utf8');
  assert.match(list, /class="elementaryStudentRow[\s\S]*?onpointerdown="startStudentLongPress\(event,'\$\{escapeTemplateLiteral\(student\.id\)\}'\)"[\s\S]*?onpointermove="moveStudentLongPress\(event\)"[\s\S]*?onpointerup="cancelStudentLongPress\(\)"[\s\S]*?onpointercancel="cancelStudentLongPress\(\)"/);
  assert.match(list, /class="kinderStudentRow[\s\S]*?onpointerdown="startStudentLongPress\(event,'\$\{escapeTemplateLiteral\(student\.id\)\}'\)"/);
  assert.match(operations, /function startStudentLongPress\(e, studentId\)[\s\S]*?studentLongPressTimer = setTimeout[\s\S]*?openStudentActionMenu\(studentId, row\);[\s\S]*?\}, 480\);/);
  assert.match(operations, /function moveStudentLongPress\(e\)[\s\S]*?dx > 10 \|\| dy > 10/);
  assert.match(operations, /function cancelStudentLongPress\(\)/);
  assert.match(operations, /navigator\.vibrate\(10\)/);
  assert.match(html, /id="studentActionOverlay"[\s\S]*?>휴원<[\s\S]*?>퇴원<[\s\S]*?>삭제</);
});

test('attendance long-press assets are cache-busted', () => {
  assert.match(html, /olli-data-student-operations\.js\?v=20260926-attendance-longpress-1/);
  assert.match(html, /olli-record-list-view\.js\?v=20260926-attendance-longpress-1/);
});


test('attendance student action overlay belongs to the attendance page only', () => {
  const operations = fs.readFileSync('olli-data-student-operations.js', 'utf8');
  const css = fs.readFileSync('olli-phone-base.css', 'utf8');
  const recordStart = html.indexOf('id="recordRoomScreen"');
  const overlay = html.indexOf('id="studentActionOverlay"');
  const observation = html.indexOf('id="observationPersistentNavLayer"');
  assert.ok(recordStart >= 0 && overlay > recordStart && observation > overlay, 'student action overlay must be inside the attendance screen before observation pages');
  assert.match(operations, /rowEl\.closest\('#recordRoomScreen'\)/);
  assert.match(operations, /rowOwner !== recordScreen/);
  assert.match(operations, /getComputedStyle\(recordScreen\)\.display === 'none'/);
  assert.match(operations, /recordScreen\.querySelector\('#studentActionOverlay'\)/);
  assert.match(css, /#recordRoomScreen > #studentActionOverlay \{[\s\S]*?z-index: 120300;/);
});

test('attendance student action ownership assets are cache-busted', () => {
  assert.match(html, /olli-data-student-operations\.js\?v=20260926-student-action-owner-1/);
  assert.match(html, /olli-phone-base\.css\?v=20260926-student-action-owner-1/);
});


test('attendance day sort splits the same time into class groups only when multiple groups exist', () => {
  assert.match(adapter, /function getRegularClassGroup\(student\)/);
  assert.match(adapter, /const groupsBySlot = new Map\(\)/);
  assert.match(adapter, /const key = `\$\{slotKey\}\|\$\{classGroup\}`/);
  assert.match(adapter, /const divided = \(groupsBySlot\.get\(group\.slotKey\)\?\.size \|\| 0\) > 1/);
  assert.match(adapter, /divided \? `·\$\{group\.classGroup\}반` : ''/);
});

test('attendance action popup aligns to the left add button and student rows use compact spacing', () => {
  assert.match(baseCss, /#recordRoomScreen > #studentActionOverlay \{[\s\S]*?justify-content: flex-start;[\s\S]*?padding-left: 21px;/);
  assert.match(baseCss, /\.elementaryStudentRow,[\s\S]*?\.kinderStudentRow \{[\s\S]*?min-height:48px;[\s\S]*?padding:6px 10px 6px 10px;[\s\S]*?margin-bottom:0;/);
});
