const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const autoCss = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const pwa = fs.readFileSync('olli-pwa-manifest.js', 'utf8');

test('Teacher and dedicated edit viewport locks avoid fixed body positioning', () => {
  const teacherLock = teacherCss.match(/html\.kcfTeacherSheetOpen,[\s\S]*?body\.kcfTeacherSheetOpen\s*\{[\s\S]*?\n\}/)?.[0] || '';
  const dedicatedLock = autoCss.match(/html\.kcfDedicatedEditViewportLocked,[\s\S]*?body\.kcfDedicatedEditViewportLocked\s*\{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(teacherLock, /overflow:hidden/);
  assert.doesNotMatch(teacherLock, /position\s*:\s*fixed/i);
  assert.match(dedicatedLock, /overflow:hidden !important/);
  assert.doesNotMatch(dedicatedLock, /position\s*:\s*fixed/i);
});

test('phone app requests portrait-only orientation through manifest policy and runtime lock', () => {
  assert.match(pwa, /orientation:\s*['"]portrait['"]/);
  assert.match(pwa, /orientation\.lock\(['"]portrait['"]\)/);
  assert.match(pwa, /orientationchange/);
});
