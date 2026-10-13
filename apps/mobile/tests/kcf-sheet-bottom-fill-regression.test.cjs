const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const editCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const editJs = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('continuous-record sheet has a full-height white continuation below the keyboard viewport', () => {
  assert.match(teacherCss, /\\.kcfTeacherSheetBottomFill \\{[\\s\\S]*?position:fixed;[\\s\\S]*?top:100vh;[\\s\\S]*?bottom:0;[\\s\\S]*?z-index:120999;[\\s\\S]*?background:#fff;/);
  assert.match(teacherCss, /body\\.kcfTeacherSheetOpen \\.kcfTeacherSheetBottomFill \\{[\\s\\S]*?visibility:visible;/);
  assert.match(teacherJs, /fill\\.style\\.top = Math\\.max\\(0, Math\\.round\\(viewportBottom\\)\\) \\+ 'px';/);
  assert.match(teacherJs, /fill\\.id = 'kcfTeacherSheetBottomFill'/);
});

test('lesson-record and feedback editors share a lower white surface, but not its touch handling', () => {
  assert.match(editCss, /\\.phoneKcfEditBottomFill \\{[\\s\\S]*?top:100vh;[\\s\\S]*?bottom:0;[\\s\\S]*?z-index:121005;[\\s\\S]*?background:#fff;[\\s\\S]*?pointer-events:none;/);
  assert.match(editCss, /body\\.kcfDedicatedEditSheetOpen \\.phoneKcfEditBottomFill/);
  assert.match(editJs, /function ensurePhoneKcfEditBottomFill\\(\\)/);
  assert.match(editJs, /fill\\.style\\.top = \`\\$\\{Math\\.round\\(rect\\.top \\+ rect\\.height\\)\\}px\`;/);
  assert.match(editJs, /if \\(open\\) ensurePhoneKcfEditBottomFill\\(\\)/);
});

test('sheet stacking, viewport bounds, focus, edit actions and Work navigation are left intact', () => {
  assert.match(teacherCss, /z-index:121000;/);
  assert.match(editCss, /z-index:121010;/);
  assert.match(editCss, /z-index:121020;/);
  assert.match(teacherJs, /input:editor,/);
  assert.match(editJs, /function submitPhoneKcfRecordEditSheet/);
  assert.match(editJs, /function submitPhoneKcfLiveEditSheet/);
  assert.match(teacherJs, /\\.kcfTopWorkBtn, \\.observationTopWorkBtn, #olliTalkArchiveBtn/);
});

test('updated styles and scripts are cache-busted consistently', () => {
  for (const file of ['kcf-teacher-sheet.css', 'kcf-teacher-sheet.js',
    'kcf-auto-mode.css', 'olli-feedback-registration-phone-adapter.js']) {
    assert.ok(html.includes(file + '?v=20261013-sheet-bottom-fill-1'), file);
  }
});
