const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const adapter = fs.readFileSync('olli-attendance-phone-adapter.js', 'utf8');
const navigation = fs.readFileSync('olli-record-room-navigation.js', 'utf8');
const observationRuntime = fs.readFileSync('olli-observation-runtime.js', 'utf8');
const attendanceSummary = fs.readFileSync('olli-record-attendance-summary.js', 'utf8');
const attendanceSummaryCss = fs.readFileSync('olli-record-attendance-summary.css', 'utf8');
const recordSearchControls = fs.readFileSync('olli-record-search-controls.js', 'utf8');
const syncFallback = fs.readFileSync('olli-attendance-sync-fallback.js', 'utf8');
const studentOperations = fs.readFileSync('olli-data-student-operations.js', 'utf8');
const recordListView = fs.readFileSync('olli-record-list-view.js', 'utf8');
const attendanceRecordCss = fs.readFileSync('olli-attendance-record.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('attendance re-entry hydrates only the lightweight week snapshot before first paint', () => {
  assert.match(adapter, /function hydrateLocalAttendanceNavigationSnapshot\([\s\S]*?hydrateTodayScheduleFromLocal/);
  assert.match(navigation, /adapter\.hydrateLocalAttendanceNavigationSnapshot/);
  const navHydrateStart = navigation.indexOf('function hydrateRecordAttendanceLocalSnapshot');
  const navHydrateEnd = navigation.indexOf('function syncRecordAcademyPageState', navHydrateStart);
  const navHydrate = navigation.slice(navHydrateStart, navHydrateEnd);
  assert.doesNotMatch(navHydrate, /hydrateCurrentMonthFromLocal/);
});

test('record list paints local attendance before awaiting student server refresh', () => {
  assert.match(navigation, /hydrateRecordAttendanceLocalSnapshot\(\{ render: false \}\);\s*renderElementaryRecords\(name\);\s*if \(localOnly\) return true;\s*}\s*const beforeStudentSignature[\s\S]*?await loadStudentsFromSupabase\(\);/);
  assert.match(navigation, /hydrateRecordAttendanceLocalSnapshot\(\{ render: false \}\);\s*renderKinderRecords\(name\);\s*if \(localOnly\) return true;\s*}\s*const beforeStudentSignature[\s\S]*?await loadStudentsFromSupabase\(\);/);
  assert.match(navigation, /if \(!refreshOnly \|\| studentsChanged\) renderElementaryRecords\(name\)/);
  assert.match(navigation, /if \(!refreshOnly \|\| studentsChanged\) renderKinderRecords\(name\)/);
});

test('attendance summary old implementation is fully deleted before the rebuild', () => {
  assert.equal(fs.existsSync('olli-attendance-guide.js'), false);
  assert.equal(fs.existsSync('olli-attendance-record-summary-ui.js'), false);
  assert.equal(fs.existsSync('olli-attendance-guide-align-runtime.js'), false);
  assert.equal(fs.existsSync('olli-attendance-guide-button.css'), false);
  assert.doesNotMatch(html, /recordAttendanceGuide|toggleOlliAttendanceGuide|olli-attendance-guide/);
  assert.doesNotMatch(recordListView, /recordAttendanceGuide|OlliAttendanceGuide/);
  assert.doesNotMatch(adapter, /OlliAttendanceGuide/);
  assert.doesNotMatch(observationRuntime, /renderRecordAttendanceSummary|getRecordAttendanceStudentMonthSummary|getRecordAttendanceMonthRange|formatRecordAttendanceDayList/);
  assert.doesNotMatch(attendanceRecordCss, /recordAttendanceGuide|recordAttendanceSummaryWrap|recordAttendanceSummaryTable|recordAttendanceToggle/);
});

test('record search remains open with a query when the keyboard closes', () => {
  assert.match(recordSearchControls, /function shouldKeepRecordSearchOpenWithoutKeyboard\(\)/);
  assert.match(recordSearchControls, /isRecordSearchOpen\(\)[\s\S]*?String\(input\.value \|\| ''\)\.trim\(\)/);
  assert.match(recordSearchControls, /if \(shouldKeepRecordSearchOpenWithoutKeyboard\(\)\) \{[\s\S]*?record-keyboard-offset'[\s\S]*?return;/);
  assert.match(recordSearchControls, /if \(keyboardClosed && isRecordSearchOpen\(\) && document\.activeElement !== input\) \{[\s\S]*?shouldKeepRecordSearchOpenWithoutKeyboard\(\)[\s\S]*?return;[\s\S]*?closeSearch\(\)/);
});

test('record search still closes explicitly or when no query remains', () => {
  assert.match(recordSearchControls, /function closeSearch\(event\)/);
  assert.match(recordSearchControls, /if \(isRecordSearchOpen\(\)\) \{\s*closeSearch\(\);\s*return;/);
  assert.match(recordSearchControls, /function restoreRecordSearchIfKeyboardClosed\(\)[\s\S]*?if \(shouldKeepRecordSearchOpenWithoutKeyboard\(\)\) return;\s*closeSearch\(\);/);
  assert.match(html, /olli-record-search-controls\.js\?v=20260930-search-preserve-1/);
});

test('attendance summary button exists only for record search mode', () => {
  const summaryButtonTag = html.match(/<button[^>]*id="recordAttendanceSummaryToggle"[^>]*>/)?.[0] || '';
  assert.ok(summaryButtonTag, 'search-only attendance summary button must exist');
  assert.match(summaryButtonTag, /\bdisabled\b/);
  assert.match(summaryButtonTag, /onclick="toggleRecordAttendanceSummary\(event\)"/);
  assert.match(html, /olli-record-attendance-summary\.js\?v=20260930-search-only-1/);
  assert.match(html, /olli-record-attendance-summary\.css\?v=20260930-search-only-1/);
  assert.match(attendanceSummaryCss, /#recordAttendanceSummaryToggle\.recordAttendanceSummaryBtn\{[\s\S]*?display:none;[\s\S]*?right:16px/);
  assert.match(attendanceSummaryCss, /#recordRoomScreen\.record-search-open #recordAttendanceSummaryToggle\.recordAttendanceSummaryBtn\{[\s\S]*?display:inline-flex/);
  assert.doesNotMatch(attendanceSummaryCss, /olli-main-subpage-drawer-open[\s\S]*?recordAttendanceSummaryToggle/);
  assert.doesNotMatch(attendanceSummaryCss, /!important/);
});

test('attendance summary rows are tagged only in search results, never in the normal attendance list', () => {
  assert.match(recordListView, /const searchStudentAttr = searchMode \? ` data-record-search-student-id=/);
  assert.doesNotMatch(recordListView, /data-record-student-id=/);
  assert.match(attendanceSummary, /#recordRoomScreen\.record-search-open #recordList \[data-record-search-student-id\]/);
  assert.doesNotMatch(attendanceSummary, /\[data-record-student-id\]/);
});

test('attendance summary requires an open search with a non-empty query', () => {
  assert.match(attendanceSummary, /function isSearchReady\(\)[\s\S]*?return isSearchOpen\(\) && !!searchQuery\(\)/);
  assert.match(attendanceSummary, /if \(!isSearchReady\(\)\) \{[\s\S]*?deactivate\(\)/);
  assert.match(attendanceSummary, /button\.disabled = !ready/);
});

test('attendance summary calculates only current search result rows with one attendance-store snapshot', () => {
  assert.match(attendanceSummary, /function readSnapshot\(\)[\s\S]*?global\.readRecordDailyAttendanceStore\(\)/);
  assert.match(attendanceSummary, /function renderSearchResults\(\)[\s\S]*?const rows = visibleSearchRows\(\);[\s\S]*?const snapshot = readSnapshot\(\)/);
  assert.match(attendanceSummary, /const payloads = new Map\(\)/);
  assert.doesNotMatch(attendanceSummary, /summaryCache|cacheContext|renderGeneration|runChunk|requestAnimationFrame/);
});

test('attendance summary follows search-result rerenders without whole-roster background work', () => {
  assert.match(attendanceSummary, /addEventListener\('olli:record-list-rendered',[\s\S]*?if \(!isSearchReady\(\)\)[\s\S]*?deactivate\(\)[\s\S]*?if \(active\) renderSearchResults\(\)/);
  assert.match(attendanceSummary, /addEventListener\('olli:attendance-changed'/);
  assert.match(adapter, /emitRecordListRendered\(view\)/);
  assert.match(adapter, /emitAttendanceChanged\(student\.id\)/);
  assert.doesNotMatch(attendanceSummary, /MutationObserver|ResizeObserver|getBoundingClientRect|offsetWidth|clientWidth/);
});

test('attendance summary output remains below the searched student name', () => {
  assert.match(attendanceSummaryCss, /\.studentTextWrap\.recordAttendanceSummaryHost\{[\s\S]*?position:relative/);
  assert.match(attendanceSummaryCss, /#recordRoomScreen \.recordAttendanceSummaryLine\{[\s\S]*?position:absolute;[\s\S]*?top:calc\(100% \+ 2px\)/);
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

test('attendance paint barrier spans two animation frames before heavy local work resumes', () => {
  const start = adapter.indexOf('function afterNextPaint()');
  const end = adapter.indexOf('function clean', start);
  const body = adapter.slice(start, end);
  const frames = body.match(/requestAnimationFrame/g) || [];
  assert.ok(frames.length >= 2, 'attendance paint barrier must span two animation frames');
});

test('attendance tapping paints exact-session state before local storage or network work', () => {
  const start = adapter.indexOf('async function toggleTodayAttendance');
  const end = adapter.indexOf('function afterRecordListLoaded', start);
  const body = adapter.slice(start, end);
  const visual = body.indexOf('applyButtonStatus(nextStatus)');
  const paint = body.indexOf('await afterNextPaint()');
  const studentRead = body.indexOf('global.getAllStudents().find');
  const localRead = body.indexOf('global.readRecordDailyAttendanceStore');
  const localWrite = body.indexOf('writeLocalStatus(');
  const serverWrite = body.indexOf('await setAttendanceRegisterStatus');
  assert.ok(visual >= 0, 'visual attendance update must exist');
  assert.ok(paint > visual, 'browser paint yield must follow the visual update');
  assert.ok(studentRead > paint, 'student LocalStorage-backed lookup must happen after the first paint');
  assert.ok(localRead > paint, 'attendance LocalStorage read must happen after the first paint');
  assert.ok(localWrite > paint, 'attendance local write must happen after the first paint');
  assert.ok(serverWrite > localWrite, 'server save must follow local persistence');
  assert.doesNotMatch(body.slice(0, paint), /hydrateLocalAttendanceSnapshot/);
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

test('attendance background refresh merges authoritative data without blocking first paint', () => {
  const start = adapter.indexOf('function afterRecordListLoaded');
  const end = adapter.indexOf('// Stage 2 refreshes today\'s schedule only.', start);
  const body = adapter.slice(start, end);
  assert.doesNotMatch(body, /hydrateLocalAttendanceSnapshot/);
  assert.match(body, /syncCurrentMonth\(new Date\(\), \{ render: false, skipLocal: true, forceMerge: true, onChanged: markChanged \}\)/);
  assert.match(body, /if \(attendanceChanged && getCurrentRecordView\(\) === view\) renderCurrentRecordList\(\)/);
  assert.doesNotMatch(adapter, /async function afterRecordListLoaded\(\)/);
});

test('attendance server refresh only rerenders schedule when the visible snapshot changed', () => {
  assert.match(adapter, /const beforeSignature = todayScheduleState\.signature \|\| currentTodayScheduleSignature\(\);/);
  assert.match(adapter, /const changed = nextSignature !== beforeSignature;/);
  assert.match(adapter, /if \(changed && options\.render !== false\) renderCurrentRecordList\(\);/);
});

test('phone loads cache-busted shared and adapter attendance scripts', () => {
  assert.match(html, /olli-attendance-data\.js\?v=20260924-week-local-first-1/);
  assert.match(html, /olli-attendance-phone-adapter\.js\?v=20260930-summary-v1/);
  assert.match(html, /olli-attendance-record\.css\?v=20260930-summary-reset-1/);
  assert.match(html, /olli-record-list-view\.js\?v=20260930-search-only-1/);
  assert.match(html, /olli-record-attendance-summary\.js\?v=20260930-search-only-1/);
  assert.match(html, /olli-record-attendance-summary\.css\?v=20260930-search-only-1/);
  assert.match(html, /olli-attendance-sync-fallback\.js\?v=20260930-clean-1/);
  assert.match(html, /olli-record-room-navigation\.js\?v=20260930-attendance-runtime-cleanup-1/);
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

test('attendance row rendering uses one exact-session status owner and a render-scoped local store', () => {
  assert.match(observationRuntime, /const adapterOwnsStatus = !!\(adapter && typeof adapter\.decorateLeadIcon === 'function'\)/);
  assert.match(observationRuntime, /const status = adapterOwnsStatus \? '' : getRecordAttendanceStatus/);
  assert.match(adapter, /let renderAttendanceStoreSnapshot = null/);
  assert.match(adapter, /function scheduleAttendanceStoreRelease\(\)/);
  assert.match(adapter, /Promise\.resolve\(\)\.then\(endRecordListRender\)/);
});

test('attendance taps do not start the student-row long press timer', () => {
  assert.match(studentOperations, /if \(e\?\.target\?\.closest\?\.\('\.recordAttendanceLeadBtn'\)\) return;/);
});











test('revision polling stays isolated from the rebuilt summary UI', () => {
  assert.match(syncFallback, /function hasRealtimeConnection\(\)/);
  assert.match(syncFallback, /if \(!allowWithRealtime && hasRealtimeConnection\(\)\) return false;/);
  assert.doesNotMatch(syncFallback, /recordAttendanceSummaryToggle|toggleRecordAttendanceSummary|OlliRecordAttendanceSummary/);
});

test('attendance long-press assets are cache-busted', () => {
  assert.match(html, /olli-data-student-operations\.js\?v=20260930-attendance-runtime-cleanup-1/);
  assert.match(html, /olli-record-list-view\.js\?v=20260930-search-only-1/);
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
  assert.match(html, /olli-data-student-operations\.js\?v=20260930-attendance-runtime-cleanup-1/);
  assert.match(html, /olli-phone-base\.css\?v=20260926-student-action-owner-1/);
});
