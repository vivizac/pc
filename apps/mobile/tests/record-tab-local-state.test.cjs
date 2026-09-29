const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const runtime = fs.readFileSync('olli-observation-runtime.js', 'utf8');
const navigation = fs.readFileSync('olli-record-room-navigation.js', 'utf8');

test('attendance elementary and kinder tab choice is stored locally per academy', () => {
  assert.match(runtime, /const OLLI_RECORD_LAST_DIVISION_STORAGE_KEY = 'olli_record_last_division_v1';/);
  assert.match(runtime, /getOlliCurrentAcademyId/);
  assert.match(runtime, /localStorage\.setItem\(getOlliRecordLastDivisionStorageKey\(\), normalized\)/);
  assert.match(runtime, /localStorage\.getItem\(getOlliRecordLastDivisionStorageKey\(\)\)/);
  assert.match(runtime, /saveOlliLastRecordDivisionView\(nextView\)/);
});

test('opening Attendance restores the last locally saved elementary or kinder tab', () => {
  assert.match(navigation, /async function openRecordAttendanceDashboard\(\)[\s\S]*window\.getOlliLastRecordDivisionView\(\)/);
  assert.match(navigation, /currentObservationView = targetView;[\s\S]*currentRecordView = targetView;/);
  assert.match(navigation, /updateRecordHeaderUI\(\);[\s\S]*loadRecords\(''\)/);
});

test('changed attendance state assets use fresh cache keys', () => {
  assert.match(html, /olli-observation-runtime\.js\?v=20260922-navigation-single-owner-1/);
  assert.match(html, /olli-record-room-navigation\.js\?v=20260922-record-tab-state-1/);
  assert.match(html, /olli-phone-base\.css\?v=20260922-attendance-hub-1/);
});


test('switching elementary and kinder tabs refreshes the list without undefined localOnly state', () => {
  const match = runtime.match(/async function toggleRecordViewMode\(targetView\) \{[\s\S]*?\n\}\n\n\nasync function toggleRecordMode/);
  assert.ok(match, 'toggleRecordViewMode should exist');
  assert.doesNotMatch(match[0], /loadRecords\('', \{ localOnly \}\)/);
  assert.match(match[0], /else \{\s*await loadRecords\(''\);\s*\}/);
});
