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


test('personality record header keeps empty and selected states on the same baseline', () => {
  assert.match(attendanceCss, /\.pcAttendanceDetailHead\{[^}]*min-height:67px;[^}]*box-sizing:border-box;/);
});

test('student info button stays on the far right after mode tabs move beside the title', () => {
  assert.match(attendanceCss, /\.pcAttendanceStudentInfoBtn\{margin-left:auto;\}/);
});

test('observation student name uses a much lighter weight', () => {
  assert.match(editorCss, /#memoPageStudentName\{[^}]*font-weight:400!important;/);
});


test('active personality record tab is blue with white text', () => {
  assert.match(attendanceCss, /\.pcAttendanceRecordModeTab\.active\{background:#0A84FF;color:#fff;box-shadow:none;\}/);
});

test('observation send button is gray with black icon color', () => {
  assert.match(editorCss, /\.memoFeedbackBottomBtn\{[^}]*background:#e5e5e5!important;color:#111!important;box-shadow:none!important;/);
});
