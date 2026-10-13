const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const editCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const drawerJs = fs.readFileSync('olli-main-subpage-drawer.js', 'utf8');
const workJs = fs.readFileSync('olli-talk-beta.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('detached QuickNote editor layers outrank the prepainted Attendance and QuickNote foreground layers', () => {
  const match = teacherCss.match(/\\.kcfTeacherSheetOverlay \\{[\\s\\S]*?z-index:(\\d+);/);
  const continuous = Number(match?.[1] || 0);
  const live = Number(editCss.match(/\\.phoneKcfLiveEditOverlay \\{[\\s\\S]*?z-index:(\\d+);/)?.[1] || 0);
  const record = Number(editCss.match(/\\.phoneKcfRecordEditOverlay \\{[\\s\\S]*?z-index:(\\d+);/)?.[1] || 0);
  assert.match(drawerJs, /mainPage\\.style\\.zIndex = '120500'/);
  assert.match(drawerJs, /companion\\.style\\.zIndex = '120600'/);
  assert.ok(continuous > 120700);
  assert.ok(live > continuous);
  assert.ok(record > live);
  const menu = Number(teacherCss.match(/\\.kcfComposerModeMenu\\{position:fixed;z-index:(\\d+);/)?.[1] || 0);
  assert.ok(menu > record);
});

test('continuous mode selection opens the sheet in both active and idle composers', () => {
  assert.match(teacherJs, /if \\(state\\.inlineOpen && state\\.composerMode === 'continuous'\\)/);
  assert.match(teacherJs, /!state\\.inlineOpen && !state\\.open && state\\.composerMode === 'continuous'/);
  assert.match(teacherJs, /teacherMode\\?\\.activateForComposer\\?\\.\\(event\\);[\\s\\S]*?open\\(event\\);/);
});

test('Work Hub button retains its own navigation handler, and stale QuickNote sheets are closed on navigation', () => {
  assert.match(workJs, /archiveButton\\.addEventListener\\('click',openOlliTalkArchivePage\\)/);
  assert.match(teacherJs, /\\.kcfTopWorkBtn, \\.observationTopWorkBtn, #olliTalkArchiveBtn/);
  assert.match(teacherJs, /close\\(\\{ sync:true \\}\\);/);
});

test('all updated QuickNote sheet layers use new cache versions', () => {
  assert.match(html, /kcf-teacher-sheet\\.css\\?v=20261013-quicknote-layer-stack-1/);
  assert.match(html, /kcf-teacher-sheet\\.js\\?v=20261013-quicknote-layer-stack-1/);
  assert.match(html, /kcf-auto-mode\\.css\\?v=20261013-quicknote-layer-stack-1/);
});
