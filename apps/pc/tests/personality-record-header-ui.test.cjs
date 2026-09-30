const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const attendance = fs.readFileSync('pc-attendance.js', 'utf8');
const attendanceCss = fs.readFileSync('pc-attendance.css', 'utf8');
const editorCss = fs.readFileSync('pc-record-editor.css', 'utf8');

test('personality record mode tabs live beside the detail title rather than inside the editor card', () => {
  assert.match(attendance, /pcAttendanceDetailTitle">성향기록부<\/div>'\+recordModeTabsHtml\(\)\+'<\/div>/);
  assert.doesNotMatch(attendance, /<div class="pcAttendanceEditorHead"><div class="pcAttendanceRecordModeTabs"/);
  assert.match(attendanceCss, /\.pcAttendanceDetailHead\{[^}]*justify-content:flex-start;[^}]*gap:14px;/);
});

test('observation bottom history voice survey controls have no shadows in embedded PC record editor', () => {
  assert.match(editorCss, /#memoEditorUtilityGroup\{[^}]*box-shadow:none;/);
  assert.match(editorCss, /#memoEditorUtilityGroup>button\{[^}]*box-shadow:none!important;/);
});
