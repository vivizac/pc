const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const editCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const editJs = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

function cssBlock(source, selector) {
  const pos = source.indexOf(selector);
  assert.ok(pos >= 0, selector);
  return source.slice(pos, source.indexOf('}', pos) + 1);
}

test('continuous record has fixed white continuation to layout viewport bottom', () => {
  const rule = cssBlock(teacherCss, '.kcfTeacherSheetBottomFill {');
  for (const value of ['position:fixed;', 'top:100vh;', 'bottom:0;',
    'z-index:120999;', 'background:#fff;', 'pointer-events:none;']) {
    assert.ok(rule.includes(value), value);
  }
  assert.ok(teacherCss.includes('body.kcfTeacherSheetOpen .kcfTeacherSheetBottomFill'));
  assert.ok(teacherJs.includes("fill.id = 'kcfTeacherSheetBottomFill'"));
  assert.ok(teacherJs.includes("fill.style.top = Math.max(0, Math.round(viewportBottom)) + 'px'"));
  assert.ok(teacherJs.includes('Number(viewport.offsetTop || 0)'));
});

test('feedback and lesson-record edit sheets share noninteractive white continuation', () => {
  const rule = cssBlock(editCss, '.phoneKcfEditBottomFill {');
  for (const value of ['position:fixed;', 'top:100vh;', 'bottom:0;',
    'z-index:121005;', 'background:#fff;', 'pointer-events:none;']) {
    assert.ok(rule.includes(value), value);
  }
  assert.ok(editCss.includes('body.kcfDedicatedEditSheetOpen .phoneKcfEditBottomFill'));
  assert.ok(editJs.includes('function ensurePhoneKcfEditBottomFill()'));
  assert.ok(editJs.includes("fill.id = 'phoneKcfEditBottomFill'"));
  assert.ok(editJs.includes('Math.round(rect.top + rect.height)'));
  assert.ok(editJs.includes('if (open) ensurePhoneKcfEditBottomFill()'));
});

test('original focus, editor actions and stacking stay intact', () => {
  assert.ok(teacherCss.includes('z-index:121000;'));
  assert.ok(editCss.includes('z-index:121010;'));
  assert.ok(editCss.includes('z-index:121020;'));
  assert.ok(teacherJs.includes('input:editor,'));
  assert.ok(editJs.includes('function submitPhoneKcfRecordEditSheet'));
  assert.ok(editJs.includes('function submitPhoneKcfLiveEditSheet'));
  assert.ok(teacherJs.includes('.kcfTopWorkBtn, .observationTopWorkBtn, #olliTalkArchiveBtn'));
});

test('all four changed assets are cache-busted', () => {
  for (const file of ['kcf-teacher-sheet.css', 'kcf-teacher-sheet.js',
    'kcf-auto-mode.css', 'olli-feedback-registration-phone-adapter.js']) {
    assert.ok(html.includes(file + '?v=20261013-sheet-bottom-fill-1'), file);
  }
});
