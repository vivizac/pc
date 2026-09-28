const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const scrollRuntime = fs.readFileSync('olli-page-scroll-reset.js', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');

test('legacy normal-composer viewport lock is completely removed', () => {
  assert.doesNotMatch(scrollRuntime, /bindKinderFeedbackComposerViewportLock/);
  assert.doesNotMatch(scrollRuntime, /kcfComposerViewportLocked/);
  assert.doesNotMatch(scrollRuntime, /kcfComposerExpanded/);
  assert.doesNotMatch(scrollRuntime, /--phone-kcf-composer-vv-/);
});

test('Teacher sheet owns its own visual viewport sizing', () => {
  assert.match(teacherJs, /function syncViewport\(\)/);
  assert.match(teacherJs, /global\.visualViewport/);
  assert.match(teacherJs, /--kcf-teacher-vv-top/);
  assert.match(teacherJs, /--kcf-teacher-vv-left/);
  assert.match(teacherJs, /--kcf-teacher-vv-width/);
  assert.match(teacherJs, /--kcf-teacher-vv-height/);
  assert.match(teacherCss, /left:var\(--kcf-teacher-vv-left, 0px\)/);
  assert.match(teacherCss, /top:var\(--kcf-teacher-vv-top, 0px\)/);
  assert.match(teacherCss, /width:var\(--kcf-teacher-vv-width, 100vw\)/);
  assert.match(teacherCss, /height:var\(--kcf-teacher-vv-height, 100vh\)/);
});

test('Teacher editor gets a real flex area with its controls bottom anchored', () => {
  assert.match(teacherCss, /\.kcfTeacherSheetBody \{[\s\S]*?display:flex;[\s\S]*?flex-direction:column;/);
  assert.match(teacherCss, /\.kcfTeacherSheetInput \{[\s\S]*?flex:1 1 auto;[\s\S]*?min-height:0;[\s\S]*?overflow-y:auto;/);
  assert.match(teacherCss, /\.kcfTeacherSheetBottom \{[\s\S]*?flex:0 0 auto;/);
});

test('Teacher roster keeps horizontal scrolling inside its own host', () => {
  assert.match(teacherCss, /\.kcfTeacherSheetRosterHost \{[\s\S]*?flex:1 1 auto;[\s\S]*?min-width:0;/);
  assert.match(teacherCss, /\.kcfTeacherSheetRosterHost \.kcfAutoStudentRoster/);
});

test('normal page-scroll reset no longer owns Teacher input gestures', () => {
  assert.doesNotMatch(scrollRuntime, /preventKinderFeedbackComposerBackgroundTouchMove/);
  assert.doesNotMatch(scrollRuntime, /kcfAutoStudentRosterScroller/);
});
