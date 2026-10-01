const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const summary = fs.readFileSync('olli-record-attendance-summary.js', 'utf8');
const summaryCss = fs.readFileSync('olli-record-attendance-summary.css', 'utf8');
const listView = fs.readFileSync('olli-record-list-view.js', 'utf8');
const searchControls = fs.readFileSync('olli-record-search-controls.js', 'utf8');

test('attendance button exists only for search mode and stays disabled without a query', () => {
  assert.match(html, /id="recordAttendanceSummaryToggle"[^>]*disabled[^>]*onpointerdown="event\.preventDefault\(\)"/);
  assert.match(summaryCss, /#recordAttendanceSummaryToggle\.recordAttendanceSummaryBtn\{[\s\S]*?display:none/);
  assert.match(summaryCss, /#recordRoomScreen\.record-search-open #recordAttendanceSummaryToggle\.recordAttendanceSummaryBtn\{[\s\S]*?display:inline-flex/);
  assert.match(summary, /function isSearchReady\(\)[\s\S]*?return isSearchOpen\(\) && !!searchQuery\(\)/);
  assert.match(summary, /button\.disabled = !ready/);
});

test('attendance summary renders only the currently searched student rows', () => {
  assert.match(listView, /const searchStudentAttr = searchMode \? ` data-record-search-student-id=/);
  assert.match(summary, /#recordRoomScreen\.record-search-open #recordList \[data-record-search-student-id\]/);
  assert.doesNotMatch(summary, /\[data-record-student-id\]/);
  assert.match(summary, /const rows = visibleSearchRows\(\)/);
});

test('attendance summary stays inside the search flow', () => {
  assert.match(searchControls, /function shouldKeepRecordSearchOpenWithoutKeyboard\(\)/);
  assert.match(searchControls, /if \(shouldKeepRecordSearchOpenWithoutKeyboard\(\)\)/);
  assert.match(html, /olli-record-search-controls\.js\?v=20261001-attendance-search-summary-1/);
  assert.match(html, /olli-record-attendance-summary\.js\?v=20261001-search-only-restored-1/);
  assert.doesNotMatch(html, /olli-attendance-record-summary-ui\.js/);
});
