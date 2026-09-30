const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const adapter = fs.readFileSync('olli-attendance-phone-adapter.js', 'utf8');
const navigation = fs.readFileSync('olli-record-room-navigation.js', 'utf8');
const observationRuntime = fs.readFileSync('olli-observation-runtime.js', 'utf8');
const attendanceSummary = fs.readFileSync('olli-record-attendance-summary.js', 'utf8');
const attendanceSummaryCss = fs.readFileSync('olli-record-attendance-summary.css', 'utf8');
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

test('attendance summary button exists only for record search mode', () => {
  assert.match(html, /id="recordAttendanceSummaryToggle"[^>]*disabled[^>]*onclick="toggleRecordAttendanceSummary\(event\)"/);
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
