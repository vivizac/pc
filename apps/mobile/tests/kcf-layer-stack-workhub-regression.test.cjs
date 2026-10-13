const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const editCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const drawerJs = fs.readFileSync('olli-main-subpage-drawer.js', 'utf8');
const workJs = fs.readFileSync('olli-talk-beta.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

function zIndexAfter(haystack, selector) {
  const section = haystack.slice(haystack.lastIndexOf(selector));
  const matched = section.match(/z-index:(\d+);/);
  return Number(matched?.[1] || 0);
}

test('detached edit layers outrank prepared Attendance rear, QuickNote foreground and return control', () => {
  assert.ok(drawerJs.includes("mainPage.style.zIndex = '120500'"));
  assert.ok(drawerJs.includes("companion.style.zIndex = '120600'"));
  assert.ok(drawerJs.includes("recordRoom.style.zIndex = '119700'"));
  const continuous = zIndexAfter(teacherCss, '.kcfTeacherSheetOverlay {');
  const live = zIndexAfter(editCss, '.phoneKcfLiveEditOverlay {');
  const record = zIndexAfter(editCss, '.phoneKcfRecordEditOverlay {');
  const menu = zIndexAfter(teacherCss, '.kcfComposerModeMenu{position:fixed;');
  assert.ok(continuous > 120700);
  assert.ok(live > continuous);
  assert.ok(record > live);
  assert.ok(menu > record);
});

test('continuous mode selection opens the sheet from an active or idle composer', () => {
  assert.ok(teacherJs.includes("if (state.inlineOpen && state.composerMode === 'continuous')"));
  assert.ok(teacherJs.includes("!state.inlineOpen && !state.open && state.composerMode === 'continuous'"));
  assert.ok(teacherJs.includes("teacherMode?.activateForComposer?.(event);"));
  assert.ok(teacherJs.includes("open(event);"));
});

test('Work Hub keeps original navigation, and QuickNote closes detached sheet when leaving', () => {
  assert.ok(workJs.includes("archiveButton.addEventListener('click',openOlliTalkArchivePage)"));
  assert.ok(teacherJs.includes(".kcfTopWorkBtn, .observationTopWorkBtn, #olliTalkArchiveBtn"));
  assert.ok(teacherJs.includes("close({ sync:true });"));
});

test('updated detached sheet layers are cache-busted', () => {
  assert.ok(html.includes('kcf-teacher-sheet.css?v=20261013-sheet-bottom-fill-1'));
  assert.ok(html.includes('kcf-teacher-sheet.js?v=20261013-sheet-bottom-fill-1'));
  assert.ok(html.includes('kcf-auto-mode.css?v=20261013-sheet-bottom-fill-1'));
});
